"use strict";

// Current-PDF evidence adapter. The caller supplies a Python runtime with
// pdfplumber and a writable run directory. No shell or Task artifact is used.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const scripts = path.join(__dirname, "pdf-evidence");

// Electron's Node fs can read app.asar, but an external Python process needs
// the physical copy produced by asarUnpack.
function physicalScriptPath(scriptPath) {
  return scriptPath.replace(/([\\/])app\.asar([\\/])/i, "$1app.asar.unpacked$2");
}

function createEvidenceRunner({ python, runDirectory }) {
  if (!python || !fs.existsSync(python)) throw Error("PDF evidence requires a Python executable");
  if (!runDirectory || !fs.statSync(runDirectory).isDirectory())
    throw Error("PDF evidence requires an existing run directory");
  let sequence = 0;
  return function derive(script, inputs, switches = []) {
    const scriptPath = physicalScriptPath(path.join(scripts, script));
    if (!/^[a-z0-9-]+\.py$/.test(script) || !fs.existsSync(scriptPath))
      throw Error(`Unknown PDF evidence producer: ${script}`);
    const prefix = String(++sequence).padStart(2, "0");
    const args = [scriptPath];
    for (const [key, value] of Object.entries(inputs)) {
      if (value == null) throw Error(`Missing PDF evidence input: ${script}:${key}`);
      const inputPath = path.join(runDirectory, `${prefix}-${key}.json`);
      fs.writeFileSync(inputPath, JSON.stringify(value));
      args.push(`--${key}`, inputPath);
    }
    args.push(...switches);
    const outputPath = path.join(runDirectory, `${prefix}-${path.basename(script, ".py")}.json`);
    args.push("--output", outputPath);
    const result = spawnSync(python, args, { encoding: "utf8", timeout: 300000,
      maxBuffer: 16 * 1024 * 1024 });
    if (result.error || result.status !== 0)
      throw Error(`PDF evidence ${script} failed: ${result.error || result.stderr || result.stdout}`);
    return JSON.parse(fs.readFileSync(outputPath, "utf8"));
  };
}

module.exports = { createEvidenceRunner, physicalScriptPath };
