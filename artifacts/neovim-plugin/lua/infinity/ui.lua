-- Infinity Neovim Plugin - Shared UI Components
-- Floating windows, keymaps, and common UI utilities

local M = {}

local config = require("infinity.config")
local api = require("infinity.api")

-- State for open windows
M.windows = {}
M.buffers = {}

-- Create a floating window
function M.create_float(opts)
  opts = opts or {}

  local ui_config = config.get("ui.float") or {}
  local win_config = config.get("ui." .. (opts.type or "chat")) or {}

  -- Calculate dimensions
  local width = math.floor(vim.o.columns * (opts.width or win_config.width or 0.5))
  local height = math.floor(vim.o.lines * (opts.height or win_config.height or 0.7))

  -- Calculate position
  local row, col
  local position = opts.position or win_config.position or "center"
  if position == "center" then
    row = math.floor((vim.o.lines - height) / 2)
    col = math.floor((vim.o.columns - width) / 2)
  elseif position == "right" then
    row = math.floor((vim.o.lines - height) / 2)
    col = vim.o.columns - width - 1
  elseif position == "left" then
    row = math.floor((vim.o.lines - height) / 2)
    col = 0
  elseif position == "top" then
    row = 0
    col = math.floor((vim.o.columns - width) / 2)
  elseif position == "bottom" then
    row = vim.o.lines - height - 1
    col = math.floor((vim.o.columns - width) / 2)
  else
    row = math.floor((vim.o.lines - height) / 2)
    col = math.floor((vim.o.columns - width) / 2)
  end

  -- Create buffer
  local buf = opts.buffer or vim.api.nvim_create_buf(false, true)
  vim.bo[buf].buftype = opts.buftype or "nofile"
  vim.bo[buf].bufhidden = opts.bufhidden or "wipe"
  vim.bo[buf].swapfile = false
  vim.bo[buf].filetype = opts.filetype or "infinity"

  -- Window options
  local win_opts = {
    relative = "editor",
    width = width,
    height = height,
    row = row,
    col = col,
    style = "minimal",
    border = opts.border or win_config.border or "rounded",
    title = opts.title or win_config.title or " Infinity ",
    title_pos = "center",
    zindex = ui_config.zindex or 50,
  }

  -- Create window
  local win = vim.api.nvim_open_win(buf, true, win_opts)

  -- Set window options
  vim.wo[win].wrap = win_config.wrap ~= false
  vim.wo[win].number = win_config.show_line_numbers or false
  vim.wo[win].relativenumber = false
  vim.wo[win].cursorline = true
  vim.wo[win].signcolumn = "no"

  -- Store window/buffer reference
  local id = opts.id or ("infinity_" .. (opts.type or "float") .. "_" .. vim.fn.rand())
  M.windows[id] = { win = win, buf = buf, config = opts }
  M.buffers[buf] = id

  -- Set up backdrop if enabled
  if ui_config.backdrop and ui_config.backdrop > 0 then
    M._create_backdrop(id, ui_config.backdrop)
  end

  -- Set up close keymap
  local close_key = config.get("keymaps.close") or "q"
  if close_key and close_key ~= "" then
    vim.keymap.set("n", close_key, function()
      M.close(id)
    end, { buffer = buf, nowait = true, desc = "Close Infinity window" })
  end

  -- Set up help keymap
  local help_key = config.get("keymaps.help") or "?"
  if help_key and help_key ~= "" then
    vim.keymap.set("n", help_key, function()
      M.show_help(opts.type)
    end, { buffer = buf, nowait = true, desc = "Show Infinity help" })
  end

  -- Handle window close
  vim.api.nvim_create_autocmd("WinClosed", {
    pattern = tostring(win),
    once = true,
    callback = function()
      M.windows[id] = nil
      M.buffers[buf] = nil
      M._remove_backdrop(id)
      if opts.on_close then
        opts.on_close()
      end
    end,
  })

  return { id = id, win = win, buf = buf }
end

-- Create backdrop window
function M._create_backdrop(id, opacity)
  local backdrop_buf = vim.api.nvim_create_buf(false, true)
  vim.bo[backdrop_buf].buftype = "nofile"
  vim.bo[backdrop_buf].bufhidden = "wipe"

  local backdrop_win = vim.api.nvim_open_win(backdrop_buf, false, {
    relative = "editor",
    width = vim.o.columns,
    height = vim.o.lines,
    row = 0,
    col = 0,
    style = "minimal",
    zindex = 49,
  })

  vim.wo[backdrop_win].winhl = string.format("Normal:InfinityBackdrop,NormalNC:InfinityBackdrop")
  vim.api.nvim_set_hl(0, "InfinityBackdrop", { bg = "#000000", blend = math.floor(opacity * 100) })

  M.windows[id].backdrop = { win = backdrop_win, buf = backdrop_buf }
end

function M._remove_backdrop(id)
  local win_data = M.windows[id]
  if win_data and win_data.backdrop then
    if vim.api.nvim_win_is_valid(win_data.backdrop.win) then
      vim.api.nvim_win_close(win_data.backdrop.win, true)
    end
    win_data.backdrop = nil
  end
