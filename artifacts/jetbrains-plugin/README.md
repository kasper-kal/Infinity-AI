# Infinity Build - JetBrains Plugin

A JetBrains IDE plugin for Infinity Build - AI-powered development companion with Chat, Composer, and Agent modes.

## Features

- **Chat Panel** - Conversational AI with `@codebase` context awareness
- **Composer Panel** - Multi-file task planning with diff preview
- **Agent Panel** - Autonomous coding agent with approval workflow
- **Send to Infinity** - Right-click any file/selection to send to AI
- **Configurable Settings** - API connection, models, preferences
- **Keybindings** - Customizable shortcuts for all actions
- **Real-time Updates** - WebSocket connection for live progress
- **Terminal Bridge** - Connect to local terminal bridge

## Supported IDEs

- IntelliJ IDEA (Ultimate/Community) 2023.1+
- WebStorm 2023.1+
- PyCharm (Professional/Community) 2023.1+
- GoLand 2023.1+
- Rider 2023.1+
- PhpStorm 2023.1+
- RubyMine 2023.1+
- CLion 2023.1+
- DataGrip 2023.1+
- Android Studio 2023.1+

## Building the Plugin

### Prerequisites

- JDK 17+
- Gradle 8+

### Build Commands

```bash
# Build the plugin
./gradlew buildPlugin

# Run in sandbox IDE for testing
./gradlew runIde

# Verify plugin
./gradlew verifyPlugin

# Generate plugin.xml with version
./gradlew generatePluginXml
```

The built plugin will be in `build/distributions/infinity-build-plugin-<version>.zip`

## Installation

### From Disk (Development)

1. Build the plugin: `./gradlew buildPlugin`
2. In IDE: Settings → Plugins → ⚙️ → Install Plugin from Disk
3. Select the generated ZIP file

### From Marketplace (Future)

Search for "Infinity Build" in the JetBrains Marketplace.

## Configuration

1. Open Settings → Tools → Infinity Build
2. Configure:
   - **API Base URL** - Your Infinity API server (default: http://localhost:8080)
   - **API Key** - Your Infinity API key
   - **Project ID** - The project to connect to
   - **Terminal Bridge** - WebSocket URL for terminal access

### Project-Specific Settings

Settings → Tools → Infinity Build (Project) for per-project overrides.

## Keybindings

Default keybindings (customizable in Settings → Keymap):

| Action | Shortcut |
|--------|----------|
| Open Chat | `Ctrl+Alt+I` |
| Open Composer | `Ctrl+Alt+O` |
| Open Agent | `Ctrl+Alt+A` |
| Send Selection to Infinity | `Ctrl+Alt+S` |
| Refresh Tool Window | `Ctrl+Alt+R` |

## Usage

### Chat Panel
- Ask questions about your codebase using `@codebase` context
- Switch between chat, build, composer, agent modes
- View conversation history

### Composer Panel
- Describe a multi-file task
- Generate a plan with file-by-file diffs
- Selectively apply changes

### Agent Panel
- Set a high-level goal
- Watch autonomous execution with step-by-step log
- Approve/reject/modify steps in real-time

### Context Menu
- Right-click in editor → Send to Infinity
- Right-click in Project View → Send to Infinity

## Development

### Project Structure

```
src/main/kotlin/com/infinity/build/
├── InfinityPlugin.kt              # Main plugin entry point
├── settings/
│   ├── InfinitySettingsState.kt   # Global settings
│   └── InfinityProjectSettingsConfigurable.kt  # Project settings
├── api/
│   └── InfinityApiClient.kt       # REST + WebSocket client
├── ui/
│   ├── InfinityToolWindowFactory.kt  # Tool window with tabs
│   ├── ChatPanel.kt               # Chat sidebar
│   ├── ComposerPanel.kt           # Multi-file planner
│   ├── AgentPanel.kt              # Autonomous agent
│   └── ToolWindowCondition.kt     # Visibility condition
└── actions/
    ├── ChatAction.kt
    ├── ComposerAction.kt
    ├── AgentAction.kt
    ├── SendToInfinityAction.kt
    ├── SettingsAction.kt
    └── RefreshAction.kt
```

### Adding New Features

1. Create UI component in `ui/`
2. Add action in `actions/`
3. Register in `plugin.xml`
4. Add keybinding in `plugin.xml`

## API Integration

The plugin connects to the Infinity API server which provides:

- `/api/infinity-ai/chat/*` - Chat endpoints
- `/api/infinity/build/*` - Build orchestration
- `/api/infinity/composer/*` - Composer planning
- `/api/infinity/agent/*` - Agent execution
- `/api/infinity/codebase/*` - Codebase indexing
- WebSocket `/api/infinity-ai/ws` - Real-time events

## License

MIT License - See LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `./gradlew buildPlugin verifyPlugin`
5. Submit a PR

## Support

- Issues: https://github.com/kasper-kal/Infinity-AI/issues
- Documentation: https://github.com/kasper-kal/Infinity-AI/docs