-- Infinity Neovim Plugin - Composer Buffer
-- Multi-file task planning UI with plan/diff/files tabs

local M = {}

local config = require("infinity.config")
local api = require("infinity.api")
local ui = require("infinity.ui")

-- Composer state
local state = {
  window_id = nil,
  buffers = {},
  windows = {},
  current_tab = 1,
  tabs = { "Plan", "Diff", "Files" },
  task = "",
  plan = nil,
  diffs = {},
  context_files = {},
  composer_id = nil,
  step = 0,
}

-- Initialize composer
function M.init()
  api.on("composer_update", M._on_composer_update)
  api.on("composer_step", M._on_composer_step)
end

-- Open composer window
function M.open(task)
  if state.window_id and ui.get_window(state.window_id) then
    vim.api.nvim_set_current_win(ui.get_window(state.window_id).win)
    if task then
      M.set_task(task)
    end
    return
  end

  state.task = task or ""
  state.plan = nil
  state.diffs = {}
  state.context_files = {}
  state.composer_id = nil
  state.step = 0

  -- Create tabbed window
  local tabs_config = {
    { title = "Plan", content = {}, on_select = function() M._show_plan() end },
    { title = "Diff", content = {}, on_select = function() M._show_diff() end },
    { title = "Files", content = {}, on_select = function() M._show_files() end },
  }

  local win_data = ui.create_tabs(tabs_config, {
    type = "composer",
    id = "infinity_composer",
    title = " Infinity Composer ",
    on_close = function()
      state.window_id = nil
      state.buffers = {}
      state.windows = {}
    end,
  })

  state.window_id = win_data.id
  state.current_tab = 1

  -- Store tab references
  state.tabs = win_data.tabs
  state.switch_tab = win_data.switch_tab

  -- Set up keymaps for tab switching
  local buf = win_data.buf
  vim.keymap.set("n", "<leader>1", function() M._switch_tab(1) end, { buffer = buf, desc = "Plan tab" })
  vim.keymap.set("n", "<leader>2", function() M._switch_tab(2) end, { buffer = buf, desc = "Diff tab" })
  vim.keymap.set("n", "<leader>3", function() M._switch_tab(3) end, { buffer = buf, desc = "Files tab" })

  -- Send key
  local send_key = config.get("keymaps.send") or "<C-s>"
  vim.keymap.set({ "n", "i" }, send_key, function() M.generate_plan() end, { buffer = buf, desc = "Generate plan" })

  -- Apply key
  local accept_key = config.get("keymaps.accept") or "<C-a>"
  vim.keymap.set("n", accept_key, function() M.apply_all() end, { buffer = buf, desc = "Apply all diffs" })

  -- Reject key
  local reject_key = config.get("keymaps.reject") or "<C-r>"
  vim.keymap.set("n", reject_key, function() M.reject_all() end, { buffer = buf, desc = "Reject all diffs" })

  -- Show initial content
  if task and task ~= "" then
    M._show_plan()
    M.generate_plan()
  else
    M._show_plan()
    M._render_plan_welcome()
  end
end

-- Close composer
function M.close()
  if state.window_id then
    ui.close(state.window_id)
  end
end

-- Toggle composer
function M.toggle()
  if state.window_id and ui.get_window(state.window_id) then
    M.close()
  else
    M.open()
  end
end

-- Set task
function M.set_task(task)
  state.task = task
  M._render_plan_welcome()
end

-- Switch tab
function M._switch_tab(tab_index)
  if tab_index >= 1 and tab_index <= #state.tabs then
    state.current_tab = tab_index
    state.switch_tab(tab_index - state.current_tab + tab_index) -- This is a bit hacky, fix later
  end
end

-- Generate plan from task
function M.generate_plan()
  if state.task == "" then
    ui.input("Describe the task:", "", function(task)
      if task and task ~= "" then
        state.task = task
        M.generate_plan()
      end
    end)
    return
  end

  -- Show progress
  local progress = ui.create_progress("Generating plan...")

  -- Get context files
  M._get_context_files(function(files)
    state.context_files = files

    api.composer_create(state.task, files, function(result)
      progress.close()

      if result and result.composerId then
        state.composer_id = result.composerId
        state.plan = result.plan
        state.diffs = result.diffs or {}
        M._show_plan()
      else
        ui.notify("Failed to generate plan", vim.log.levels.ERROR)
      end
    end)
  end)
end

