## desktop-float-ball (独立小项目)

这个目录是一个独立重构实验，不改动主项目。

- 前端：`electron-app/`
  - 只负责启动器 UI 和悬浮框 UI
  - 管理 Python 后端进程
  - 接收后端结果并创建新的独立 bubble 窗口
- 后端：`python-backend/`
  - 只负责鼠标监听、划词取词、翻译
  - 通过本地 WebSocket (`ws://127.0.0.1:8765`) 把结果推送给 Electron

### 目录结构

```text
desktop-float-ball/
├─ electron-app/
│  ├─ package.json
│  ├─ main.js
│  ├─ preload.js
│  └─ renderer/
│     ├─ launcher.html
│     ├─ launcher.css
│     ├─ launcher.js
│     ├─ bubble.html
│     ├─ bubble.css
│     └─ bubble.js
├─ python-backend/
│  ├─ main.py
│  ├─ selection_service.py
│  ├─ translator.py
│  └─ requirements.txt
└─ README.md
```

### 运行方式（第一版）

1. 安装 Python 依赖：
   - `cd python-backend`
   - `pip install -r requirements.txt`
2. 安装 Electron 依赖：
   - `cd ../electron-app`
   - `npm install`
3. 启动：
   - `npm start`

### Windows 测试打包（Electron + 内置 Python 后端）

#### 1) 打包 Python 后端为 exe

```bash
cd python-backend
pip install -r requirements.txt
pip install pyinstaller
pyinstaller --noconfirm --clean --onefile --name python-backend main.py
```

生成文件：
- `python-backend/dist/python-backend.exe`

复制到 Electron 固定目录：
- `electron-app/backend/python-backend.exe`

#### 2) 打包 Electron Windows 测试版

```bash
cd ../electron-app
npm install
npm run pack:win
```

产物目录：
- `electron-app/dist/`

#### 3) 运行模式说明

- 开发模式（`npm start`）：Electron 启动 `python-backend/main.py`（依赖本机 Python）。
- 打包模式（安装包/产物）：Electron 优先启动内置 `backend/python-backend.exe`（不依赖测试机安装 Python）。
# desktop-float-ball

仓库内**新建的悬浮翻译子项目目录**，与现有 Electron / `python-agent` **无代码耦合**。

## 当前进度

仅完成 **launcher 第一版**：极简桌面启动器，负责拉起或停止同目录下的 `main.py`，并用文案表示是否在运行。

## 已支持

- 点击 **「使用翻译」** → 启动 `main.py`，按钮变为 **「运行中」**
- 点击 **「运行中」** → 停止 `main.py**，按钮恢复 **「使用翻译」**
- 标题栏可拖拽移动窗口；最小化、关闭 launcher
- 关闭 launcher 时**一并终止** `main.py`，避免孤儿进程
- 若 `main.py` 自行退出，launcher 会轮询并把状态恢复为「使用翻译」

## 尚未实现

- 划词翻译、贴边翻译窗、悬浮球、托盘、设置、配额、多语言
- 与 Electron / FastAPI / 现有 `python-agent` 的对接

## 如何运行

在项目根目录下进入本目录后执行：

`python launcher.py`

（需本机已安装 Python；`main.py` 仅作占位进程，无独立窗口。）
