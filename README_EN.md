<div align="center">

# Minimalist Translation

**A Local-first, High-fidelity Dual-column PDF Translation Desktop Client for Academia & Research**

Preserve Dual-column Layout · Lock LaTeX Formulas & Figures · References Protection · Local-first Privacy · Custom Provider Support

<br />

<img src="https://github.com/user-attachments/assets/2ce69a24-42f5-453b-a55e-b681e5f19d26" alt="Minimalist Translation Preview" width="85%" style="border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.12);" />

<br /><br />

[简体中文](README.md) | **English**

</div>

---

## ✨ Why Minimalist Translation?

Standard machine translation tools often treat academic PDFs as flat text, causing disruptive issues such as cross-column text merging, corrupted formulas, and forcefully translated author names in references.

**Minimalist Translation** decouples structural layout parsing from LLM inference, specifically optimized for complex academic literature:

- **Dual-column Layout Preservation**: Accurately recognizes column reading orders, avoiding interleaved lines across columns while writing back translated text in place.
- **Academic Objects Fidelity**: Locks LaTeX formulas, vector graphics, and figure captions to prevent visual overlaps or symbol distortions.
- **References Protection**: Automatically isolates bibliography sections, translating headings while preserving citation entries, author names, and numbering intact.
- **Local-first & Direct Connection**: No third-party relay servers. Configurations remain strictly local, communicating directly with your selected AI provider.
- **Flexible Model Integration**: Supports DeepSeek, OpenAI, OpenRouter, Qwen, and custom OpenAI-compatible endpoints, as well as local offline models via Ollama.

---

## 📥 Download & Quick Start

### 1. Download Installer

Go to [GitHub Releases](https://github.com/Mo-521/Minimalist-Translation/releases) to download the latest Windows installer (`Minimalist-Translation-Setup.exe`).

> **Note**: Current releases use an unsigned deployment policy. If Windows SmartScreen prompts "Unknown Publisher", click "More info" → "Run anyway". See [Code Signing Policy](CODE_SIGNING_POLICY.md) for SHA-256 verification details.

### 2. Getting Started

1. Launch the client and go to the **Settings** page.
2. Add or select a Provider (e.g., DeepSeek), enter your API Key, and click "Connect" to verify.
3. Switch to **PDF Translation**, drop your paper, select target language workflow, and export the translated PDF.

---

## 🛠️ Local Development & Build

For contributing to parsing algorithms or custom builds:

```powershell
# 1. Clone repository
git clone https://github.com/Mo-521/Minimalist-Translation.git
cd Minimalist-Translation

# 2. Enter Electron app directory and install dependencies
cd .\lingoflow-client\electron-app
npm install

# 3. Start development environment
npm start

# 4. Run PDF contract test suites
npm run test:pdf

# 5. Build Windows installer
npm run pack:win
```

---

## 🔒 Data & Privacy Boundaries

- **Local Config Isolation**: API Keys and configurations are stored solely on your machine and are excluded by `.gitignore`.
- **End-to-End Transmission**: Translation payloads are routed directly to your connected AI provider without proprietary cloud relays.
- **Zero Hidden Costs**: No mandatory subscriptions, proprietary accounts, or credits. Usage costs depend entirely on your chosen provider.

---

## 📄 License

This project is licensed under the Minimalist Translation Source Available Non-Commercial License 1.0:

- **Permitted**: Free use, modification, and redistribution under identical terms for personal study, academic research, and non-commercial evaluation.
- **Prohibited**: Any commercial exploitation without prior explicit written permission is strictly forbidden.

Third-party open-source dependencies remain governed by their respective licenses; see [Third-Party Notices](THIRD_PARTY_NOTICES.md).