end

-- Close a floating window
function M.close(id)
  local win_data = M.windows[id]
  if win_data and vim.api.nvim_win_is_valid(win_data.win) then
    vim.api.nvim_win_close(win_data.win, true)
  end
end

-- Close all Infinity windows
function M.close_all()
  for id, _ in pairs(M.windows) do
    M.close(id)
  end
end

-- Get window by ID
function M.get_window(id)
  return M.windows[id]
end

-- Get window by buffer
function M.get_window_by_buf(buf)
  local id = M.buffers[buf]
  return id and M.windows[id] or nil
end

-- Create a split window (for multi-pane layouts)
function M.create_split(parent_id, direction, ratio)
  local parent = M.windows[parent_id]
  if not parent then
    return nil
  end

  -- This is a simplified implementation
  -- In practice, you'd use vim.api.nvim_win_split or create a new float
  return M.create_float({
    type = parent.config.type,
    width = parent.config.width * (ratio or 0.5),
    height = parent.config.height,
    position = direction == "right" and "right" or "left",
  })
end

-- Create tabbed interface
function M.create_tabs(tabs_config, opts)
  opts = opts or {}
  local main = M.create_float(vim.tbl_extend("force", {
    type = "tabs",
  }, opts))

  local buf = main.buf
  local win = main.win

  -- Build tab line
  local tab_labels = {}
  for i, tab in ipairs(tabs_config) do
    table.insert(tab_labels, (i == 1 and "▸ " or "  ") .. (tab.title or "Tab " .. i))
  end

  -- Set up buffer with tab bar
  local lines = { table.concat(tab_labels, " │ ") }
  for _, tab in ipairs(tabs_config) do
    if tab.content then
      for _, line in ipairs(tab.content) do
        table.insert(lines, line)
      end
    end
  end

  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false

  -- Tab navigation keymaps
  local next_tab = config.get("keymaps.next_tab") or "<Tab>"
  local prev_tab = config.get("keymaps.prev_tab") or "<S-Tab>"

  local current_tab = 1
  local function switch_tab(delta)
    current_tab = ((current_tab - 1 + delta) % #tabs_config) + 1
    M._update_tab_display(buf, tabs_config, current_tab)
    if tabs_config[current_tab].on_select then
      tabs_config[current_tab].on_select(current_tab)
    end
  end

  vim.keymap.set("n", next_tab, function() switch_tab(1) end, { buffer = buf, nowait = true })
  vim.keymap.set("n", prev_tab, function() switch_tab(-1) end, { buffer = buf, nowait = true })

  -- Number keys for direct tab access
  for i = 1, 9 do
    if i <= #tabs_config then
      vim.keymap.set("n", tostring(i), function() switch_tab(i - current_tab) end, { buffer = buf, nowait = true })
    end
  end

  main.tabs = tabs_config
  main.current_tab = current_tab
  main.switch_tab = switch_tab

  return main
end

function M._update_tab_display(buf, tabs, current)
  local labels = {}
  for i, tab in ipairs(tabs) do
    table.insert(labels, (i == current and "▸ " or "  ") .. (tab.title or "Tab " .. i))
  end
  vim.bo[buf].modifiable = true
  vim.api.nvim_buf_set_lines(buf, 0, 1, false, { table.concat(labels, " │ ") })
  vim.bo[buf].modifiable = false
end

-- Show help in a floating window
function M.show_help(context)
  local help_text = M._get_help_text(context)

  M.create_float({
    type = "help",
    width = 0.6,
    height = 0.7,
    title = " Infinity Help ",
    position = "center",
    buffer = vim.api.nvim_create_buf(false, true),
    on_close = function() end,
  })

  local buf = M.windows["infinity_help_float_" .. vim.fn.rand()].buf
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, vim.split(help_text, "\n"))
  vim.bo[buf].modifiable = false
  vim.bo[buf].filetype = "markdown"
end

function M._get_help_text(context)
  local base = [[
# Infinity.nvim Help

## Global Keymaps
  <leader>ic  - Open Chat
  <leader>iC  - Open Composer
  <leader>ia  - Open Agent
  <leader>ir  - Open Review
  <leader>ii  - Trigger Indexing
  <leader>it  - Toggle Last Window

## Window Controls
  q           - Close window
  ?           - Show this help
  <Tab>       - Next tab (in tabbed windows)
  <S-Tab>     - Previous tab
  1-9         - Switch to tab N

## Chat Window
  <C-s>       - Send message
  @codebase   - Search codebase
  @file       - Attach file
  <C-a>       - Accept suggestion
  <C-r>       - Reject suggestion

## Composer Window
  <C-s>       - Generate plan
  <C-a>       - Apply all diffs
  <C-r>       - Reject all diffs
  <Tab>       - Switch between Plan/Diff/Files tabs

## Agent Window
  <C-s>       - Start/continue agent
  <C-a>       - Approve current step
  <C-r>       - Reject current step
  <Space>     - Pause/Resume

## Autocomplete
  <Tab>       - Accept completion
  <C-n>       - Next completion
  <C-p>       - Previous completion
  <C-e>       - Dismiss completion
]]

  if context == "chat" then
    return base .. [[

## Chat Specific
  Enter       - Send message (in insert mode)
  <C-Enter>   - New line in insert mode
  :InfinityChat [message]  - Open chat with initial message
]]
  elseif context == "composer" then
    return base .. [[

## Composer Specific
  :InfinityComposer [task]  - Open composer with task
]]
  elseif context == "agent" then
    return base .. [[

## Agent Specific
  :InfinityAgent [goal]  - Open agent with goal
]]
  end

  return base
