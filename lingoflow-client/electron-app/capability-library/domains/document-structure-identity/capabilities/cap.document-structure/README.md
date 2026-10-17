# cap.document-structure（D1）

状态：`pilot_ready`，不代表任意 PDF 均已通过或旧翻译链已切换。权威状态见本目录 `capabilities.json` 与已归档 canonical Task。

本目录只保留当前能力：`offline/` 从真实 PDF 生产 Object-first 结构，`integration/` 提供正式契约及 Electron 独立调用；`batches/B001/` 是十篇、126 页已接受候选的最小冻结回归，`corpus.json` 登记样本身份。应用的翻译、排版、遮盖和导出仍使用旧链，不消费 D1 候选。D1 不拥有 Column/Geometry 的栏位或空间事实，也不决定写入区域。

首轮能力建设、审核转折、独立应用接入、测试和已知限制统一见 [`batches/B001/README.md`](batches/B001/README.md)。Batch 不存第二份正式代码、PDF 或逐页审核稿。运行契约见 [`offline/INPUT_OUTPUT_CONTRACT.md`](offline/INPUT_OUTPUT_CONTRACT.md)，应用接入与外部工具条件见 [`integration/README.md`](integration/README.md)。

最小复核：在本目录运行 `node batches/B001/verify.cjs`，以及 `node --test integration/object-first-contract.test.cjs offline/inherited-stage35-82.test.cjs offline/source-formula-stage35.test.cjs`。这些验证不等于新论文的语义泛化验收；缺失原历史附件时，也不能重放所有旧 Stage 中间结果。
