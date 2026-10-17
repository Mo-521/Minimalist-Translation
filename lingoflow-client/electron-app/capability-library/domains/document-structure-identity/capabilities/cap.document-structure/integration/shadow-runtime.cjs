"use strict";

// The shadow observer remains developer-only. The separate application call
// below returns an explicitly non-authoritative D1 candidate and never
// changes the canonical SemanticStructureArtifact or its consumers.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { Worker, isMainThread, workerData, parentPort } = require("node:worker_threads");
const { buildObjectFirstContract, validateObjectFirstContract } = require("./object-first-contract.cjs");

const FLAG = "LINGOFLOW_OBJECT_FIRST_SHADOW";
const REPORT = "OBJECT_FIRST_SHADOW_REPORT.json";
let activeWorker = false;
let activeApplicationWorker = false;

function nativeFile(file) {
  return Boolean(file && path.isAbsolute(file) && fs.existsSync(file) &&
    fs.statSync(file).isFile());
}

function pathExecutable(name, env) {
  const searchPath = String(env.Path || env.PATH || env.path || "");
  for (const directory of searchPath.split(path.delimiter).filter(Boolean)) {
    const file = path.join(directory, name);
    if (nativeFile(file)) return file;
  }
  return "";
}

// Local discovery is optional. The accepted D1 implementation still requires
// Python modules and Poppler; the worker probes both before processing a PDF.
// Explicit paths always win, including when an explicit path is invalid.
function applicationConfiguration(env = process.env, { homeDirectory = os.homedir() } = {}) {
  const localDependencies = path.join(homeDirectory, ".cache", "codex-runtimes",
    "codex-primary-runtime", "dependencies");
  const python = String(env.LINGOFLOW_OBJECT_FIRST_PYTHON || "").trim() ||
    [path.join(localDependencies, "python", process.platform === "win32" ? "python.exe" : "bin/python3"),
      pathExecutable(process.platform === "win32" ? "python.exe" : "python3", env),
      pathExecutable("python", env)].find(nativeFile) || "";
  const pdftoppm = String(env.LINGOFLOW_OBJECT_FIRST_PDFTOPPM || "").trim() ||
    [path.join(localDependencies, "native", "poppler", "Library", "bin",
      process.platform === "win32" ? "pdftoppm.exe" : "pdftoppm"),
      pathExecutable(process.platform === "win32" ? "pdftoppm.exe" : "pdftoppm", env)]
      .find(nativeFile) || "";
  const runRoot = String(env.LINGOFLOW_OBJECT_FIRST_RUN_ROOT || os.tmpdir()).trim();
  if (!nativeFile(python) || !nativeFile(pdftoppm))
    return { status: "missing_native_dependencies" };
  if (!path.isAbsolute(runRoot) || !fs.existsSync(runRoot) ||
      !fs.statSync(runRoot).isDirectory())
    return { status: "missing_run_root" };
  return { status: "ready", python, pdftoppm, runRoot };
}

function validateApplicationResult(message) {
  if (!message || message.ok !== true || message.status !== "candidate_pending_runtime_gate")
    throw Error("D1 application worker did not return a candidate");
  const contract = validateObjectFirstContract(message.contract);
  const source = message.sourceInventory;
  if (!String(source?.schemaVersion || "").startsWith("DerivedSourceSpanInventory/") ||
      source.authority !== "none" || !source.pages ||
      Object.keys(source.pages).length !== contract.summary.pages ||
      !/^[a-f0-9]{64}$/.test(message.sourcePdfSha256 || ""))
    throw Error("D1 application source inventory is invalid");
  const sourceHash = crypto.createHash("sha256").update(JSON.stringify(source)).digest("hex");
  if (sourceHash !== message.sourceInventorySha256 ||
      Object.entries(source.pages).some(([key, page]) =>
        page.sourcePdfSha256 !== message.sourcePdfSha256 ||
        contract.sourcePdfSha256ByPage[key] !== message.sourcePdfSha256 ||
        !Array.isArray(page.sourceLines)))
    throw Error("D1 application source identity differs from its contract");
  return message;
}

