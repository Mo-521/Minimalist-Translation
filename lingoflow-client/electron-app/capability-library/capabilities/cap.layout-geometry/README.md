# cap.layout-geometry

This is an offline Evidence-only capability. `reviewed-v8/` freezes the user-confirmed paper1–10 Body and non-Body exports (126 pages). Each JSON retains separate `predicted` and `corrected` boxes; `FREEZE_MANIFEST.json` binds every copied file to its original source hash. PDFs and page rasters are not copied here.

The formal `corpus.json` now contains ten explicitly promoted paper1–10 samples. Each sample is linked to its promoted Candidate and validated Oracle; four versioned Oracle revisions (paper1/2/5/8) are preserved under `oracles/revisions/2026-09-30/` alongside the unchanged earlier Oracles. The current paper1–10/126-page producer comparison against the promoted truth reports **0 identity, structural, or tolerance findings**. The earlier v8 comparison findings remain historical evidence, not the current formal baseline. Shared-source identity permits distinct capabilities to reference the same PDF while forbidding duplicate truth within one capability.

The capability status remains `pilot_ready`, not `covered`: formal Evidence/corpus promotion does **not** authorize runtime decisions. `runtimeDecisionUse` remains `forbidden`; Column truth stays read-only, and the linked Geometry Issue has its own lifecycle. See the Audit Task's `EVD-20260930-GEOMETRY-V9-FORMAL-PROMOTION` and `evidence/geometry-v9-formal-regression.json` for the promotion and current regression evidence.

The latest editable review HTML and the copied JSON remain visual and review provenance; the frozen v8 exports were not rewritten by the later versioned truth revisions. See `reviewed-v8/FREEZE_MANIFEST.json` for exact source and review hashes.
