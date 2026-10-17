"use strict";

// Evidence-only mapping from derived source units back to observed runtime lines.
// Never invents ownership, semantic types or geometry. Ambiguous matches fail closed.
function signature(line) {
  const b = line.bbox || {};
  return JSON.stringify([Number(line.page), String(line.text || "").trim(),
    Number(b.x), Number(b.y), Number(b.width), Number(b.height)]);
}

function bridgeSourceLines(runtimeLines, derivedLines) {
  if (!Array.isArray(runtimeLines) || !Array.isArray(derivedLines)) throw Error("Source bridge requires line arrays");
  const byId = new Map(), bySignature = new Map();
  for (const line of runtimeLines) {
    const id = line.id || line.sourceLineId;
    if (!id || byId.has(id)) throw Error(`Runtime source ID missing or repeated: ${id}`);
    byId.set(id, line);
    const key = signature(line), bucket = bySignature.get(key) || [];
    bucket.push(id); bySignature.set(key, bucket);
  }
  const matches = [], unresolved = [];
  for (const line of derivedLines) {
    const derivedId = line.sourceLineId;
    if (!derivedId) throw Error("Derived source ID missing");
    let runtimeId, kind;
    if (byId.has(derivedId)) { runtimeId = derivedId; kind = "direct_id"; }
    else if (line.parentSourceLineId && byId.has(line.parentSourceLineId)) {
      runtimeId = line.parentSourceLineId; kind = "declared_split_parent";
    } else {
      const candidates = bySignature.get(signature(line)) || [];
      if (candidates.length === 1) { runtimeId = candidates[0]; kind = "unique_exact_text_and_geometry"; }
    }
    if (runtimeId) matches.push({ derivedId, runtimeId, kind });
    else unresolved.push({ derivedId, page: line.page, reason: "no_unique_id_parent_or_exact_geometry_match" });
  }
  return { matches, unresolved, counts: {
    derived: derivedLines.length,
    direct: matches.filter(match => match.kind === "direct_id").length,
    declaredSplitParent: matches.filter(match => match.kind === "declared_split_parent").length,
    uniqueExactTextAndGeometry: matches.filter(match => match.kind === "unique_exact_text_and_geometry").length,
    unresolved: unresolved.length
  } };
}

module.exports = { bridgeSourceLines };
