-- Infinity Neovim Plugin - User Commands
-- :InfinityChat, :InfinityComposer, :InfinityAgent, :InfinityReview, :InfinityIndex

local M = {}

local chat = require("infinity.chat")
local composer = require("infinity.composer")
local agent = require("infinity.agent")
local api = require("infinity.api")
local ui = require("infinity.ui")
local config = require("infinity.config")

-- Register all user commands
function M.register()
  -- Chat commands
  vim.api.nvim_create_user_command("InfinityChat", function(opts)
    local initial_message = opts.args ~= "" and opts.args or nil
    chat.open(initial_message)
  end, {
    nargs = "?",
    desc = "Open Infinity Chat window",
    complete = function()
      return { "@codebase", "@file" }
    end,
  })

  vim.api.nvim_create_user_command("InfinityChatClose", function()
    chat.close()
  end, {
    desc = "Close Infinity Chat window",
  })

  vim.api.nvim_create_user_command("InfinityChatToggle", function()
    chat.toggle()
  end, {
    desc = "Toggle Infinity Chat window",
  })

  vim.api.nvim_create_user_command("InfinityChatClear", function()
    chat.clear()
  end, {
    desc = "Clear Infinity Chat history",
  })

  -- Composer commands
  vim.api.nvim_create_user_command("InfinityComposer", function(opts)
    local task = opts.args ~= "" and opts.args or nil
    composer.open(task)
  end, {
    nargs = "?",
    desc = "Open Infinity Composer for multi-file editing",
  })

  vim.api.nvim_create_user_command("InfinityComposerClose", function()
    composer.close()
  end, {
    desc = "Close Infinity Composer window",
  })

  vim.api.nvim_create_user_command("InfinityComposerToggle", function()
    composer.toggle()
  end, {
    desc = "Toggle Infinity Composer window",
  })

  vim.api.nvim_create_user_command("InfinityComposerApply", function()
    composer.apply_all()
  end, {
    desc = "Apply all pending diffs in Composer",
  })

  vim.api.nvim_create_user_command("InfinityComposerReject", function()
    composer.reject_all()
  end, {
    desc = "Reject all pending diffs in Composer",
  })

  -- Agent commands
  vim.api.nvim_create_user_command("InfinityAgent", function(opts)
    local goal = opts.args ~= "" and opts.args or nil
    agent.open(goal)
  end, {
    nargs = "?",
    desc = "Open Infinity Agent for autonomous coding",
  })

  vim.api.nvim_create_user_command("InfinityAgentClose", function()
    agent.close()
  end, {
    desc = "Close Infinity Agent window",
  })

  vim.api.nvim_create_user_command("InfinityAgentToggle", function()
    agent.toggle()
  end, {
    desc = "Toggle Infinity Agent window",
  })

  vim.api.nvim_create_user_command("InfinityAgentStop", function()
    agent.stop()
  end, {
    desc = "Stop running Infinity Agent",
  })

  vim.api.nvim_create_user_command("InfinityAgentCheckpoint", function()
    agent.create_checkpoint()
  end, {
    desc = "Create agent checkpoint",
  })

  vim.api.nvim_create_user_command("InfinityAgentRestore", function()
    agent.restore_checkpoint()
  end, {
    desc = "Restore agent checkpoint",
  })

  -- Review commands
  vim.api.nvim_create_user_command("InfinityReview", function(opts)
    M.open_review(opts.args)
  end, {
    nargs = "?",
    desc = "Open Infinity Code Review",
  })

  vim.api.nvim_create_user_command("InfinityReviewClose", function()
    M.close_review()
  end, {
    desc = "Close Infinity Review window",
  })

  vim.api.nvim_create_user_command("InfinityReviewToggle", function()
    M.toggle_review()
  end, {
    desc = "Toggle Infinity Review window",
  })

  -- Index commands
  vim.api.nvim_create_user_command("InfinityIndex", function(opts)
    M.trigger_index(opts.args)
  end, {
    nargs = "?",
    desc = "Trigger codebase indexing",
    complete = function()
      return { "full", "incremental", "status", "search" }
    end,
  })

  vim.api.nvim_create_user_command("InfinityIndexStatus", function()
    M.index_status()
  end, {
    desc = "Show indexing status",
  })

  vim.api.nvim_create_user_command("InfinityIndexSearch", function(opts)
    M.index_search(opts.args)
  end, {
    nargs = 1,
    desc = "Search indexed codebase",
  })

  -- Config commands
  vim.api.nvim_create_user_command("InfinityConfig", function(opts)
    M.show_config(opts.args)
  end, {
    nargs = "?",
    desc = "Show/Edit Infinity configuration",
    complete = function()
      return { "show", "reset", "edit" }
    end,
  })

  vim.api.nvim_create_user_command("InfinityHealth", function()
    M.health_check()
  end, {
    desc = "Check Infinity plugin health",
  })

  vim.api.nvim_create_user_command("InfinityConnect", function()
    M.connect()
  end, {
    desc = "Connect to Infinity API server",
  })

  vim.api.nvim_create_user_command("InfinityDisconnect", function()
    M.disconnect()
  end, {
    desc = "Disconnect from Infinity API server",
  })

  -- Autocomplete commands
  vim.api.nvim_create_user_command("InfinityAutocompleteEnable", function()
    require("infinity.autocomplete").enable()
  end, {
    desc = "Enable Infinity autocomplete",
  })

  vim.api.nvim_create_user_command("InfinityAutocompleteDisable", function()
    require("infinity.autocomplete").disable()
  end, {
    desc = "Disable Infinity autocomplete",
  })

  vim.api.nvim_create_user_command("InfinityAutocompleteToggle", function()
    require("infinity.autocomplete").toggle()
  end, {
    desc = "Toggle Infinity autocomplete",
  })

  -- Project commands
  vim.api.nvim_create_user_command("InfinityProject", function(opts)
    M.project_command(opts.args)
  end, {
    nargs = "?",
    desc = "Manage Infinity project",
    complete = function()
      return { "detect", "set", "show" }
    end,
  })

  -- Keymap help
  vim.api.nvim_create_user_command("InfinityKeys", function()
    M.show_keymaps()
  end, {
    desc = "Show Infinity keymaps",
  })

  -- Version
  vim.api.nvim_create_user_command("InfinityVersion", function()
    local init = require("infinity.init")
    vim.notify("Infinity.nvim v" .. init.version, vim.log.levels.INFO)
  end, {
    desc = "Show Infinity plugin version",
  })
