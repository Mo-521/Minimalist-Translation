# Changelog

本项目的公开版本变化记录在此文件中。格式参考 Keep a Changelog，版本号遵循 Semantic Versioning。

## [Unreleased]

暂无。

## [1.0.0] - 2026-08-28

- 完成公开仓库与本地私有研发治理的边界拆分。
- 将目标公开发布基线统一迁移为 `v1.0.0`。
- 引入 `Minimalist Translation Source Available Non-Commercial License 1.0`，明确非商业授权、商业使用需书面许可，许可证变更仅以版权方明确书面授权为准。
- 新增 `THIRD_PARTY_NOTICES.md`，完成 npm 依赖、字体、图标与静态资源的许可证审计；Desktop 已排除出 v1.0.0 二进制，Tailwind 已改为本地固定构建，第三方合规仅剩最终二进制许可证归档。
- 将 `v1.0.0` 推进到 Release Candidate；仅保留最终二进制许可证归档、代码签名策略、人工凭据轮换和 Git History Reset 四个发布门。
- 完成最终 Windows 二进制许可证归档：按实际 ASAR 核对 30 个 npm 组件及 Electron/Chromium notices，未知许可证为 0，并生成绑定安装包 SHA-256 的发布附件；剩余发布门收敛为代码签名策略、人工凭据轮换和 Git History Reset。
- 明确 v1.0.0 采用未签名 Windows 发布策略；新增 `CODE_SIGNING_POLICY.md`，公开未知发布者/SmartScreen 风险、安装包和许可证归档 SHA-256 及验证方法。代码签名策略 Gate 关闭。
- 完成主仓库全部 refs/commits 的最终凭据审计：历史配置仅含空值、测试值和非凭据端点，高置信度秘密命中 0；人工凭据轮换 Gate 标记为 `Not Required / No real credential exposure found`，仅剩 Git History Reset。
- 建立不继承商业化、中文旧目录或私有治理资产的单根公开 Git 历史，并从干净克隆重新完成依赖安装、语法检查、128 项 PDF 测试、npm audit、Tailwind 构建、NSIS 打包和安装态启动验证。
- 新增 `SECURITY.md`，建立预发布支持状态、私密漏洞报告、敏感材料最小化、披露和凭据暴露处置边界。
- 对齐 README、CONTRIBUTING 与发布状态说明，明确本项目为 Source Available 而非 OSI 批准的开源项目。
- Desktop Float Ball 保持实验性、冻结和延后状态。
- 正式将 Desktop Float Ball 排除在 v1.0.0 安装包、二进制发布资产和稳定支持范围之外；源码与未完成状态继续保留。
- 将 Tailwind CSS 3.4.17 与 forms/container-query 插件固定为本地构建依赖，移除运行时 CDN 脚本；启动和打包前生成本地 `tailwind.css`，保持现有配置与视觉 utility 不变。
- 托管 Proxy 保持独立仓库，不属于客户端发布树。
- 将公开候选中的产品目录统一为英文：主客户端为 `lingoflow-client/`，实验性桌面模块为 `desktop-tools/`，并同步全部有效路径引用。
- 升级主客户端与实验性 Desktop 的 Electron/构建依赖、PDF.js、DOCX 与 WebSocket 依赖；两套 npm lockfile 的 `npm audit` 均为 0 个已知漏洞。
- 建立主客户端 Windows NSIS 打包配置；完成 unpacked 构建启动烟测并生成 `Minimalist-Translation-Setup-1.0.0.exe`。当前安装包尚未进行发布证书签名。

### Added

- Windows 本地优先 Electron 客户端。
- 普通 PDF 与论文 PDF 翻译工作流。
- 用户自有 OpenAI-compatible Provider 配置。
- Source Available 非商业许可与一致的贡献边界。

### Release

- 创建正式 `v1.0.0` Git tag 与 GitHub Release。
- 发布未签名 Windows 安装包 `Minimalist-Translation-Setup-1.0.0.exe`，SHA-256：`172BB855628555C4CBA06682C4AF4EA23987027E2BC5781000DD64E20475B9CA`。
- 发布第三方许可证归档 `Minimalist-Translation-1.0.0-Third-Party-Licenses.zip`，SHA-256：`A731996A644CBE549C66A707107836D1A61361EF50548E3C2F6A9CB432BBD89A`。
