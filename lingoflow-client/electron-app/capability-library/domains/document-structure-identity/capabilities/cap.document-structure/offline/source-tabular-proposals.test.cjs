"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { proposeTabularRegions } = require("./source-tabular-proposals.cjs");
const line = (id, text, x, y, width) => ({ id, text, column: "single",
  bbox: { x, y, width, height: 10 } });

test("dense aligned numeric rows form one opaque candidate, caption stays separate", () => {
  const page = { width: 600, lines: [
    line("body", "The estimated risks are summarized in the following table.", 70, 100, 460),
    line("head", "α = 1 α = 0.5 α = 0.2 α = 0.1 α = 0.05", 150, 140, 350),
    line("r1", "γ = 0.25 6.52 2.54 16.75 6.14 2.60 16.90", 95, 152, 405),
    line("r2", "0.5 6.20 2.52 17.16 5.82 2.57 17.35", 115, 164, 385),
    line("r3", "1 5.84 2.50 17.65 5.56 2.55 17.75", 120, 176, 380),
    line("r4", "2 5.53 2.48 18.10 5.33 2.54 18.08", 120, 188, 380),
    line("cap", "Table 1: Risks for the misspecified model.", 205, 210, 185),
    line("after", "The next example follows below.", 70, 245, 350)
  ] };
  const regions = proposeTabularRegions(page);
  assert.equal(regions.length, 1);
  assert.deepEqual(regions[0].sourceLineIds, ["head", "r1", "r2", "r3", "r4"]);
  assert.equal(regions[0].captionSourceLineId, "cap");
});

test("an equation followed by a table mention is not a table region", () => {
  const page = { width: 600, lines: [
    line("a", "x = y + 2", 230, 120, 110),
    line("b", "z = x + 3", 230, 145, 110),
    line("c", "Table 2: Summary of the results.", 180, 175, 240)
  ] };
  assert.deepEqual(proposeTabularRegions(page), []);
});
