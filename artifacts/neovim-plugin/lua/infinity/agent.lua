-- Infinity Neovim Plugin - Agent Buffer
-- Autonomous agent with timeline view, context panel, approval prompts

local M = {}

local config = require("infinity.config")
local api = require("infinity.api")
local ui = require("infinity.ui")

-- Agent state
local state = {
  window_id = nil,
  buffers = {},
  windows = {},
  agent_id = nil,
  running = false,
  paused = false,
  timeline = {},
  context = {},
  current_step = nil,
  goal = "",
  checkpoints = {},
}

-- Initialize agent
function M.init()
  api.on("agent_started", M._on_agent_started)
  api.on("agent_step", M._on_agent_step)
  api.on("agent_thinking", M._on_agent_thinking)
  api.on("agent_tool_call", M._on_agent_tool_call)
  api.on("agent_tool_result", M._on_agent_tool_result)
  api.on("agent_approval_required", M._on_approval_required)
  api.on("agent_completed", M._on_agent_completed)
  api.on("agent_error", M._on_agent_error)
  api.on("agent_checkpoint", M._on_checkpoint)
end

-- Open agent window
function M.open(goal)
  if state.window_id and ui.get_window(state.window_id) then
    vim.api.nvim_set_current_win(ui.get_window(state.window_id).win)
    if goal then
      M.set_goal(goal)
    end
    return
  end

  state.goal = goal or ""
  state.timeline = {}
  state.context = {}
  state.agent_id = nil
  state.running = false
  state.paused = false
  state.current_step = nil

  -- Create main window with sidebar layout
  M._create_agent_layout()

  if goal and goal ~= "" then
    M.start()
  else
    M._render_welcome()
  end
end

-- Create agent layout with timeline and context panels
function M._create_agent_layout()
  -- Main container window
  local win_data = ui.create_float({
    type = "agent",
    id = "infinity_agent",
    title = " Infinity Agent ",
    width = 0.8,
    height = 0.85,
    position = "center",
    on_close = function()
      state.window_id = nil
      state.buffers = {}
      state.windows = {}
      if state.running then
        M.stop()
      end
    end,
  })

  state.window_id = win_data.id
  local main_win = win_data.win
  local main_buf = win_data.buf

  -- Create timeline buffer (left panel)
  state.buffers.timeline = vim.api.nvim_create_buf(false, true)
  vim.bo[state.buffers.timeline].buftype = "nofile"
  vim.bo[state.buffers.timeline].bufhidden = "wipe"
  vim.bo[state.buffers.timeline].filetype = "infinity_agent_timeline"

  -- Create context buffer (right panel)
  state.buffers.context = vim.api.nvim_create_buf(false, true)
  vim.bo[state.buffers.context].buftype = "nofile"
  vim.bo[state.buffers.context].bufhidden = "wipe"
  vim.bo[state.buffers.context].filetype = "infinity_agent_context"

  -- Split main window horizontally for timeline | context
  -- We'll use a single buffer with virtual split, or create two windows
  -- For simplicity, use tabs for now
  M._setup_tabs()

  -- Set up keymaps
  local buf = main_buf
  local send_key = config.get("keymaps.send") or "<C-s>"
  local accept_key = config.get("keymaps.accept") or "<C-a>"
  local reject_key = config.get("keymaps.reject") or "<C-r>"

  vim.keymap.set({ "n", "i" }, send_key, function() M.start() end, { buffer = buf, desc = "Start/Continue agent" })
  vim.keymap.set("n", "<Space>", function() M.toggle_pause() end, { buffer = buf, desc = "Pause/Resume agent" })
  vim.keymap.set("n", accept_key, function() M.approve_step(true) end, { buffer = buf, desc = "Approve step" })
  vim.keymap.set("n", reject_key, function() M.approve_step(false) end, { buffer = buf, desc = "Reject step" })
  vim.keymap.set("n", "<leader>c", function() M.create_checkpoint() end, { buffer = buf, desc = "Create checkpoint" })
  vim.keymap.set("n", "<leader>r", function() M.restore_checkpoint() end, { buffer = buf, desc = "Restore checkpoint" })
