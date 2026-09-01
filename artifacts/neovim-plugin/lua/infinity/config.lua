-- Infinity Neovim Plugin - Configuration

local M = {}

-- Default configuration
M.defaults = {
  -- API Connection
  api_url = "http://localhost:8080",      -- Infinity API server URL
  project_id = nil,                        -- Project ID (auto-detected from git root if nil)
  api_key = nil,                           -- API key for authentication (optional, uses session cookie if available)

  -- Connection behavior
  auto_connect = true,                     -- Auto-connect on startup
  reconnect_interval = 5000,               -- Reconnection interval in ms
  request_timeout = 30000,                 -- Request timeout in ms

  -- UI Configuration
  ui = {
    -- Chat window
    chat = {
      width = 0.4,                         -- Width as fraction of editor (0.0-1.0)
      height = 0.8,                        -- Height as fraction of editor (0.0-1.0)
      border = "rounded",                  -- Border style: none, single, double, rounded, solid, shadow
      position = "right",                  -- Position: left, right, top, bottom, center
      title = " Infinity Chat ",
      show_line_numbers = false,
      wrap = true,
    },

    -- Composer window
    composer = {
      width = 0.5,
      height = 0.8,
      border = "rounded",
      position = "right",
      title = " Infinity Composer ",
      show_diff = true,
      diff_context_lines = 3,
    },

    -- Agent window
    agent = {
      width = 0.5,
      height = 0.8,
      border = "rounded",
      position = "right",
      title = " Infinity Agent ",
      show_timeline = true,
      show_context = true,
    },

    -- Review window
    review = {
      width = 0.6,
      height = 0.8,
      border = "rounded",
      position = "right",
      title = " Infinity Review ",
    },

    -- General floating window options
    float = {
      zindex = 50,
      backdrop = 0.3,                      -- Backdrop opacity (0-1)
    },
  },

  -- Keybindings (set to false to disable defaults)
  keymaps = {
    enabled = true,
    prefix = "<leader>i",                  -- Leader prefix for all Infinity keymaps
    chat = "c",                            -- <leader>ic - Open chat
    composer = "C",                        -- <leader>iC - Open composer
    agent = "a",                           -- <leader>ia - Open agent
    review = "r",                          -- <leader>ir - Open review
    index = "i",                           -- <leader>ii - Trigger indexing
    toggle = "t",                          -- <leader>it - Toggle last used window
    send = "<C-s>",                        -- Send message in chat/composer
    accept = "<C-a>",                      -- Accept suggestion/completion
    reject = "<C-r>",                      -- Reject suggestion/completion
    next_tab = "<Tab>",                    -- Next tab in multi-tab windows
    prev_tab = "<S-Tab>",                  -- Previous tab
    close = "q",                           -- Close window
    help = "?",                            -- Show help
  },

  -- Chat behavior
  chat = {
    max_history = 100,                     -- Maximum messages to keep in history
    stream = true,                         -- Stream responses
    show_tool_calls = true,                -- Show tool calls in chat
    auto_scroll = true,                    -- Auto-scroll to bottom on new messages
    codebase_trigger = "@codebase",        -- Trigger for codebase search
    attachment_trigger = "@file",          -- Trigger for file attachment
  },

  -- Composer behavior
  composer = {
    auto_apply = false,                    -- Auto-apply diffs without confirmation
    show_preview = true,                   -- Show diff preview before applying
    context_files = 10,                    -- Number of context files to include
    max_steps = 20,                        -- Maximum planning steps
  },

  -- Agent behavior
  agent = {
    max_iterations = 50,                   -- Maximum agent iterations
    auto_approve = false,                  -- Auto-approve tool calls (dangerous)
    show_thinking = true,                  -- Show agent thinking process
    checkpoint_interval = 5,               -- Create checkpoint every N steps
  },

  -- Autocomplete (Tab) behavior
  autocomplete = {
    enabled = true,
    trigger_on_tab = true,                 -- Trigger on Tab key
    min_chars = 2,                         -- Minimum chars before triggering
    max_suggestions = 5,                   -- Maximum suggestions to show
    debounce_ms = 100,                     -- Debounce time in ms
    use_local_fallback = true,             -- Use local WASM model as fallback
    local_model_path = nil,                -- Path to local model (optional)
  },

  -- Codebase indexing
  indexing = {
    auto_index = true,                     -- Auto-index on project open
    watch_files = true,                    -- Watch for file changes
    exclude_patterns = {                   -- Patterns to exclude from indexing
      "node_modules",
      ".git",
      "dist",
      "build",
      "*.min.js",
      "*.map",
      "coverage",
      ".next",
      ".vercel",
      "target",
      "vendor",
    },
    include_patterns = {                   -- Patterns to include (empty = all)
      "*.ts",
      "*.tsx",
      "*.js",
      "*.jsx",
      "*.py",
      "*.go",
      "*.rs",
      "*.java",
      "*.cpp",
      "*.h",
      "*.cs",
      "*.php",
      "*.rb",
      "*.swift",
      "*.kt",
      "*.dart",
    },
  },

  -- Telescope/FZF integration for file picking
  picker = {
    enabled = true,
    prefer_telescope = true,               -- Prefer telescope over fzf-lua
  },

  -- Debug/Logging
  debug = false,                           -- Enable debug logging
  log_level = "info",                      -- Log level: trace, debug, info, warn, error

  -- Experimental features
  experimental = {
    inline_edits = false,                  -- Inline edit suggestions (Cmd+K equivalent)
    voice_input = false,                   -- Voice input support
  },
}

