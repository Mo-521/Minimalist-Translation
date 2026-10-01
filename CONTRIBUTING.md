# Contributing

感谢参与 Minimalist Translation。

## 许可边界

提交贡献即表示你有权提交相关内容，并同意该贡献作为项目的一部分按 [Minimalist Translation Source Available Non-Commercial License 1.0](LICENSE) 提供。该许可证允许非商业使用、修改和按相同条款分发，不授权商业使用。

这是 Source Available 非商业项目，不是 OSI 批准的开源项目。本许可证持续有效；商业使用、许可证变更或其他授权必须由版权方另行明确书面批准。第三方代码、字体、图标和其他资产必须保留其原始许可证与 attribution，不得以项目 LICENSE 覆盖。

## 开发范围

公开仓库只包含产品构建、运行、测试和发布直接需要的内容。请勿提交本地配置、真实 API Key、私人 PDF、生成产物、内部 Governance、Prompt、Skill、Agent 工作流或审计过程资料。

Desktop Float Ball 当前为实验性、冻结模块，已排除在 v1.0.0 安装包之外，也不进入 v1.1.0 候选安装包。未经明确任务授权，不应把它描述为稳定能力，也不应借普通修复扩展其范围。任何未来二进制纳入都必须先完成独立功能、安全、Python 锁定和 LGPL 合规审计。托管 Proxy 在独立仓库维护。

## 本地开发

```powershell
cd .\lingoflow-client\electron-app
npm install
npm start
```

公开配置结构位于 `config/lingoflow.example.json`。请通过应用 Settings 生成本地 `config/lingoflow.json`，不要提交真实凭据。

## 提交前验证

```powershell
cd .\lingoflow-client\electron-app
node --check main.js
node --check renderer.js
npm run test:pdf
```

提交应保持改动范围单一，不包含样本、页码、文本、坐标或 Segment ID 特判，不降低现有 Validator、Fail-fast 或测试标准。

## Pull Request

- 说明问题、改动范围和验证结果。
- 披露尚未验证的内容与兼容风险。
- UI、Pipeline、Provider 或持久化行为发生变化时，明确列出用户可感知影响。
- 不要求也不引用维护者的本地私有治理目录；公开源码本身必须能够独立构建和测试。
- 确认贡献不引入与本项目 Source Available 非商业分发冲突的第三方许可条件。

## 安全问题

疑似漏洞、真实凭据、私人 PDF、利用代码或含敏感信息的日志不得提交到公开 Issue 或 Pull Request。请遵循 [SECURITY.md](SECURITY.md) 使用 GitHub Private Vulnerability Reporting；若私密报告功能尚未启用，只创建不包含技术细节的最小 Issue 请求私密渠道。