// Always registered by the app, independent of the developer shadow flag.
// Native tool paths are supplied by the main process environment, never IPC.
function produceObjectFirstForApplication(pdfPath, { env = process.env,
  WorkerClass = Worker, tempRoot } = {}) {
  const config = applicationConfiguration(env);
  if (config.status !== "ready") return Promise.resolve({ ok: false, status: config.status });
  if (activeApplicationWorker) return Promise.resolve({ ok: false, status: "busy" });
  const resolved = String(pdfPath || "").trim();
  if (!path.isAbsolute(resolved) || path.extname(resolved).toLowerCase() !== ".pdf" ||
      !fs.existsSync(resolved) || !fs.statSync(resolved).isFile())
    return Promise.resolve({ ok: false, status: "invalid_pdf_input" });
  const root = tempRoot || config.runRoot;
  const runDirectory = fs.mkdtempSync(path.join(root, "object-first-app-"));
  activeApplicationWorker = true;
  return new Promise(resolve => {
    let worker;
    let message = null;
    let failure = null;
    try {
      worker = new WorkerClass(__filename, { workerData: {
        kind: "object_first_application", pdfPath: resolved, runDirectory,
        python: config.python, pdftoppm: config.pdftoppm,
      } });
    } catch (error) { failure = error; }
    const finish = () => {
      activeApplicationWorker = false;
      // Only remove the exact directory created for this invocation.
      try {
        if (path.dirname(runDirectory) === path.resolve(root) &&
            path.basename(runDirectory).startsWith("object-first-app-"))
          fs.rmSync(runDirectory, { recursive: true, force: true });
      } catch (error) { failure ||= error; }
      if (failure) return resolve({ ok: false, status: "production_failed",
        error: String(failure.message || failure) });
      if (message?.ok === false)
        return resolve({ ok: false, status: String(message.status || "production_failed"),
          error: String(message.error || "D1 production failed") });
      try { return resolve(validateApplicationResult(message)); }
      catch (error) { return resolve({ ok: false, status: "invalid_d1_result",
        error: String(error.message || error) }); }
    };
    if (!worker) return finish();
    worker.on("message", received => { message = received; });
    worker.on("error", error => { failure = error; });
    worker.on("exit", code => {
      if (code !== 0 && !failure) failure = Error(`D1 worker exited with code ${code}`);
      finish();
    });
  });
}

// Run only inside the shadow worker, never on the PDF extraction UI path.
// A missing native dependency is an installation problem, not a classifier result.
function probeNativeDependencies(python, pdftoppm, spawn = spawnSync) {
  const pythonResult = spawn(python,
    ["-c", "import pdfplumber; from PIL import Image"],
    { encoding: "utf8", timeout: 15000, windowsHide: true });
  if (pythonResult.error || pythonResult.status !== 0)
    return { status: "python_modules_unavailable",
      detail: String(pythonResult.error?.message || pythonResult.stderr || "Python import failed").trim() };
  const popplerResult = spawn(pdftoppm, ["-v"],
    { encoding: "utf8", timeout: 15000, windowsHide: true });
  if (popplerResult.error || popplerResult.status !== 0)
    return { status: "pdftoppm_unavailable",
      detail: String(popplerResult.error?.message || popplerResult.stderr || "pdftoppm failed").trim() };
  return { status: "ready" };
}

function configuration(env = process.env) {
  if (env[FLAG] !== "1") return { status: "disabled" };
  const python = String(env.LINGOFLOW_OBJECT_FIRST_SHADOW_PYTHON || "").trim();
  const pdftoppm = String(env.LINGOFLOW_OBJECT_FIRST_SHADOW_PDFTOPPM || "").trim();
  if (!python || !pdftoppm || !fs.existsSync(python) || !fs.existsSync(pdftoppm) ||
      !fs.statSync(python).isFile() || !fs.statSync(pdftoppm).isFile())
    return { status: "missing_native_dependencies" };
  const root = String(env.LINGOFLOW_OBJECT_FIRST_SHADOW_RUN_ROOT || os.tmpdir()).trim();
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory())
    return { status: "missing_run_root" };
  return { status: "ready", python, pdftoppm, root };
}

function reportFor(result) {
  const candidate = result.candidate;
  if (!candidate || !String(candidate.schemaVersion || "").startsWith(
    "OfflineStructuralObjectCandidate/") || candidate.authority !== "none" ||
      candidate.status !== "machine_candidate_pending_human_review")
    throw Error("Object-first shadow requires a non-authoritative candidate");
  if (Object.keys(candidate.pages || {}).length !== result.observedSource.summary.pageCount)
    throw Error("Object-first shadow page count differs from observed PDF");
  const summary = candidate.summary;
  if (summary.sourceLines !== summary.assigned + summary.pending + summary.excluded)
    throw Error("Object-first shadow source accounting failed");
  const contract = buildObjectFirstContract(candidate, result.source);
  const candidateSha256 = crypto.createHash("sha256")
    .update(JSON.stringify(candidate)).digest("hex");
  return {
    schemaVersion: "object-first-shadow-report/v1",
    authority: "none",
    status: "completed_not_semantically_accepted",
    candidateSchemaVersion: candidate.schemaVersion,
    candidateArtifactId: `object-first-candidate-sha256:${candidateSha256}`,
    objectContractArtifactId: contract.artifactId,
    sourcePdfSha256: result.sourcePdfSha256,
    extractionMainSha256: result.extractionMainSha256,
    pages: result.observedSource.summary.pageCount,
    sourceLines: summary.sourceLines,
    assigned: summary.assigned,
    pending: summary.pending,
    excluded: summary.excluded,
    objectsByType: summary.byType,
    visualRegions: result.nativeVisualRegions.summary,
  };
}

