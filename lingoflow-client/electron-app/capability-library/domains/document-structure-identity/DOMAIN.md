# 文档结构与身份

- ID: `document-structure-identity`
- Order: 1
- Responsibility: 组织结构判定、对象身份与阅读顺序相关的 Capability 和验收契约。

This Domain is organization-only. `cap.document-structure` is a `pilot_ready` independent Capability under `capabilities/`, with first-batch regression and review evidence. Its separate application action runs on real PDFs and returns non-authoritative Object-first candidates; it does not replace the legacy translation-chain Structure producer or establish Stable coverage. `cap.semantic-structure` and `cap.paragraph-object-identity` remain acceptance contracts in `registry/capabilities.json`; no Object Identity Capability is established.