end

-- Review implementation
local review_state = {
  window_id = nil,
  buffer = nil,
  review_id = nil,
}

function M.open_review(diff_or_pr)
  if review_state.window_id and ui.get_window(review_state.window_id) then
    vim.api.nvim_set_current_win(ui.get_window(review_state.window_id).win)
    return
  end

  -- Get diff from args, git, or current buffer
  local diff = diff_or_pr
  if not diff or diff == "" then
    -- Try to get git diff
    local git_diff = vim.fn.system("git diff HEAD")
    if git_diff and git_diff ~= "" then
      diff = git_diff
    else
      -- Use current buffer vs saved
      local buf = vim.api.nvim_get_current_buf()
      local filename = vim.api.nvim_buf_get_name(buf)
      if filename ~= "" then
        local saved = table.concat(vim.fn.readfile(filename), "\n")
        local current = table.concat(vim.api.nvim_buf_get_lines(buf, 0, -1, false), "\n")
        if saved ~= current then
          diff = vim.fn.system("diff -u " .. vim.fn.shellescape(filename) .. " - <<< " .. vim.fn.shellescape(current))
        end
      end
    end
  end

  if not diff or diff == "" then
    ui.notify("No diff found. Provide diff, PR number, or make changes in a git repo.", vim.log.levels.WARN)
    return
  end

  -- Create review window
  local win_data = ui.create_float({
    type = "review",
    id = "infinity_review",
    title = " Infinity Code Review ",
    on_close = function()
      review_state.window_id = nil
      review_state.buffer = nil
      review_state.review_id = nil
    end,
  })

  review_state.window_id = win_data.id
  review_state.buffer = win_data.buf

  vim.bo[review_state.buffer].modifiable = true
  vim.bo[review_state.buffer].filetype = "infinity_review"

  -- Show progress
  local progress = ui.create_progress("Creating review...")

  api.review_create(diff, { detail_level = "full" }, function(result)
    progress.close()

    if result and result.reviewId then
      review_state.review_id = result.reviewId
      M._poll_review_result()
    else
      ui.notify("Failed to create review: " .. (result.error or "Unknown error"), vim.log.levels.ERROR)
      ui.close(review_state.window_id)
    end
  end)
end

function M._poll_review_result()
  if not review_state.review_id then return end

  api.review_status(review_state.review_id, function(result)
    if result and result.status == "completed" then
      M._render_review(result.review)
    elseif result and result.status == "failed" then
      ui.notify("Review failed: " .. (result.error or "Unknown error"), vim.log.levels.ERROR)
      ui.close(review_state.window_id)
    else
      -- Still pending, poll again
      vim.defer_fn(M._poll_review_result, 2000)
    end
  end)
end