function scheduleShadowForPdf(pdfPath, { env = process.env, logger = console,
  WorkerClass = Worker } = {}) {
  const config = configuration(env);
  if (config.status !== "ready") return { status: config.status };
  if (activeWorker) return { status: "busy" };
  if (!pdfPath || !fs.existsSync(pdfPath) || !fs.statSync(pdfPath).isFile())
    return { status: "missing_pdf" };
  const runDirectory = fs.mkdtempSync(path.join(config.root, "object-first-shadow-"));
  const worker = new WorkerClass(__filename, { workerData: {
    kind: "object_first_shadow", pdfPath, runDirectory,
    python: config.python, pdftoppm: config.pdftoppm,
  } });
  activeWorker = true;
  worker.on("message", message => {
    if (message?.status === "completed_not_semantically_accepted")
      logger.info?.("[object-first-shadow] report ready", runDirectory);
    else logger.warn?.("[object-first-shadow] diagnostic failed", runDirectory,
      message?.error || "unknown error");
  });
  worker.on("error", error => logger.warn?.(
    "[object-first-shadow] worker failed", runDirectory, error?.message || error));
  worker.on("exit", () => { activeWorker = false; });
  worker.unref?.();
  return { status: "scheduled_non_authoritative", runDirectory };
}

if (!isMainThread && workerData?.kind === "object_first_shadow") {
  (async () => {
    let report;
    try {
      const native = probeNativeDependencies(workerData.python, workerData.pdftoppm);
      if (native.status !== "ready")
        throw Error(`${native.status}: ${native.detail}`);
      const { buildFromPdf } = require("../offline/pdf-full-pipeline.cjs");
      const result = await buildFromPdf({ pdfPath: workerData.pdfPath, paper: 1,
        python: workerData.python, pdftoppm: workerData.pdftoppm,
        runDirectory: workerData.runDirectory, visualRegionMode: "native" });
      report = reportFor(result);
      // Development diagnostics only: do not return carriers or publish a new
      // canonical artifact. This comparison cannot trigger translation/export.
      const { auditConsumerShadow } = require("./consumer-shadow.cjs");
      report.consumerShadow = auditConsumerShadow(result);
      const { buildConsumerPlan } = require("./object-consumer-plan.cjs");
      const plan = buildConsumerPlan(buildObjectFirstContract(result.candidate, result.source), result.source);
      report.consumerPlan = { planId: plan.planId, status: plan.status,
        summary: plan.summary, blockers: plan.blockers,
        note: "Development diagnostics only; missing order/policy is not inferred and no carrier is published." };
    } catch (error) {
      report = { schemaVersion: "object-first-shadow-report/v1", authority: "none",
        status: "failed_without_runtime_effect", error: String(error?.message || error) };
    }
    fs.writeFileSync(path.join(workerData.runDirectory, REPORT),
      JSON.stringify(report, null, 2) + "\n");
    parentPort?.postMessage(report);
  })();
}

if (!isMainThread && workerData?.kind === "object_first_application") {
  (async () => {
    try {
      const native = probeNativeDependencies(workerData.python, workerData.pdftoppm);
      if (native.status !== "ready") {
        parentPort?.postMessage({ ok: false, status: native.status, error: native.detail });
        return;
      }
      const { buildFromPdf } = require("../offline/pdf-full-pipeline.cjs");
      const result = await buildFromPdf({ pdfPath: workerData.pdfPath, paper: 1,
        python: workerData.python, pdftoppm: workerData.pdftoppm,
        runDirectory: workerData.runDirectory, visualRegionMode: "native" });
      const afterSha = crypto.createHash("sha256")
        .update(fs.readFileSync(workerData.pdfPath)).digest("hex");
      if (afterSha !== result.sourcePdfSha256)
        throw Error("Source PDF changed during D1 production");
      const contract = buildObjectFirstContract(result.candidate, result.source);
      const sourceInventorySha256 = crypto.createHash("sha256")
        .update(JSON.stringify(result.source)).digest("hex");
      parentPort?.postMessage({ ok: true, status: "candidate_pending_runtime_gate",
        contract, sourceInventory: result.source, sourceInventorySha256,
        sourcePdfSha256: afterSha,
        diagnostics: { pendingSourceLines: contract.summary.pending,
          unsupportedObjects: contract.summary.byType.unsupported_structured_block || 0,
          excludedSourceLines: contract.summary.excluded,
          extractionMainSha256: result.extractionMainSha256 } });
    } catch (error) {
      parentPort?.postMessage({ ok: false, status: "production_failed",
        error: String(error?.message || error) });
    }
  })();
}

module.exports = { configuration, probeNativeDependencies, reportFor,
  scheduleShadowForPdf, applicationConfiguration, validateApplicationResult,
  produceObjectFirstForApplication, REPORT };