-- Current options (merged with user config)
M.options = {}

-- Setup function
function M.setup(opts)
  opts = opts or {}
  M.options = vim.tbl_deep_extend("force", M.defaults, opts)

  -- Validate configuration
  M._validate()

  -- Set up project_id auto-detection if not provided
  if M.options.project_id == nil then
    M.options.project_id = M._detect_project_id()
  end

  return M.options
end

-- Validate configuration
function M._validate()
  local opts = M.options

  -- Validate api_url
  if type(opts.api_url) ~= "string" or opts.api_url == "" then
    vim.notify("Infinity: api_url must be a non-empty string", vim.log.levels.ERROR)
    opts.api_url = M.defaults.api_url
  end

  -- Ensure api_url doesn't have trailing slash
  opts.api_url = opts.api_url:gsub("/+$", "")

  -- Validate numeric values
  if type(opts.reconnect_interval) ~= "number" or opts.reconnect_interval < 1000 then
    opts.reconnect_interval = M.defaults.reconnect_interval
  end

  if type(opts.request_timeout) ~= "number" or opts.request_timeout < 1000 then
    opts.request_timeout = M.defaults.request_timeout
  end

  -- Validate UI config
  for _, win_type in ipairs({"chat", "composer", "agent", "review"}) do
    local win = opts.ui[win_type]
    if win then
      win.width = math.max(0.1, math.min(1.0, win.width or M.defaults.ui[win_type].width))
      win.height = math.max(0.1, math.min(1.0, win.height or M.defaults.ui[win_type].height))
      win.border = win.border or M.defaults.ui[win_type].border
      win.position = win.position or M.defaults.ui[win_type].position
    end
  end

  -- Validate keymaps
  if opts.keymaps.enabled and type(opts.keymaps.prefix) ~= "string" then
    opts.keymaps.prefix = M.defaults.keymaps.prefix
  end
end

-- Auto-detect project ID from git root
function M._detect_project_id()
  -- Try to get git root
  local git_root = vim.fn.systemlist("git rev-parse --show-toplevel 2>/dev/null")[1]
  if git_root and git_root ~= "" and vim.v.shell_error == 0 then
    -- Use directory name as project identifier
    local project_name = vim.fn.fnamemodify(git_root, ":t")
    return project_name
  end

  -- Fallback to current working directory name
  local cwd = vim.fn.getcwd()
  return vim.fn.fnamemodify(cwd, ":t")
end

-- Get a configuration value with dot notation (e.g., "ui.chat.width")
function M.get(key)
  local keys = vim.split(key, ".", { plain = true })
  local value = M.options
  for _, k in ipairs(keys) do
    if type(value) == "table" and value[k] ~= nil then
      value = value[k]
    else
      return nil
    end
  end
  return value
end

-- Set a configuration value at runtime
function M.set(key, value)
  local keys = vim.split(key, ".", { plain = true })
  local opts = M.options
  for i, k in ipairs(keys) do
    if i == #keys then
      opts[k] = value
    else
      opts[k] = opts[k] or {}
      opts = opts[k]
    end
  end
end

-- Reset to defaults
function M.reset()
  M.options = vim.deepcopy(M.defaults)
  return M.options
end

return M