function M._render_review(review)
  local buf = review_state.buffer
  if not buf or not vim.api.nvim_buf_is_valid(buf) then return end

  local lines = { "# Code Review Results", "", string.format("**Status:** %s", review.status or "completed"), "" }

  if review.summary then
    table.insert(lines, "## Summary")
    table.insert(lines, "")
    table.insert(lines, review.summary)
    table.insert(lines, "")
  end

  if review.issues and #review.issues > 0 then
    table.insert(lines, "## Issues Found")
    table.insert(lines, "")
    for i, issue in ipairs(review.issues) do
      local severity_icon = issue.severity == "critical" and "🔴" or
                           issue.severity == "high" and "🟠" or
                           issue.severity == "medium" and "🟡" or "🟢"
      table.insert(lines, string.format("### %s %s: %s", severity_icon, issue.severity:upper(), issue.title))
      table.insert(lines, "")
      table.insert(lines, string.format("**File:** %s", issue.file or "Unknown"))
      if issue.line then
        table.insert(lines, string.format("**Line:** %d", issue.line))
      end
      table.insert(lines, "")
      table.insert(lines, issue.description or "")
      table.insert(lines, "")
      if issue.suggestion then
        table.insert(lines, "**Suggestion:**")
        table.insert(lines, "```diff")
        table.insert(lines, issue.suggestion)
        table.insert(lines, "```")
        table.insert(lines, "")
      end
      table.insert(lines, "---")
      table.insert(lines, "")
    end
  else
    table.insert(lines, "_No issues found. Code looks good!_")
  end

  vim.bo[buf].modifiable = true
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false

  -- Add keymap to open file at issue location
  vim.keymap.set("n", "<CR>", function()
    local line = vim.api.nvim_win_get_cursor(0)[1]
    local buf_lines = vim.api.nvim_buf_get_lines(buf, 0, line, false)
    local current_file = nil
    local current_line = nil

    for i = #buf_lines, 1, -1 do
      local file_match = buf_lines[i]:match("^%*%*File:%*%* (.+)$")
      local line_match = buf_lines[i]:match("^%*%*Line:%*%* (%d+)$")
      if file_match then current_file = file_match end
      if line_match then current_line = tonumber(line_match) end
      if current_file and current_line then break end
    end

    if current_file and current_line then
      vim.cmd("edit " .. vim.fn.fnameescape(current_file))
      vim.api.nvim_win_set_cursor(0, { current_line, 0 })
    end
  end, { buffer = buf, desc = "Open file at issue location" })
end

function M.close_review()
  if review_state.window_id then
    ui.close(review_state.window_id)
  end
end

function M.toggle_review()
  if review_state.window_id and ui.get_window(review_state.window_id) then
    M.close_review()
  else
    M.open_review()
  end
end

-- Index commands implementation
function M.trigger_index(mode)
  mode = mode or "incremental"

  local progress = ui.create_progress("Indexing codebase (" .. mode .. ")...")

  api.trigger_indexing(function(result)
    progress.close()

    if result and result.success then
      ui.notify("Indexing " .. (mode == "full" and "completed" or "started"), vim.log.levels.INFO)
    else
      ui.notify("Indexing failed: " .. (result.error or "Unknown error"), vim.log.levels.ERROR)
    end
  end)
end

function M.index_status()
  local progress = ui.create_progress("Fetching index status...")

  api.index_status(function(result)
    progress.close()

    if result then
      local lines = {
        "# Index Status",
        "",
        string.format("**Status:** %s", result.status or "unknown"),
        string.format("**Files Indexed:** %d", result.filesIndexed or 0),
        string.format("**Total Size:** %s", result.totalSize or "unknown"),
        string.format("**Last Updated:** %s", result.lastUpdated or "never"),
      }

      if result.progress then
        table.insert(lines, string.format("**Progress:** %d%%", result.progress))
      end

      ui.notify(table.concat(lines, "\n"), vim.log.levels.INFO, { title = "Index Status" })
    else
      ui.notify("Failed to get index status", vim.log.levels.ERROR)
    end
  end)
end

function M.index_search(query)
  if not query or query == "" then
    ui.input("Search query:", "", function(q)
      if q and q ~= "" then
        M.index_search(q)
      end
    end)
    return
  end

  local progress = ui.create_progress("Searching...")

  api.search_codebase(query, function(result)
    progress.close()

    if result and result.results and #result.results > 0 then
      local lines = { "# Search Results: " .. query, "" }
      for i, r in ipairs(result.results) do
        table.insert(lines, string.format("%d. **%s** (%.2f)", i, r.file, r.score or 0))
        if r.symbol then
          table.insert(lines, "   Symbol: " .. r.symbol)
        end
        if r.preview then
          table.insert(lines, "   " .. r.preview:sub(1, 100))
        end
        table.insert(lines, "")
      end

      -- Show in floating window
      local win_data = ui.create_float({
        type = "search",
        title = " Search Results ",
        width = 0.7,
        height = 0.6,
      })

      local buf = win_data.buf
      vim.bo[buf].modifiable = true
      vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
      vim.bo[buf].modifiable = false

      -- Keymap to open result
      vim.keymap.set("n", "<CR>", function()
        local lnum = vim.api.nvim_win_get_cursor(0)[1]
        local result_idx = lnum - 2 -- Adjust for header lines
        if result_idx >= 1 and result_idx <= #result.results then
          local r = result.results[result_idx]
          vim.cmd("edit " .. vim.fn.fnameescape(r.file))
          if r.line then
            vim.api.nvim_win_set_cursor(0, { r.line, 0 })
          end
          ui.close(win_data.id)
        end
      end, { buffer = buf, desc = "Open result" })
    else
      ui.notify("No results found for: " .. query, vim.log.levels.INFO)
    end
  end)
