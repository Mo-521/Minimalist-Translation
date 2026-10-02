<div align="center">

# Minimalist Translation (极简翻译)

**专为学术科研与专业排版打造的本地优先双栏 PDF 翻译客户端**

保留原始双栏排版 · 锁定 LaTeX 公式与图表 · 参考文献免译保护 · 本地优先隐私安全 · 自定义模型接入

<br />

<img src="https://github.com/user-attachments/assets/2ce69a24-42f5-453b-a55e-b681e5f19d26" alt="极简翻译界面预览" width="85%" style="border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.12);" />

<br /><br />

**简体中文** | [English](README_EN.md)

</div>

---

## ✨ 为什么选择极简翻译？

市面上常规翻译工具在处理学术论文时，常出现左右栏文字混排串行、数学公式被乱翻破坏、参考文献作者名强行直译等问题。

**极简翻译**将版面语义提取与大模型翻译解耦，针对学术与复杂文献排版做了专门优化：

- **双栏排版还原**：智能识别论文版面阅读流，避免左右栏混排串行，原位回写译文。
- **科研对象锁定**：数学公式、矢量插图、Figure Caption 均予以锁定保留，防止公式变形或图片遮挡。
- **参考文献保护**：自动识别 References 区域，翻译章节标题并完整保留引文条目原文与编号。
- **本地优先与直连**：不上传到第三方中转云服务，配置均保存在本机，直连用户配置的模型服务商。
- **自由挂接模型**：支持接入 DeepSeek、OpenAI、OpenRouter、阿里百炼等 OpenAI-compatible 服务，亦可连接本地 Ollama 离线运行。

---

## 📥 下载与使用

### 1. 下载安装包

前往 [GitHub Releases](https://github.com/Mo-521/Minimalist-Translation/releases) 下载最新版本的 Windows 安装器（`Minimalist-Translation-Setup.exe`）。

> **提示**：安装包当前采用未签名发布策略，若 Windows SmartScreen 提示“未知发布者”，点击“更多信息” → “仍要运行”即可。详情可核对 [Code Signing Policy](CODE_SIGNING_POLICY.md)。

### 2. 快速上手

1. 启动客户端，进入 **Settings（设置）** 页面。
2. 新建或选择 Provider（如 DeepSeek），填入 API Key 并点击连接验证。
3. 进入 **PDF Translation（PDF 翻译）** 页面，拖入待翻译的论文，选择流程开始翻译并导出。

---

## 🛠️ 本地开发与构建

如需参与排版算法改进或二次开发：

```powershell
# 1. 克隆代码仓库
git clone https://github.com/Mo-521/Minimalist-Translation.git
cd Minimalist-Translation

# 2. 进入 Electron 客户端目录并安装依赖
cd .\lingoflow-client\electron-app
npm install

# 3. 启动开发环境
npm start

# 4. 运行 PDF 契约回归测试
npm run test:pdf

# 5. 打包 Windows 安装程序
npm run pack:win
```

---

## 🔒 数据与隐私边界

- **本地配置隔离**：Provider API Key 与个人配置仅保存在本地，真实配置文件已被 Git 忽略。
- **端到端传输**：待翻译文本直接发送至用户主动连接的模型接口，不存在官方托管代理。
- **无隐形收费**：项目不附带任何官方账号体系、额度充值或强制订阅，调用成本完全取决于用户自选的 Provider。

---

## 📄 许可证说明

本项目采用 Minimalist Translation Source Available Non-Commercial License 1.0：

- **允许**：个人学习、学术研究、教学评估等非商业用途免费使用、修改及按相同条款分发。
- **限制**：严禁未经书面许可用于任何商业营利场景。

第三方开源依赖继续遵循其各自的独立授权协议，详见 [Third-Party Notices](THIRD_PARTY_NOTICES.md)。
