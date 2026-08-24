# Infinity Build

**Infinity AI Build Panel** - Build, debug, and deploy applications directly from VS Code with AI-powered multi-agent orchestration.

## 🚀 Features

### Build Panel (Sidebar View)
- **4 Tabs**: Build, Terminal, Diagnostics, Settings
- **Build Goal Input** - Describe what you want to build in natural language
- **Real-time Build Events** - Live streaming of build steps, file changes, errors
- **Project Info Display** - Shows current project name, ID, path, and framework

### Terminal Integration
- **Multiple Terminal Sessions** - Create, switch, resize, close terminals
- **Quick Commands** - One-click common commands (git status, npm install, etc.)
- **WebSocket Bridge** - Connects to local terminal bridge (`ws://localhost:3001`) for real shell access
- **MCP Server Support** - Run MCP stdio servers through the terminal bridge

### Diagnostics Panel
- **VS Code Problems Panel Integration** - Diagnostics appear inline in editor
- **Grouped by File** - Expand/collapse per-file diagnostic lists
- **Severity Filtering** - Error, Warning, Info, Hint with color coding
- **Click to Open** - Click any diagnostic to open the file at the exact line

### File Synchronization
- **Bidirectional Sync** - Changes in VS Code → Infinity workspace, and vice versa
- **FileSystemWatcher** - Real-time file change detection
- **Sync Status** - Visual indicator in status bar

### "Send to Infinity" Context Menu
- Right-click any file/folder in Explorer or Editor
- Select "Send to Infinity Build"
- Opens Infinity chat with file context pre-loaded

### Commands & Keybindings
| Command | Keybinding | Description |
|---------|------------|-------------|
| `Infinity: Open Build Panel` | `Ctrl+Shift+I` / `Cmd+Shift+I` | Open the Infinity Build sidebar |
| `Infinity: Send to Infinity` | `Ctrl+Shift+Alt+I` / `Cmd+Shift+Alt+I` | Send current file to Infinity chat |
| `Infinity: Open Terminal` | - | Create new terminal session |
| `Infinity: Sync Files` | - | Manually sync workspace files |
| `Infinity: Refresh Build Panel` | - | Reconnect to API server |

### Settings
Configure via VS Code Settings (`Ctrl+,` → search "Infinity"):
- **API Server URL** - Infinity backend URL (default: `http://localhost:3000`)
- **Project ID** - Current project (auto-detected if empty)
- **Terminal Bridge URL** - WebSocket URL for terminal (default: `ws://localhost:3001`)
- **Enable File Sync** - Watch and sync file changes
- **Show Diagnostics** - Display diagnostics in Problems panel

## 📦 Requirements

- **VS Code 1.85+**
- **Infinity API Server** running locally or remotely
- **Terminal Bridge** (optional, for terminal features): `npx infinity-terminal-bridge`

## 🔧 Setup

1. Install the extension from VS Code Marketplace
2. Start your Infinity API server: `npm run dev` (or deployed URL)
3. (Optional) Start terminal bridge: `npx infinity-terminal-bridge`
4. Open a workspace folder in VS Code
5. Click the **Infinity** icon (∞) in the Activity Bar
6. Configure API URL in settings if not using localhost

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code Extension                        │
├─────────────────────────────────────────────────────────────┤
│  Webview (React)          │  Extension Host (Node.js)       │
│  ┌─────────────────────┐  │  ┌───────────────────────────┐  │
│  │ BuildPanel          │  │  │ InfinityBuildProvider     │  │
│  │ ├─ Toolbar          │  │  │ ├─ WebSocket to API       │  │
│  │ ├─ TabBar           │  │  │ ├─ WebSocket to Terminal  │  │
│  │ ├─ Build Tab        │  │  │ ├─ FileSystemWatcher      │  │
│  │ ├─ Terminal Tab     │  │  │ ├─ DiagnosticCollection   │  │
│  │ ├─ Diagnostics Tab  │  │  │ └─ Command Handlers       │  │
│  │ └─ Settings Tab     │  │  └───────────────────────────┘  │
│  └─────────────────────┘  └──────────────────────────────────┘
└─────────────────────────────────────────────────────────────┘
           │                                    │
           │ WebSocket                          │ WebSocket
           ▼                                    ▼
    ┌─────────────┐                    ┌─────────────────┐
    │ Infinity API│                    │ Terminal Bridge │
    │  Server     │                    │  (node-pty)     │
    │  :3000      │                    │  :3001          │
    └─────────────┘                    └─────────────────┘
```

## 🔐 Security

- **Shared Secret Authentication** - Terminal bridge uses `.infinity/bridge-secret`
- **Localhost Only** - Terminal bridge binds to 127.0.0.1 by default
- **VS Code Secrets API** - API keys stored securely in VS Code keychain
- **No Telemetry** - Zero data collection

## 🛠 Development

```bash
# Install dependencies
npm install

# Development build with watch
npm run watch

# Production build
npm run compile
npm run package

# Package .vsix for publishing
vsce package --no-dependencies
```

## 📝 Extension Structure

```
artifacts/vscode-extension/
├── src/
│   ├── extension.ts          # Main extension entry point
│   └── webview/
│       ├── main.tsx          # Webview entry point
│       ├── BuildPanel.tsx    # Main panel with 4 tabs
│       ├── components/
│       │   ├── Toolbar.tsx       # Connection, project selector, build controls
│       │   ├── TabBar.tsx        # Tab navigation
│       │   ├── Terminal.tsx      # xterm-style terminal with tabs
│       │   ├── BuildEvents.tsx   # Build event log with filtering
│       │   ├── DiagnosticsPanel.tsx # Diagnostics grouped by file
│       │   ├── ProjectInfo.tsx   # Project details display
│       │   └── SettingsPanel.tsx # Configuration UI
│       └── styles.css        # VS Code theme-aware styles
├── media/
│   ├── icon.png              # Extension icon (128x128)
│   └── infinity-icon.svg     # Activity bar icon
├── esbuild.config.mjs        # Dual build config (Node + Browser)
├── tsconfig.json             # TypeScript config
└── package.json              # Extension manifest
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run compile` and verify no TypeScript errors
5. Submit a PR

## 📄 License

MIT License - see [LICENSE](https://github.com/kasper-kal/Infinity-AI/blob/main/LICENSE)

## 🔗 Links

- **GitHub**: https://github.com/kasper-kal/Infinity-AI
- **Issues**: https://github.com/kasper-kal/Infinity-AI/issues
- **Infinity AI**: https://github.com/kasper-kal/Infinity-AI#readme