end

-- Config commands
function M.show_config(action)
  action = action or "show"

  if action == "reset" then
    config.reset()
    ui.notify("Configuration reset to defaults", vim.log.levels.INFO)
    return
  end

  if action == "edit" then
    -- Open config in editor
    local config_path = vim.fn.stdpath("config") .. "/lua/infinity/user_config.lua"
    vim.cmd("edit " .. config_path)
    return
  end

  -- Show current config
  local opts = config.options
  local lines = { "# Infinity Configuration", "" }

  local function format_table(t, indent)
    indent = indent or 0
    local prefix = string.rep("  ", indent)
    for k, v in pairs(t) do
      if type(v) == "table" then
        table.insert(lines, prefix .. k .. ":")
        format_table(v, indent + 1)
      else
        local val = tostring(v)
        if type(v) == "string" then val = '"' .. val .. '"' end
        table.insert(lines, prefix .. k .. ": " .. val)
      end
    end
  end

  format_table(opts)

  local win_data = ui.create_float({
    type = "config",
    title = " Infinity Config ",
    width = 0.6,
    height = 0.8,
  })

  local buf = win_data.buf
  vim.bo[buf].modifiable = true
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false
  vim.bo[buf].filetype = "yaml"
end

-- Health check
function M.health_check()
  local health = require("infinity.init").health()

  local lines = {
    "# Infinity Health Check",
    "",
    string.format("**Initialized:** %s", health.initialized and "✅" or "❌"),
    string.format("**API Connected:** %s", health.api_connected and "✅" or "❌"),
    string.format("**API URL:** %s", health.config.api_url),
    string.format("**Project ID:** %s", health.config.project_id or "auto"),
    string.format("**Autocomplete:** %s", health.config.autocomplete.enabled and "✅" or "❌"),
  }

  ui.notify(table.concat(lines, "\n"), vim.log.levels.INFO, { title = "Health Check" })
end

-- Connect/disconnect
function M.connect()
  api.connect_websocket()
  ui.notify("Connecting to Infinity API...", vim.log.levels.INFO)
end

function M.disconnect()
  api.disconnect()
  ui.notify("Disconnected from Infinity API", vim.log.levels.INFO)
end

-- Project commands
function M.project_command(subcommand)
  subcommand = subcommand or "show"

  if subcommand == "detect" then
    local project_id = config._detect_project_id()
    config.set("project_id", project_id)
    ui.notify("Detected project: " .. project_id, vim.log.levels.INFO)
  elseif subcommand == "set" then
    ui.input("Project ID:", config.get("project_id") or "", function(id)
      if id and id ~= "" then
        config.set("project_id", id)
        ui.notify("Project set to: " .. id, vim.log.levels.INFO)
      end
    end)
  else
    ui.notify("Current project: " .. (config.get("project_id") or "auto-detected"), vim.log.levels.INFO)
  end
end

-- Show keymaps
function M.show_keymaps()
  local keymaps = config.get("keymaps")
  local lines = { "# Infinity Keymaps", "", "**Prefix:** " .. (keymaps.prefix or "<leader>i"), "" }

  local function add_key(key, desc)
    local prefix = keymaps.prefix or "<leader>i"
    table.insert(lines, string.format("  %s%s - %s", prefix, key, desc))
  end

  add_key(keymaps.chat, "Open Chat")
  add_key(keymaps.composer, "Open Composer")
  add_key(keymaps.agent, "Open Agent")
  add_key(keymaps.review, "Open Review")
  add_key(keymaps.index, "Trigger Indexing")
  add_key(keymaps.toggle, "Toggle Last Window")
  add_key(keymaps.send, "Send Message")
  add_key(keymaps.accept, "Accept Suggestion")
  add_key(keymaps.reject, "Reject Suggestion")
  add_key(keymaps.next_tab, "Next Tab")
  add_key(keymaps.prev_tab, "Previous Tab")
  add_key(keymaps.close, "Close Window")
  add_key(keymaps.help, "Show Help")

  local win_data = ui.create_float({
    type = "keymaps",
    title = " Infinity Keymaps ",
    width = 0.5,
    height = 0.6,
  })

  local buf = win_data.buf
  vim.bo[buf].modifiable = true
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false
end

return M