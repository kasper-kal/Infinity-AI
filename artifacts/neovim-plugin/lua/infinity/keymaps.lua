-- Infinity Neovim Plugin - Default Keybindings
-- Sets up default keymaps for all Infinity features

local M = {}

local config = require("infinity.config")
local chat = require("infinity.chat")
local composer = require("infinity.composer")
local agent = require("infinity.agent")
local commands = require("infinity.commands")
local autocomplete = require("infinity.autocomplete")

-- Setup default keymaps
function M.setup()
  local keymaps = config.get("keymaps")
  if not keymaps.enabled then
    return
  end

  local prefix = keymaps.prefix or "<leader>i"

  -- Helper to create keymap with prefix
  local function map(mode, key, func, desc)
    local full_key = prefix .. key
    vim.keymap.set(mode, full_key, func, { desc = "Infinity: " .. desc, silent = true })
  end

  -- Main feature toggles
  map("n", keymaps.chat, chat.toggle, "Toggle Chat")
  map("n", keymaps.composer, composer.toggle, "Toggle Composer")
  map("n", keymaps.agent, agent.toggle, "Toggle Agent")
  map("n", keymaps.review, function()
    require("infinity.commands").toggle_review()
  end, "Toggle Code Review")
  map("n", keymaps.index, function()
    require("infinity.commands").trigger_index("incremental")
  end, "Trigger Indexing")
  map("n", keymaps.toggle, M._toggle_last_window, "Toggle Last Window")

  -- Chat-specific (when chat window is open)
  -- These are set up in chat.lua when window opens

  -- Composer-specific
  -- Set up in composer.lua

  -- Agent-specific
  -- Set up in agent.lua

  -- Autocomplete
  if keymaps.enabled and config.get("autocomplete.enabled") then
    -- Tab acceptance is handled in autocomplete.lua
    -- Additional keymaps for manual trigger
    map("i", "<C-x><C-i>", function()
      require("infinity.autocomplete").source:complete(
        { context = { cursor_line = vim.api.nvim_get_current_line(), cursor = vim.api.nvim_win_get_cursor(0) } },
        function() end
      )
    end, "Trigger Infinity Autocomplete")
  end

  -- Global utility keymaps
  map("n", "h", function() commands.show_keymaps() end, "Show Keymaps Help")
  map("n", "v", function() commands.health_check() end, "Health Check")
  map("n", "c", function() commands.show_config("show") end, "Show Config")

  -- Quick actions
  map("n", "s", function()
    -- Quick chat with current selection or word under cursor
    local text = M._get_visual_selection() or vim.fn.expand("<cword>")
    if text and text ~= "" then
      chat.open("Explain this code: " .. text)
    end
  end, "Quick Chat (Explain Selection)")

  map("n", "f", function()
    -- Quick fix with agent
    local text = M._get_visual_selection() or vim.fn.expand("<cword>")
    if text and text ~= "" then
      agent.open("Fix or improve this code: " .. text)
    end
  end, "Quick Agent (Fix Selection)")

  map("n", "d", function()
    -- Quick diff review
    require("infinity.commands").toggle_review()
  end, "Quick Review")

  -- Project management
  map("n", "p", function()
    require("infinity.commands").project_command("detect")
  end, "Detect Project")

  -- Autocomplete toggle
  map("n", "a", function()
    autocomplete.toggle()
  end, "Toggle Autocomplete")
end

