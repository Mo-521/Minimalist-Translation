# Minimalist Translation（极简翻译）

Minimalist Translation 是一款面向 Windows 的本地优先、源码可见（Source Available）翻译客户端。用户配置自己的 OpenAI-compatible Provider 后，可使用普通 PDF 与论文 PDF 翻译能力。

本仓库正在整理为 `v1.0.0`。当前阶段以本地客户端为唯一发布主体，不包含官方托管 Proxy、真实凭据、私人论文样本、内部研发治理资料或预构建二进制文件。

## 当前能力

- 普通 PDF 翻译：面向单栏普通文档，优先完整翻译正文并进行流式排版。
- 论文 PDF 翻译：识别论文结构，翻译正文，同时保留图片、公式、Caption 与 References 等科研对象。
- 统一 Provider 设置：支持 DeepSeek、OpenAI、OpenRouter、Ollama 与 Custom 等 OpenAI-compatible 服务。
- 桌面翻译：相关源码保留为实验性模块，但 Desktop Float Ball 处于冻结/延后状态，明确排除在 `v1.0.0` 二进制发布范围之外。

## 本地优先与数据边界

- Provider 配置保存在用户本机，真实配置文件不会进入 Git。
- 待翻译文本会发送到用户主动选择并连接的 Provider；除使用本地 Ollama 等本机服务外，不应将本产品理解为完全离线。
- 项目默认不依赖登录、订阅、额度、支付或官方云服务。
- 请自行了解所选 Provider 的费用、隐私政策与数据保留规则。

## 开发运行

### 环境

- Windows 10/11
- Node.js 与 npm

### 启动主客户端

```powershell
cd .\lingoflow-client\electron-app
npm install
npm start
```

首次启动后：

1. 打开 Settings。
2. 新建或选择 Provider，填写 API Key。
3. 由用户主动点击连接并确认状态为“已连接”。
4. 进入 PDF Translation，选择普通版或论文版流程。

本地配置由应用写入 `config/lingoflow.json`；该文件已被忽略。公开结构模板见 `config/lingoflow.example.json`。

### 测试

```powershell
cd .\lingoflow-client\electron-app
npm run test:pdf
```

### Windows 打包

```powershell
cd .\lingoflow-client\electron-app
npm run pack:win-dir
npm run pack:win
```

`pack:win` 生成 NSIS 安装器。v1.0.0 明确采用未签名发布策略，Windows 可能显示“未知发布者”或 SmartScreen 警告；安装前必须按 [Code Signing Policy](CODE_SIGNING_POLICY.md) 校验公开 SHA-256。

## 目录结构

```text
极简翻译1.0/
├─ config/                              # 公开配置模板与被忽略的本地配置
├─ lingoflow-client/
│  ├─ electron-app/                     # 主 Electron 客户端与 PDF pipeline
│  ├─ tests/                            # PDF pipeline 契约测试
│  └─ tools/                            # 开发和诊断工具
└─ desktop-tools/
   └─ desktop-float-ball/               # 冻结/延后的桌面悬浮翻译源码
```

托管 Proxy 已迁移为独立仓库，不属于本仓库 `v1.0.0` 源码树。`desktop-tools/` 可作为实验性源码保留，但不进入 v1.0.0 安装包、发布资产或稳定支持范围。历史商业 Server、额度、登录与订阅材料也不属于当前客户端发布范围。

内部研发治理（Governance、Context、Tasks、Decisions、Knowledge、Prompt、Skill、Agent 工作流和审计流程）属于本地私有基础设施，不进入公开仓库，也不是构建、测试或开发本客户端的依赖。

## 发布状态

- 目标仓库：<https://github.com/Mo-521/Minimalist-Translation>
- 目标版本：`v1.0.0`
- 当前状态：`v1.0.0` Release Candidate；尚未形成可信的公开 Release。

依赖安全、真实启动/翻译、Windows 打包、Tailwind 本地可复现构建、最终二进制许可证归档、代码签名策略和 Git History Reset 已全部通过。主仓库全部 Git 历史未发现真实凭据暴露，因此人工轮换不构成发布门。v1.0.0 的实际二进制为未签名状态，风险提示与校验方法见 [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md)。当前仓库已达到 v1.0.0 Release Candidate 标准；正式 `v1.0.0` tag 与 GitHub Release 尚未创建。

## 许可证

本项目使用 [Minimalist Translation Source Available Non-Commercial License 1.0](LICENSE)：允许个人、教育、学术研究、评估和其他非商业用途使用、修改与按相同条款分发；不允许商业使用。商业使用必须事先取得版权方明确的书面授权。

这是带非商业限制的 Source Available 许可证，不是 OSI 批准的开源许可证。公开源代码不等于获得商业使用权。本许可证持续有效，任何许可证变更只以版权方明确书面授权为准。第三方依赖和资产继续遵循各自许可证与 [Third-Party Notices](THIRD_PARTY_NOTICES.md)。

## 参与贡献

开发环境、提交范围和验证要求见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题请按 [SECURITY.md](SECURITY.md) 私密报告，版本变化见 [CHANGELOG.md](CHANGELOG.md)。
