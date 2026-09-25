#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { PDFDocument } = require(path.join(__dirname, "..", "electron-app", "node_modules", "pdf-lib"));
const {
  deepFreeze,
  assertNoRuntimeDecisionFields,
  validateCorpusSample,
} = require(path.join(__dirname, "..", "electron-app", "capability-library"));

function fail(code, message) {
  const error = new Error(message);
  error.name = "CapabilityLibraryIntakeError";
  error.code = code;
  throw error;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") result.help = true;
    else if (token === "--manifest" || token === "--source" || token === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail("CAPABILITY_INTAKE_ARGUMENT_MISSING", `Missing value for ${token}`);
      result[token.slice(2)] = value;
      index += 1;
    } else fail("CAPABILITY_INTAKE_ARGUMENT_UNKNOWN", `Unknown argument: ${token}`);
  }
  return result;
}

function readManifest(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assertNoRuntimeDecisionFields(manifest);
  const required = ["id", "displayName", "provenance", "rights", "boundaryFeatureIds", "expectedOutcomes", "evidenceRefs", "finalDecisionsOwnedBy"];
  required.forEach((key) => {
    if (manifest[key] === undefined) fail("CAPABILITY_INTAKE_MANIFEST_INVALID", `Manifest is missing '${key}'`);
  });
  if (!manifest.rights || manifest.rights.canStoreMetadata !== true) {
    fail("CAPABILITY_INTAKE_RIGHTS_REQUIRED", "Metadata storage permission is required before intake");
  }
  return manifest;
}

async function inspectPdf(sourcePath) {
  const bytes = fs.readFileSync(sourcePath);
  if (!bytes.length || path.extname(sourcePath).toLowerCase() !== ".pdf") {
    fail("CAPABILITY_INTAKE_SOURCE_INVALID", "Source must be a non-empty PDF file");
  }
  let document;
  try {
    document = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch (error) {
    fail("CAPABILITY_INTAKE_PDF_INVALID", `Unable to read PDF: ${error.message}`);
  }
  return {
    fileName: path.basename(sourcePath),
    mediaType: "application/pdf",
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    pageCount: document.getPageCount(),
  };
}

async function buildCorpusRecord(options) {
  if (!options || !options.manifestPath || !options.sourcePath) {
    fail("CAPABILITY_INTAKE_ARGUMENT_MISSING", "manifestPath and sourcePath are required");
  }
  const manifest = readManifest(options.manifestPath);
  const source = await inspectPdf(options.sourcePath);
  const record = {
    id: manifest.id,
    displayName: manifest.displayName,
    source,
    provenance: manifest.provenance,
    rights: manifest.rights,
    boundaryFeatureIds: manifest.boundaryFeatureIds,
    expectedOutcomes: manifest.expectedOutcomes,
    evidenceRefs: manifest.evidenceRefs,
    storage: {
      binaryCommitted: false,
      externalSourceRequiredForRun: true,
    },
    authorityBoundary: {
      catalogRole: "regression_oracle",
      runtimeDecisionUse: "forbidden",
      finalDecisionsOwnedBy: manifest.finalDecisionsOwnedBy,
    },
  };
  validateCorpusSample(record, "intakeRecord");
  return deepFreeze(record);
}

function usage() {
  return [
    "Capability Library sample intake",
    "",
    "Usage:",
    "  node capability-library-intake.js --manifest <manifest.json> --source <paper.pdf> [--out <review-record.json>]",
    "",
    "The PDF is inspected but never copied or added to corpus.json automatically.",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.manifest || !args.source) fail("CAPABILITY_INTAKE_ARGUMENT_MISSING", "--manifest and --source are required");
  const record = await buildCorpusRecord({
    manifestPath: path.resolve(args.manifest),
    sourcePath: path.resolve(args.source),
  });
  const serialized = `${JSON.stringify(record, null, 2)}\n`;
  if (args.out) {
    const outputPath = path.resolve(args.out);
    fs.writeFileSync(outputPath, serialized, { encoding: "utf8", flag: "wx" });
    process.stdout.write(`${outputPath}\n`);
  } else process.stdout.write(serialized);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.name || "Error"} [${error.code || "CAPABILITY_INTAKE_FAILED"}]: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildCorpusRecord,
  inspectPdf,
  parseArgs,
};