end

-- Set up tabs for Timeline/Context/Config
function M._setup_tabs()
  local tabs_config = {
    { title = "Timeline", content = {}, on_select = function() M._show_timeline() end },
    { title = "Context", content = {}, on_select = function() M._show_context() end },
    { title = "Config", content = {}, on_select = function() M._show_config() end },
  }

  -- We'll manage tabs manually since ui.create_tabs creates a new window
  -- For now, just render timeline in main buffer
  M._show_timeline()
end

-- Show timeline tab
function M._show_timeline()
  local buf = state.buffers.timeline
  local win_data = ui.get_window(state.window_id)
  if win_data then
    vim.api.nvim_win_set_buf(win_data.win, buf)
  end
  M._render_timeline()
end

-- Show context tab
function M._show_context()
  local buf = state.buffers.context
  local win_data = ui.get_window(state.window_id)
  if win_data then
    vim.api.nvim_win_set_buf(win_data.win, buf)
  end
  M._render_context()
end

-- Show config tab
function M._show_config()
  local buf = state.buffers.config or vim.api.nvim_create_buf(false, true)
  state.buffers.config = buf
  local win_data = ui.get_window(state.window_id)
  if win_data then
    vim.api.nvim_win_set_buf(win_data.win, buf)
  end
  M._render_config()
end