end

-- Create a progress indicator
function M.create_progress(title, opts)
  opts = opts or {}
  local buf = vim.api.nvim_create_buf(false, true)
  vim.bo[buf].buftype = "nofile"
  vim.bo[buf].bufhidden = "wipe"

  local win = vim.api.nvim_open_win(buf, false, {
    relative = "editor",
    width = opts.width or 40,
    height = 3,
    row = opts.row or 2,
    col = opts.col or (vim.o.columns - (opts.width or 40) - 2),
    style = "minimal",
    border = "rounded",
    title = " " .. (title or "Processing") .. " ",
    zindex = 60,
  })

  local spinner = { "⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏" }
  local i = 1
  local timer = vim.loop.new_timer()

  local function update(text)
    vim.api.nvim_buf_set_lines(buf, 0, -1, false, {
      spinner[i] .. " " .. (text or title),
      string.rep("─", opts.width or 40),
      opts.detail or "",
    })
    i = (i % #spinner) + 1
  end

  timer:start(0, 100, vim.schedule_wrap(update))

  return {
    update = update,
    close = function()
      timer:stop()
      timer:close()
      if vim.api.nvim_win_is_valid(win) then
        vim.api.nvim_win_close(win, true)
      end
    end,
  }
end

-- Show notification
function M.notify(msg, level, opts)
  opts = opts or {}
  level = level or vim.log.levels.INFO
  vim.notify("[Infinity] " .. msg, level, opts)
end

-- Confirm dialog using vim.ui.select
function M.confirm(prompt, choices, callback)
  choices = choices or { "Yes", "No" }
  vim.ui.select(choices, {
    prompt = "Infinity: " .. prompt,
  }, function(choice, idx)
    callback(choice, idx)
  end)
end

-- Input dialog
function M.input(prompt, default, callback)
  vim.ui.input({
    prompt = "Infinity: " .. prompt,
    default = default,
  }, function(input)
    callback(input)
  end)
end

-- Select from list (for file picking, model selection, etc.)
function M.select(items, opts, callback)
  opts = opts or {}
  vim.ui.select(items, {
    prompt = opts.prompt or "Select:",
    format_item = opts.format_item or function(item) return item end,
    kind = "infinity",
  }, callback)
end

-- Highlight groups
function M.setup_highlights()
  local hl = vim.api.nvim_set_hl
  hl(0, "InfinityTitle", { bold = true, fg = "#7c3aed" })
  hl(0, "InfinityBorder", { fg = "#7c3aed" })
  hl(0, "InfinityBackdrop", { bg = "#000000" })
  hl(0, "InfinityChatUser", { fg = "#a5b4fc" })
  hl(0, "InfinityChatAssistant", { fg = "#86efac" })
  hl(0, "InfinityChatTool", { fg = "#fde047" })
  hl(0, "InfinityChatError", { fg = "#f87171" })
  hl(0, "InfinityComposerAdded", { fg = "#86efac" })
  hl(0, "InfinityComposerRemoved", { fg = "#f87171" })
  hl(0, "InfinityComposerChanged", { fg = "#fde047" })
  hl(0, "InfinityAgentThinking", { fg = "#a5b4fc", italic = true })
  hl(0, "InfinityAgentAction", { fg = "#fde047" })
  hl(0, "InfinityAgentResult", { fg = "#86efac" })
  hl(0, "InfinityAgentApproval", { fg = "#fb923c", bold = true })
  hl(0, "InfinityAutocompleteGhost", { fg = "#6b7280", italic = true })
  hl(0, "InfinityAutocompleteMenu", { bg = "#1f2937" })
  hl(0, "InfinityAutocompleteMenuSel", { bg = "#374151" })
end

-- Initialize UI
function M.init()
  M.setup_highlights()

  -- Set up autocmds for window management
  vim.api.nvim_create_autocmd("VimResized", {
    group = vim.api.nvim_create_augroup("InfinityUIResize", { clear = true }),
    callback = function()
      -- Reposition windows on resize
      for id, win_data in pairs(M.windows) do
        if vim.api.nvim_win_is_valid(win_data.win) then
          -- Recalculate position
          local cfg = vim.api.nvim_win_get_config(win_data.win)
          -- Recreate with new position would be better but complex
        end
      end
    end,
  })
end

return M