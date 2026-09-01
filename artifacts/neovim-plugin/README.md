# Infinity.nvim

> **AI-native IDE features for Neovim** — Chat, Composer, Agent, Tab Autocomplete, Code Review, and Codebase Indexing. Inspired by Cursor, Claude Code, and v0.

[![Neovim](https://img.shields.io/badge/Neovim-0.9%2B-green.svg)](https://neovim.io/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Lua](https://img.shields.io/badge/Lua-5.1%2B-blue.svg)](https://www.lua.org/)

## ✨ Features

| Feature | Description |
|---------|-------------|
| **Chat** | Conversational coding with `@codebase` context, `@file` attachments, streaming responses |
| **Composer** | Multi-file task planning with Plan/Diff/Files tabs, selective diff application |
| **Agent** | Autonomous coding with timeline, context panel, checkpoints, approval prompts |
| **Tab Autocomplete** | Multi-line, context-aware completions via nvim-cmp with local WASM fallback |
| **Code Review** | AI-powered review of diffs/PRs with inline comments and suggestions |
| **Codebase Indexing** | Semantic search powering `@codebase` — Tree-sitter, local embeddings, hybrid search |

## 📦 Installation

### Requirements
- **Neovim 0.9+**
- **plenary.nvim** (required for HTTP/WebSocket)
- **Infinity API server** running at `http://localhost:8080` (or your configured URL)

### Optional Dependencies
- **telescope.nvim** or **fzf-lua** — for file picking in chat
- **nvim-cmp** — for Tab autocomplete
- **which-key.nvim** — for keymap help
- **nvim-web-devicons** — for file icons

### Using lazy.nvim (Recommended)

```lua
{
  "Infinity-AI/infinity.nvim",
  dir = "~/path/to/infinity.nvim",  -- local path, or use git URL when published
  dependencies = {
    "nvim-lua/plenary.nvim",
    "nvim-telescope/telescope.nvim",  -- optional
    "hrsh7th/nvim-cmp",                -- optional
    "folke/which-key.nvim",            -- optional
  },
  config = function()
    require("infinity").setup({
      api_url = "http://localhost:8080",
      project_id = "my-project",  -- optional, auto-detected from git root
    })
  end,
}
```

### Using packer.nvim

```lua
use {
  "Infinity-AI/infinity.nvim",
  requires = { "nvim-lua/plenary.nvim" },
  config = function()
    require("infinity").setup({ api_url = "http://localhost:8080" })
  end,
}
```

### Native Package Loading (Neovim 0.10+)

```bash
git clone https://github.com/Infinity-AI/infinity.nvim \
  ~/.local/share/nvim/site/pack/infinity/start/infinity.nvim
```

Then in `init.lua`:
```lua
require("infinity").setup({ api_url = "http://localhost:8080" })
```

## ⚙️ Configuration

```lua
require("infinity").setup({
  -- API Connection
  api_url = "http://localhost:8080",
  project_id = nil,        -- auto-detected from git root
  api_key = nil,           -- optional, uses session cookie

  -- UI Windows
  ui = {
    chat = { width = 0.4, height = 0.8, position = "right" },
    composer = { width = 0.5, height = 0.8, position = "right" },
    agent = { width = 0.5, height = 0.8, position = "right" },
    review = { width = 0.6, height = 0.8, position = "right" },
  },

  -- Keybindings (prefix: <leader>i)
  keymaps = {
    enabled = true,
    prefix = "<leader>i",
    chat = "c", composer = "C", agent = "a",
    review = "r", index = "i", toggle = "t",
  },

  -- Features
  autocomplete = { enabled = true, trigger_on_tab = true },
  indexing = { auto_index = true, watch_files = true },
})
```

See `:help infinity-configuration` for all options.

## 🚀 Quick Start

1. **Start Infinity API server** (see [Infinity Platform](https://github.com/Infinity-AI/Infinity-AI))
2. **Open a project** in Neovim
3. **Run `:InfinityChat`** or press `<leader>ic`
4. **Try `@codebase`**: Type `@codebase How does auth work?` and press `<C-s>`
5. **Try Composer**: `<leader>iC` then "Add a user dashboard"
6. **Try Agent**: `<leader>ia` then "Refactor the auth module"

## 📖 Usage

### Chat (`<leader>ic` / `:InfinityChat`)

```
You: @codebase How does authentication work?
Assistant: Based on the codebase search, auth is handled in...
  • src/auth/jwt.ts (0.92)
  • src/middleware/auth.ts (0.87)
  • src/routes/auth.ts (0.81)

You: @file src/auth/jwt.ts
     Can you add refresh token support?
Assistant: I'll add refresh token support...
  [Opens Composer with plan/diffs]
```

**Keymaps in Chat:**
- `<C-s>` — Send message
- `@codebase` — Trigger codebase search
- `@file` — Attach file (opens Telescope/fzf)
- `q` — Close, `?` — Help

### Composer (`<leader>iC` / `:InfinityComposer`)

Multi-file editing with three tabs:

1. **Plan** — Step-by-step execution plan
2. **Diff** — Side-by-side diffs for each file
3. **Files** — Context files included

**Keymaps:**
- `<C-s>` — Generate plan
- `<leader>1/2/3` — Switch tabs
- `<C-a>` — Apply all / Apply diff at cursor
- `<C-r>` — Reject all / Reject diff at cursor
- `<CR>` — Open file (Files tab)

### Agent (`<leader>ia` / `:InfinityAgent`)

Autonomous coding with human-in-the-loop:

**Views:** Timeline | Context | Config

**Keymaps:**
- `<C-s>` — Start/Continue
- `<Space>` — Pause/Resume
- `<C-a>` / `<C-r>` — Approve/Reject step
- `<leader>c` — Create checkpoint
- `<leader>r` — Restore checkpoint

### Autocomplete (Tab)

Works automatically with nvim-cmp. Ghost text appears inline:

```lua
-- In your cmp config
require("cmp").setup({
  sources = {
    { name = "infinity", priority = 100 },
    { name = "nvim_lsp" },
    { name = "luasnip" },
  },
})
```

**Keymaps:**
- `<Tab>` — Accept ghost text
- `<C-n>` / `<C-p>` — Navigate menu
- `<C-e>` — Dismiss

### Code Review (`<leader>ir` / `:InfinityReview`)

```vim
:InfinityReview              " Review git diff (HEAD)
:InfinityReview 123          " Review PR #123 (when supported)
:InfinityReview "diff here"  " Review specific diff
```

### Codebase Indexing

```vim
:InfinityIndex full          " Full re-index
:InfinityIndex incremental   " Incremental (default)
:InfinityIndex status        " Show status
:InfinityIndexSearch query   " Search codebase
```

## 🔧 Commands Summary

| Command | Description |
|---------|-------------|
| `:InfinityChat [msg]` | Open chat |
| `:InfinityComposer [task]` | Open composer |
| `:InfinityAgent [goal]` | Open agent |
| `:InfinityReview [diff]` | Open code review |
| `:InfinityIndex [mode]` | Trigger indexing |
| `:InfinityIndexSearch <q>` | Search codebase |
| `:InfinityConfig [show\|reset\|edit]` | Configuration |
| `:InfinityHealth` | Health check |
| `:InfinityKeys` | Show keymaps |
| `:InfinityVersion` | Show version |

## 🏗️ Architecture

```
infinity.nvim/
├── lua/infinity/
│   ├── init.lua          -- Main entry point
│   ├── config.lua        -- Configuration with defaults
│   ├── api.lua           -- REST + WebSocket client
│   ├── chat.lua          -- Chat buffer (floating window)
│   ├── composer.lua      -- Composer buffer (tabs: plan/diff/files)
│   ├── agent.lua         -- Agent buffer (timeline/context)
│   ├── autocomplete.lua  -- nvim-cmp source + ghost text
│   ├── ui.lua            -- Shared UI (floats, keymaps, highlights)
│   ├── commands.lua      -- User commands
│   └── keymaps.lua       -- Default keybindings
├── plugin/infinity.vim   -- Plugin loader
├── doc/infinity.txt      -- Help documentation
├── rocks.nix             -- LuaRocks/Nix dependencies
└── README.md
```

## 🔌 API Integration

Infinity.nvim connects to the **Infinity API server** (part of the Infinity platform).

**Required Endpoints:**
- `POST /api/infinity/chat` — Chat completions
- `POST /api/infinity/composer` — Multi-file planning
- `POST /api/infinity/agent/run` — Agent execution
- `POST /api/infinity/autocomplete/suggest` — Tab completions
- `POST /api/infinity/index` — Trigger indexing
- `GET /api/infinity/index/status` — Index status
- `POST /api/infinity/index/search` — Semantic search
- `POST /api/infinity/review` — Code review
- `WS /ws` — Real-time streaming

**Authentication:**
- Session cookie (preferred)
- Bearer token via `api_key` config
- Project scoping via `project_id`

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| Connection refused | Check API server running at `api_url` |
| WebSocket fails | Set `auto_connect = false` for REST-only |
| Autocomplete not working | Install nvim-cmp, run `:InfinityAutocompleteEnable` |
| `@codebase` empty | Run `:InfinityIndex full` |
| File picker missing | Install telescope.nvim or fzf-lua |
| Keymaps not working | Check `keymaps.enabled = true`, use `:InfinityKeys` |

**Debug mode:**
```lua
require("infinity").setup({ debug = true, log_level = "debug" })
```

Check logs with `:messages`.

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

## 🤝 Contributing

Contributions welcome! Please read our contributing guidelines and submit PRs.

## 🔗 Links

- **Infinity Platform**: https://github.com/Infinity-AI/Infinity-AI
- **Issues**: https://github.com/Infinity-AI/infinity.nvim/issues
- **Discussions**: https://github.com/Infinity-AI/infinity.nvim/discussions

---

**Made with ❤️ by the Infinity AI team**