-- Render timeline
function M._render_timeline()
  local buf = state.buffers.timeline
  local lines = { "# Agent Timeline", "", string.format("Goal: %s", state.goal), "" }

  if #state.timeline == 0 then
    table.insert(lines, "_Agent not started. Press <C-s> to begin._")
    table.insert(lines, "")
    table.insert(lines, "Controls:")
    table.insert(lines, "  <C-s>     - Start/Continue")
    table.insert(lines, "  <Space>   - Pause/Resume")
    table.insert(lines, "  <C-a>     - Approve step")
    table.insert(lines, "  <C-r>     - Reject step")
    table.insert(lines, "  <leader>c - Create checkpoint")
    table.insert(lines, "  <leader>r - Restore checkpoint")
  else
    for i, entry in ipairs(state.timeline) do
      local icon, prefix, hl
      if entry.type == "thinking" then
        icon = "💭"
        prefix = "Thinking"
        hl = "InfinityAgentThinking"
      elseif entry.type == "tool_call" then
        icon = "🔧"
        prefix = "Tool: " .. entry.tool
        hl = "InfinityAgentAction"
      elseif entry.type == "tool_result" then
        icon = "✅"
        prefix = "Result"
        hl = "InfinityAgentResult"
      elseif entry.type == "approval" then
        icon = "⚠️"
        prefix = "Approval Required"
        hl = "InfinityAgentApproval"
      elseif entry.type == "error" then
        icon = "❌"
        prefix = "Error"
        hl = "InfinityChatError"
      elseif entry.type == "checkpoint" then
        icon = "💾"
        prefix = "Checkpoint"
        hl = "InfinityChatAssistant"
      else
        icon = "📝"
        prefix = entry.type
        hl = "Normal"
      end

      local time_str = entry.timestamp and os.date("%H:%M:%S", entry.timestamp) or ""
      local line = string.format("%s [%s] %s", icon, time_str, prefix)
      table.insert(lines, line)

      if entry.content then
        for _, cline in ipairs(vim.split(entry.content, "\n")) do
          table.insert(lines, "  " .. cline)
        end
      end
      table.insert(lines, "")
    end
  end

  vim.bo[buf].modifiable = true
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false

  -- Auto-scroll to bottom
  local win_data = ui.get_window(state.window_id)
  if win_data and vim.api.nvim_win_is_valid(win_data.win) and vim.api.nvim_win_get_buf(win_data.win) == buf then
    vim.api.nvim_win_set_cursor(win_data.win, { #lines, 0 })
  end
end

-- Render context panel
function M._render_context()
  local buf = state.buffers.context
  local lines = { "# Agent Context", "", string.format("Goal: %s", state.goal), "", "## Current Step", "" }

  if state.current_step then
    table.insert(lines, string.format("**Type:** %s", state.current_step.type or "unknown"))
    table.insert(lines, string.format("**Tool:** %s", state.current_step.tool or "N/A"))
    if state.current_step.args then
      table.insert(lines, "**Args:**")
      table.insert(lines, "```json")
      table.insert(lines, vim.json.encode(state.current_step.args))
      table.insert(lines, "```")
    end
    if state.current_step.result then
      table.insert(lines, "**Result:**")
      table.insert(lines, "```")
      table.insert(lines, vim.inspect(state.current_step.result):sub(1, 500))
      table.insert(lines, "```")
    end
  else
    table.insert(lines, "_No active step_")
  end

  table.insert(lines, "")
  table.insert(lines, "## Checkpoints")
  if #state.checkpoints > 0 then
    for i, cp in ipairs(state.checkpoints) do
      table.insert(lines, string.format("%d. Step %d - %s", i, cp.step, os.date("%H:%M:%S", cp.time)))
    end
  else
    table.insert(lines, "_No checkpoints_")
  end

  table.insert(lines, "")
  table.insert(lines, "## Files Modified")
  local modified_files = {}
  for _, entry in ipairs(state.timeline) do
    if entry.type == "tool_call" and entry.tool and entry.tool:match("write|edit") and entry.args and entry.args.path then
      modified_files[entry.args.path] = true
    end
  end
  for path, _ in pairs(modified_files) do
    table.insert(lines, "  - " .. path)
  end
  if vim.tbl_isempty(modified_files) then
    table.insert(lines, "_None_")
  end

  vim.bo[buf].modifiable = true
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false
end

-- Render config panel
function M._render_config()
  local buf = state.buffers.config
  local lines = { "# Agent Configuration", "", "## Settings", "" }

  local settings = {
    { key = "max_iterations", label = "Max Iterations", value = config.get("agent.max_iterations") },
    { key = "auto_approve", label = "Auto Approve", value = config.get("agent.auto_approve") },
    { key = "show_thinking", label = "Show Thinking", value = config.get("agent.show_thinking") },
    { key = "checkpoint_interval", label = "Checkpoint Interval", value = config.get("agent.checkpoint_interval") },
  }

  for _, s in ipairs(settings) do
    local val = tostring(s.value)
    if type(s.value) == "boolean" then val = s.value and "ON" or "OFF" end
    table.insert(lines, string.format("  %s: %s", s.label, val))
  end

  table.insert(lines, "")
  table.insert(lines, "## Controls")
  table.insert(lines, "  Press <C-s> to start/continue")
  table.insert(lines, "  Press <Space> to pause/resume")
  table.insert(lines, "  Press <C-a> to approve, <C-r> to reject")

  vim.bo[buf].modifiable = true
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false
end

-- Render welcome screen
function M._render_welcome()
  local win_data = ui.get_window(state.window_id)
  if not win_data then return end

  local buf = vim.api.nvim_create_buf(false, true)
  state.buffers.welcome = buf

  local lines = {
    "╔══════════════════════════════════════════════════════════════╗",
    "║                     INFINITY AGENT                            ║",
    "╠══════════════════════════════════════════════════════════════╣",
    "║                                                               ║",
    "║  Autonomous coding agent that can:                           ║",
    "║  • Explore codebase                                          ║",
    "║  • Plan multi-step tasks                                     ║",
    "║  • Write, edit, and delete files                             ║",
    "║  • Run commands and tests                                    ║",
    "║  • Search and analyze code                                   ║",
    "║  • Request approval for sensitive actions                    ║",
    "║                                                               ║",
    "║  Press <C-s> to start with a goal                            ║",
    "║  Or run :InfinityAgent \"your goal here\"                     ║",
    "║                                                               ║",
    "╚══════════════════════════════════════════════════════════════╝",
  }

  vim.bo[buf].modifiable = true
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  vim.bo[buf].modifiable = false
  vim.bo[buf].filetype = "infinity_agent_welcome"

  vim.api.nvim_win_set_buf(win_data.win, buf)
end

-- Set goal
function M.set_goal(goal)
  state.goal = goal
  M._render_timeline()
end

-- Start agent
function M.start()
  if state.running and not state.paused then
    return
  end

  if state.goal == "" then
    ui.input("Agent goal:", "", function(goal)
      if goal and goal ~= "" then
        state.goal = goal
        M.start()
      end
    end)
    return
  end

  if state.paused then
    -- Resume from pause
    state.paused = false
    M._add_timeline_entry({ type = "thinking", content = "Resuming...", timestamp = os.time() })
    M._continue_agent()
    return
  end

  -- Fresh start
  state.running = true
  state.timeline = {}
  state.checkpoints = {}

  M._add_timeline_entry({ type = "thinking", content = "Starting agent with goal: " .. state.goal, timestamp = os.time() })

  local progress = ui.create_progress("Starting agent...")

  api.agent_run(state.goal, {
    maxIterations = config.get("agent.max_iterations"),
    autoApprove = config.get("agent.auto_approve"),
  }, function(result)
    progress.close()

    if result and result.agentId then
      state.agent_id = result.agentId
      M._continue_agent()
    else
      state.running = false
      ui.notify("Failed to start agent: " .. (result.error or "Unknown error"), vim.log.levels.ERROR)
      M._add_timeline_entry({ type = "error", content = result.error or "Unknown error", timestamp = os.time() })
    end
  end)
end

-- Continue agent (for multi-step)
function M._continue_agent()
  if not state.agent_id or not state.running or state.paused then
    return
  end

  -- The server will push steps via WebSocket events
  -- We just wait for events
end

-- Stop agent
function M.stop()
  if not state.agent_id then return end

  state.running = false
  state.paused = false

  api.agent_stop(state.agent_id, function(result)
    if result and result.success then
      M._add_timeline_entry({ type = "thinking", content = "Agent stopped", timestamp = os.time() })
    end
  end)
end

-- Toggle pause
function M.toggle_pause()
  if not state.running then return end

  state.paused = not state.paused
  if state.paused then
    M._add_timeline_entry({ type = "thinking", content = "Paused (press Space to resume)", timestamp = os.time() })
    ui.notify("Agent paused", vim.log.levels.INFO)
  else
    M._add_timeline_entry({ type = "thinking", content = "Resuming...", timestamp = os.time() })
    M._continue_agent()
    ui.notify("Agent resumed", vim.log.levels.INFO)
  end
end

-- Approve/reject current step
function M.approve_step(approved)
  if not state.agent_id or not state.current_step then
    ui.notify("No pending approval", vim.log.levels.WARN)
    return
  end

  local step_id = state.current_step.id
  state.current_step = nil

  api.agent_approve(state.agent_id, step_id, approved, function(result)
    if result and result.success then
      ui.notify(approved and "Step approved" or "Step rejected", vim.log.levels.INFO)
      M._continue_agent()
    else
      ui.notify("Failed to send approval", vim.log.levels.ERROR)
    end
  end)
end

-- Create checkpoint
function M.create_checkpoint()
  if not state.agent_id then
    ui.notify("No active agent", vim.log.levels.WARN)
    return
  end

  -- Checkpoint is created automatically by server at intervals
  -- But we can request one
  table.insert(state.checkpoints, {
    step = #state.timeline,
    time = os.time(),
    timeline = vim.deepcopy(state.timeline),
  })

  M._add_timeline_entry({ type = "checkpoint", content = "Manual checkpoint created", timestamp = os.time() })
  ui.notify("Checkpoint created", vim.log.levels.INFO)
end

-- Restore checkpoint
function M.restore_checkpoint()
  if #state.checkpoints == 0 then
    ui.notify("No checkpoints available", vim.log.levels.WARN)
    return
  end

  local items = {}
  for i, cp in ipairs(state.checkpoints) do
    table.insert(items, string.format("Checkpoint %d - Step %d (%s)", i, cp.step, os.date("%H:%M:%S", cp.time)))
  end

  ui.select(items, { prompt = "Select checkpoint to restore:" }, function(choice, idx)
    if idx then
      local cp = state.checkpoints[idx]
      state.timeline = vim.deepcopy(cp.timeline)
      M._render_timeline()
      ui.notify("Restored to checkpoint " .. idx, vim.log.levels.INFO)
    end
  end)
end

-- Add entry to timeline
function M._add_timeline_entry(entry)
  table.insert(state.timeline, entry)
  M._render_timeline()
  M._render_context()
end

-- Event handlers
function M._on_agent_started(data)
  state.agent_id = data.agentId
  state.running = true
  M._add_timeline_entry({ type = "thinking", content = "Agent started: " .. (data.agentId or ""), timestamp = os.time() })
end

function M._on_agent_step(data)
  state.current_step = data.step
  M._add_timeline_entry({
    type = "tool_call",
    tool = data.step.tool,
    content = "Calling " .. data.step.tool .. " with args: " .. vim.json.encode(data.step.args):sub(1, 200),
    timestamp = os.time(),
  })
end

function M._on_agent_thinking(data)
  if config.get("agent.show_thinking") ~= false then
    M._add_timeline_entry({
      type = "thinking",
      content = data.thought or "Processing...",
      timestamp = os.time(),
    })
  end
end

function M._on_agent_tool_call(data)
  M._add_timeline_entry({
    type = "tool_call",
    tool = data.tool,
    content = data.description or ("Calling " .. data.tool),
    timestamp = os.time(),
  })
end

function M._on_agent_tool_result(data)
  M._add_timeline_entry({
    type = "tool_result",
    tool = data.tool,
    content = data.result and vim.inspect(data.result):sub(1, 300) or "Done",
    timestamp = os.time(),
  })
end

function M._on_approval_required(data)
  state.current_step = data.step
  state.running = false -- Pause until approval

  M._add_timeline_entry({
    type = "approval",
    content = string.format("Approval required for: %s\nArgs: %s", data.step.tool, vim.json.encode(data.step.args):sub(1, 500)),
    timestamp = os.time(),
  })

  -- Show approval dialog
  ui.confirm(
    string.format("Approve %s?\n%s", data.step.tool, vim.inspect(data.step.args):sub(1, 300)),
    { "Approve", "Reject", "View Details" },
    function(choice, idx)
      if idx == 1 then
        M.approve_step(true)
      elseif idx == 2 then
        M.approve_step(false)
      elseif idx == 3 then
        M._show_context() -- Switch to context tab for details
      end
    end
  )
end

function M._on_agent_completed(data)
  state.running = false
  state.agent_id = nil

  M._add_timeline_entry({
    type = "thinking",
    content = "Agent completed: " .. (data.summary or "Done"),
    timestamp = os.time(),
  })

  ui.notify("Agent completed: " .. (data.summary or "Done"), vim.log.levels.INFO)
end

function M._on_agent_error(data)
  state.running = false

  M._add_timeline_entry({
    type = "error",
    content = data.error or "Unknown error",
    timestamp = os.time(),
  })

  ui.notify("Agent error: " .. (data.error or "Unknown error"), vim.log.levels.ERROR)
end

function M._on_checkpoint(data)
  table.insert(state.checkpoints, {
    step = data.step,
    time = os.time(),
    timeline = vim.deepcopy(state.timeline),
  })
  M._render_context()
end

-- Close agent window
function M.close()
  if state.running then
    ui.confirm("Agent is running. Stop and close?", { "Yes", "No" }, function(choice, idx)
      if idx == 1 then
        M.stop()
        vim.defer_fn(function() ui.close(state.window_id) end, 500)
      end
    end)
  else
    ui.close(state.window_id)
  end
end

-- Toggle agent window
function M.toggle()
  if state.window_id and ui.get_window(state.window_id) then
    M.close()
  else
    M.open()
  end
end

return M