-- Get visual selection text
function M._get_visual_selection()
  local mode = vim.fn.mode()
  if mode ~= "v" and mode ~= "V" and mode ~= "\22" then
    return nil
  end

  local start_pos = vim.fn.getpos("'<")
  local end_pos = vim.fn.getpos("'>")
  local lines = vim.fn.getline(start_pos[2], end_pos[2])

  if #lines == 0 then return nil end

  lines[1] = lines[1]:sub(start_pos[3])
  lines[#lines] = lines[#lines]:sub(1, end_pos[3])

  return table.concat(lines, "\n")
end

-- Toggle last used window
local last_window = nil

function M._toggle_last_window()
  local windows = {
    chat = require("infinity.chat"),
    composer = require("infinity.composer"),
    agent = require("infinity.agent"),
  }

  -- Find which window was last focused
  for name, mod in pairs(windows) do
    local state = mod.get_state and mod.get_state() or {}
    if state.window_id and require("infinity.ui").get_window(state.window_id) then
      if last_window == name then
        mod.close()
        last_window = nil
      else
        mod.open()
        last_window = name
      end
      return
    end
  end

  -- No window open, open chat by default
  chat.open()
  last_window = "chat"
end

-- Set up buffer-local keymaps for specific filetypes
function M.setup_buffer_keymaps(bufnr)
  bufnr = bufnr or vim.api.nvim_get_current_buf()
  local ft = vim.bo[bufnr].filetype

  -- Only for code files
  local code_filetypes = {
    "typescript", "typescriptreact", "javascript", "javascriptreact",
    "python", "go", "rust", "java", "cpp", "c", "csharp",
    "php", "ruby", "swift", "kotlin", "dart", "lua",
  }

  if not vim.tbl_contains(code_filetypes, ft) then
    return
  end

  local keymaps = config.get("keymaps")
  local prefix = keymaps.prefix or "<leader>i"

  -- Buffer-local keymaps
  vim.keymap.set("n", prefix .. "ce", function()
    -- Explain code at cursor
    local text = M._get_visual_selection() or vim.fn.expand("<cword>")
    require("infinity.chat").open("Explain this " .. ft .. " code: " .. text)
  end, { buffer = bufnr, desc = "Infinity: Explain Code" })

  vim.keymap.set("n", prefix .. "cf", function()
    -- Fix code at cursor
    local text = M._get_visual_selection() or vim.fn.expand("<cword>")
    require("infinity.agent").open("Fix this " .. ft .. " code: " .. text)
  end, { buffer = bufnr, desc = "Infinity: Fix Code" })

  vim.keymap.set("n", prefix .. "ct", function()
    -- Generate tests for code at cursor
    local text = M._get_visual_selection() or vim.fn.expand("<cword>")
    require("infinity.agent").open("Generate tests for this " .. ft .. " code: " .. text)
  end, { buffer = bufnr, desc = "Infinity: Generate Tests" })

  vim.keymap.set("n", prefix .. "cr", function()
    -- Review code at cursor
    local text = M._get_visual_selection() or vim.fn.expand("<cword>")
    require("infinity.commands").open_review("Review this " .. ft .. " code:\n" .. text)
  end, { buffer = bufnr, desc = "Infinity: Review Code" })

  vim.keymap.set("n", prefix .. "cd", function()
    -- Document code at cursor
    local text = M._get_visual_selection() or vim.fn.expand("<cword>")
    require("infinity.chat").open("Add documentation for this " .. ft .. " code: " .. text)
  end, { buffer = bufnr, desc = "Infinity: Document Code" })
end

-- Set up autocmd for buffer-local keymaps
function M.init()
  vim.api.nvim_create_autocmd("FileType", {
    group = vim.api.nvim_create_augroup("InfinityBufferKeymaps", { clear = true }),
    pattern = "*",
    callback = function(args)
      M.setup_buffer_keymaps(args.buf)
    end,
  })
end

-- Which-key integration (if available)
function M.setup_which_key()
  local has_wk, wk = pcall(require, "which-key")
  if not has_wk then
    return
  end

  local keymaps = config.get("keymaps")
  local prefix = keymaps.prefix or "<leader>i"

  wk.register({
    [prefix] = {
      name = "Infinity",
      c = { "<cmd>InfinityChat<cr>", "Chat" },
      C = { "<cmd>InfinityComposer<cr>", "Composer" },
      a = { "<cmd>InfinityAgent<cr>", "Agent" },
      r = { "<cmd>InfinityReview<cr>", "Review" },
      i = { "<cmd>InfinityIndex<cr>", "Index" },
      t = { function() M._toggle_last_window() end, "Toggle Last" },
      h = { "<cmd>InfinityKeys<cr>", "Help" },
      v = { "<cmd>InfinityHealth<cr>", "Health" },
      s = { function()
        local text = M._get_visual_selection() or vim.fn.expand("<cword>")
        if text ~= "" then require("infinity.chat").open("Explain: " .. text) end
      end, "Explain Selection" },
      f = { function()
        local text = M._get_visual_selection() or vim.fn.expand("<cword>")
        if text ~= "" then require("infinity.agent").open("Fix: " .. text) end
      end, "Fix Selection" },
      p = { "<cmd>InfinityProject detect<cr>", "Detect Project" },
    },
  }, { prefix = "<leader>" })

  -- Buffer-local which-key
  wk.register({
    [prefix] = {
      name = "Infinity Code",
      e = { function()
        local text = M._get_visual_selection() or vim.fn.expand("<cword>")
        require("infinity.chat").open("Explain: " .. text)
      end, "Explain" },
      f = { function()
        local text = M._get_visual_selection() or vim.fn.expand("<cword>")
        require("infinity.agent").open("Fix: " .. text)
      end, "Fix" },
      t = { function()
        local text = M._get_visual_selection() or vim.fn.expand("<cword>")
        require("infinity.agent").open("Test: " .. text)
      end, "Test" },
      r = { function()
        local text = M._get_visual_selection() or vim.fn.expand("<cword>")
        require("infinity.commands").open_review("Review: " .. text)
      end, "Review" },
      d = { function()
        local text = M._get_visual_selection() or vim.fn.expand("<cword>")
        require("infinity.chat").open("Document: " .. text)
      end, "Document" },
    },
  }, { prefix = "<leader>", mode = "n" })
end

return M