-- Get context files for the task
function M._get_context_files(callback)
  -- For now, use current buffer and recent files
  local files = {}

  -- Current buffer
  local current_file = vim.api.nvim_buf_get_name(0)
  if current_file and current_file ~= "" then
    local content = table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), "\n")
    table.insert(files, { path = current_file, content = content })
  end

  -- Recent files (last 10)
  local recent = vim.v.oldfiles
  for i = 1, math.min(10, #recent) do
    local f = recent[i]
    if vim.fn.filereadable(f) == 1 then
      local content = table.concat(vim.fn.readfile(f), "\n")
      table.insert(files, { path = f, content = content })
      if #files >= config.get("composer.context_files") then break end
    end
  end

  callback(files)
end

-- Apply all diffs
function M.apply_all()
  if not state.composer_id or vim.tbl_isempty(state.diffs) then
    ui.notify("No diffs to apply", vim.log.levels.WARN)
    return
  end

  local diffs_to_apply = {}
  for path, diff in pairs(state.diffs) do
    table.insert(diffs_to_apply, { path = path, diff = diff })
  end

  local progress = ui.create_progress("Applying diffs...")

  api.composer_apply(state.composer_id, diffs_to_apply, function(result)
    progress.close()

    if result and result.success then
      ui.notify("All diffs applied successfully", vim.log.levels.INFO)
      -- Reload affected buffers
      for path, _ in pairs(state.diffs) do
        local buf = vim.fn.bufnr(path)
        if buf ~= -1 then
          vim.api.nvim_buf_call(buf, function() vim.cmd("edit!") end)
        end
      end
    else
      ui.notify("Failed to apply diffs: " .. (result.error or "Unknown error"), vim.log.levels.ERROR)
    end
  end)
end

-- Reject all diffs
function M.reject_all()
  state.diffs = {}
  M._show_diff()
  ui.notify("All diffs rejected", vim.log.levels.INFO)
end

-- Apply single diff
function M.apply_diff(path)
  if not state.diffs[path] then return end

  local progress = ui.create_progress("Applying diff to " .. path .. "...")

  api.composer_apply(state.composer_id, { { path = path, diff = state.diffs[path] } }, function(result)
    progress.close()

    if result and result.success then
      ui.notify("Applied: " .. path, vim.log.levels.INFO)
      state.diffs[path] = nil
      M._show_diff()

      -- Reload buffer
      local buf = vim.fn.bufnr(path)
      if buf ~= -1 then
        vim.api.nvim_buf_call(buf, function() vim.cmd("edit!") end)
      end
    else
      ui.notify("Failed to apply: " .. (result.error or "Unknown error"), vim.log.levels.ERROR)
    end
  end)
end

-- Show plan tab
function M._show_plan()
  state.current_tab = 1
  if state.plan then
    M._render_plan()
  else
    M._render_plan_welcome()
  end
end

-- Show diff tab
function M._show_diff()
  state.current_tab = 2
  M._render_diff()
end

-- Show files tab
function M._show_files()
  state.current_tab = 3
  M._render_files()
end

-- Render welcome message in plan tab
function M._render_plan_welcome()
  local buf = state.buffers.plan or (function()
    local b = vim.api.nvim_create_buf(false, true)
    state.buffers.plan = b
    return b
  end)()

  local lines = {
    "╔══════════════════════════════════════════════════════════════╗",
    "║                    INFINITY COMPOSER                          ║",
    "╠══════════════════════════════════════════════════════════════╣",
    "║                                                               ║",
    "║  Describe a multi-file task and Infinity will:               ║",
    "║  1. Analyze your codebase                                     ║",
    "║  2. Create a step-by-step plan                                ║",
    "║  3. Generate diffs for each file                              ║",
    "║  4. Let you preview and apply changes                         ║",
    "║                                                               ║",
    "║  Press <C-s> to generate a plan                               ║",
    "║  Use @codebase to search for relevant context                 ║",
    "║                                                               ║",
    "╚══════════════════════════════════════════════════════════════╝",
    "",
    "Current task: " .. (state.task ~= "" and state.task or "(none - press <C-s> to set)"),
  }

  vim.bo[buf].modifiable = true
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false
  vim.bo[buf].filetype = "infinity_composer_plan"

  -- Display in window
  local win_data = ui.get_window(state.window_id)
  if win_data then
    vim.api.nvim_win_set_buf(win_data.win, buf)
  end
end

-- Render plan
function M._render_plan()
  local buf = state.buffers.plan or (function()
    local b = vim.api.nvim_create_buf(false, true)
    state.buffers.plan = b
    return b
  end)()

  local lines = { "# Plan: " .. state.task, "", "## Steps", "" }

  if state.plan and state.plan.steps then
    for i, step in ipairs(state.plan.steps) do
      table.insert(lines, string.format("### Step %d: %s", i, step.title or "Untitled"))
      table.insert(lines, "")
      if step.description then
        table.insert(lines, step.description)
        table.insert(lines, "")
      end
      if step.files and #step.files > 0 then
        table.insert(lines, "**Files:**")
        for _, f in ipairs(step.files) do
          table.insert(lines, "  - " .. f)
        end
        table.insert(lines, "")
      end
      if step.command then
        table.insert(lines, "**Command:**")
        table.insert(lines, "```bash")
        table.insert(lines, step.command)
        table.insert(lines, "```")
        table.insert(lines, "")
      end
    end
  else
    table.insert(lines, "_No plan generated yet. Press <C-s> to generate._")
  end

  table.insert(lines, "")
  table.insert(lines, "---")
  table.insert(lines, "Press <C-s> to regenerate | <leader>2 for Diff view")

  vim.bo[buf].modifiable = true
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false
  vim.bo[buf].filetype = "markdown"

  local win_data = ui.get_window(state.window_id)
  if win_data then
    vim.api.nvim_win_set_buf(win_data.win, buf)
  end
end

-- Render diffs
function M._render_diff()
  local buf = state.buffers.diff or (function()
    local b = vim.api.nvim_create_buf(false, true)
    state.buffers.diff = b
    return b
  end)()

  local lines = { "# Diffs", "" }

  if vim.tbl_isempty(state.diffs) then
    table.insert(lines, "_No diffs generated yet. Generate a plan first._")
  else
    for path, diff in pairs(state.diffs) do
      table.insert(lines, "## " .. path)
      table.insert(lines, "")
      table.insert(lines, "```diff")
      for _, line in ipairs(vim.split(diff, "\n")) do
        table.insert(lines, line)
      end
      table.insert(lines, "```")
      table.insert(lines, "")
      table.insert(lines, string.format("[Apply] [Reject]  (press <C-a> on line to apply, <C-r> to reject)"))
      table.insert(lines, "")
    end
  end

  vim.bo[buf].modifiable = true
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false
  vim.bo[buf].filetype = "markdown"

  -- Add keymaps for applying individual diffs
  vim.keymap.set("n", "<C-a>", function()
    local line = vim.api.nvim_win_get_cursor(0)[1]
    -- Find which diff this line belongs to
    M._apply_diff_at_line(line)
  end, { buffer = buf, desc = "Apply diff at cursor" })

  vim.keymap.set("n", "<C-r>", function()
    local line = vim.api.nvim_win_get_cursor(0)[1]
    M._reject_diff_at_line(line)
  end, { buffer = buf, desc = "Reject diff at cursor" })

  local win_data = ui.get_window(state.window_id)
  if win_data then
    vim.api.nvim_win_set_buf(win_data.win, buf)
  end
end

-- Apply diff at cursor line
function M._apply_diff_at_line(line)
  -- Simple heuristic: find the file path above current line
  local buf_lines = vim.api.nvim_buf_get_lines(state.buffers.diff, 0, line - 1, false)
  local current_file = nil
  for i = #buf_lines, 1, -1 do
    local match = buf_lines[i]:match("^## (.+)$")
    if match then
      current_file = match
      break
    end
  end

  if current_file and state.diffs[current_file] then
    M.apply_diff(current_file)
  end
end

-- Reject diff at cursor line
function M._reject_diff_at_line(line)
  local buf_lines = vim.api.nvim_buf_get_lines(state.buffers.diff, 0, line - 1, false)
  local current_file = nil
  for i = #buf_lines, 1, -1 do
    local match = buf_lines[i]:match("^## (.+)$")
    if match then
      current_file = match
      break
    end
  end

  if current_file and state.diffs[current_file] then
    state.diffs[current_file] = nil
    M._render_diff()
    ui.notify("Rejected: " .. current_file, vim.log.levels.INFO)
  end
end

-- Render context files
function M._render_files()
  local buf = state.buffers.files or (function()
    local b = vim.api.nvim_create_buf(false, true)
    state.buffers.files = b
    return b
  end)()

  local lines = { "# Context Files", "", string.format("Total: %d files", #state.context_files), "" }

  for i, file in ipairs(state.context_files) do
    local rel_path = vim.fn.fnamemodify(file.path, ":.")
    table.insert(lines, string.format("%d. %s (%d lines)", i, rel_path, #vim.split(file.content, "\n")))
  end

  table.insert(lines, "")
  table.insert(lines, "---")
  table.insert(lines, "Press <leader>1 for Plan | <leader>2 for Diff")

  vim.bo[buf].modifiable = true
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false
  vim.bo[buf].filetype = "infinity_composer_files"

  -- Keymap to open file
  vim.keymap.set("n", "<CR>", function()
    local line = vim.api.nvim_win_get_cursor(0)[1]
    if line >= 5 then
      local idx = line - 4
      if state.context_files[idx] then
        vim.cmd("edit " .. vim.fn.fnameescape(state.context_files[idx].path))
      end
    end
  end, { buffer = buf, desc = "Open file" })

  local win_data = ui.get_window(state.window_id)
  if win_data then
    vim.api.nvim_win_set_buf(win_data.win, buf)
  end
end

-- Event handlers
function M._on_composer_update(data)
  if data.plan then
    state.plan = data.plan
    M._render_plan()
  end
  if data.diffs then
    state.diffs = data.diffs
    M._render_diff()
  end
end

function M._on_composer_step(data)
  state.step = data.step or state.step
  if data.plan then
    state.plan = data.plan
  end
  if data.diffs then
    state.diffs = data.diffs
  end
  M._render_plan()
  M._render_diff()
end

return M