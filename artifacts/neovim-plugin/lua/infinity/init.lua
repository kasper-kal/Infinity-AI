-- Infinity Neovim Plugin - Main Entry Point
-- AI-native IDE features for Neovim: Chat, Composer, Agent, Tab Autocomplete

local M = {}

-- Version
M.version = "0.1.0"

-- Modules
local config = require("infinity.config")
local api = require("infinity.api")
local chat = require("infinity.chat")
local composer = require("infinity.composer")
local agent = require("infinity.agent")
local autocomplete = require("infinity.autocomplete")
local commands = require("infinity.commands")
local keymaps = require("infinity.keymaps")
local ui = require("infinity.ui")

-- Setup function
function M.setup(opts)
  -- Merge user config with defaults
  config.setup(opts)

  -- Initialize API client
  api.init(config.options)

  -- Initialize UI components
  ui.init()

  -- Initialize features
  chat.init()
  composer.init()
  agent.init()
  autocomplete.init()

  -- Register user commands
  commands.register()

  -- Set up default keymaps
  keymaps.setup()

  -- Store plugin state
  M._initialized = true

  return M
end

-- Public API
M.chat = chat
M.composer = composer
M.agent = agent
M.autocomplete = autocomplete
M.config = config
M.api = api
M.ui = ui

-- Health check
function M.health()
  local health = {
    initialized = M._initialized or false,
    config = config.options,
    api_connected = api.is_connected(),
  }
  return health
end

return M