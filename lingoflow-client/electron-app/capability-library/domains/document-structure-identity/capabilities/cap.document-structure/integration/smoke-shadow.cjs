"use strict";

// Exercises the same non-authoritative worker used by main.js, outside the UI.
const fs = require("node:fs");
const path = require("node:path");
const { scheduleShadowForPdf, REPORT } = require("./shadow-runtime.cjs");

async function smoke(pdfPath, python, pdftoppm, runRoot) {
  const env = { LINGOFLOW_OBJECT_FIRST_SHADOW: "1",
    LINGOFLOW_OBJECT_FIRST_SHADOW_PYTHON: python,
    LINGOFLOW_OBJECT_FIRST_SHADOW_PDFTOPPM: pdftoppm,
    LINGOFLOW_OBJECT_FIRST_SHADOW_RUN_ROOT: runRoot };
  const scheduled = scheduleShadowForPdf(pdfPath, { env });
  if (scheduled.status !== "scheduled_non_authoritative")
    throw Error(`Shadow not scheduled: ${scheduled.status}`);
  const reportPath = path.join(scheduled.runDirectory, REPORT);
  const deadline = Date.now() + 300000;
  while (!fs.existsSync(reportPath)) {
    if (Date.now() > deadline) throw Error(`Shadow timed out: ${scheduled.runDirectory}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  if (report.status !== "completed_not_semantically_accepted")
    throw Error(`Shadow failed: ${report.error || report.status}`);
  return { runDirectory: scheduled.runDirectory, report };
}

if (require.main === module) {
  smoke(process.argv[2], process.argv[3], process.argv[4], process.argv[5])
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}

module.exports = { smoke };
