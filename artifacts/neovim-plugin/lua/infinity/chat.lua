-- Infinity Neovim Plugin - Chat Buffer
-- Floating window with message history, @codebase integration, file attachment

local M = {}

local config = require("infinity.config")
local api = require("infinity.api")
local ui = require("infinity.ui")

-- Chat state
local state = {
  window_id = nil,
  buffer = nil,
  messages = {},
  input_buffer = nil,
  streaming = false,
  current_response = "",
  codebase_results = {},
  attached_files = {},
}

-- Initialize chat
function M.init()
  -- Set up event handlers
  api.on("chat_message", M._on_chat_message)
  api.on("chat_chunk", M._on_chat_chunk)
  api.on("chat_complete", M._on_chat_complete)
  api.on("chat_error", M._on_chat_error)
  api.on("codebase_results", M._on_codebase_results)
end

-- Open chat window
function M.open(initial_message)
  if state.window_id and ui.get_window(state.window_id) then
    -- Focus existing window
    vim.api.nvim_set_current_win(ui.get_window(state.window_id).win)
    return
  end

  -- Create main chat window
  local win_data = ui.create_float({
    type = "chat",
    id = "infinity_chat",
    title = " Infinity Chat ",
    on_close = function()
      state.window_id = nil
      state.buffer = nil
      state.input_buffer = nil
    end,
  })

  state.window_id = win_data.id
  state.buffer = win_data.buf
  state.messages = {}
  state.attached_files = {}

  -- Set up buffer
  vim.bo[state.buffer].modifiable = true
  vim.bo[state.buffer].filetype = "infinity_chat"

  -- Create input area at bottom
  M._create_input_area()

  -- Render initial messages
  M._render_messages()

  -- Add initial message if provided
  if initial_message then
    M._add_user_message(initial_message)
    M.send()
  end

  -- Focus input
  vim.api.nvim_set_current_win(win_data.win)
  vim.cmd("startinsert")
end

-- Close chat window
function M.close()
  if state.window_id then
    ui.close(state.window_id)
  end
end

-- Toggle chat window
function M.toggle()
  if state.window_id and ui.get_window(state.window_id) then
    M.close()
  else
    M.open()
  end
end

-- Create input area (separate buffer at bottom)
function M._create_input_area()
  local win_data = ui.get_window(state.window_id)
  if not win_data then return end

  -- Create input buffer
  state.input_buffer = vim.api.nvim_create_buf(false, true)
  vim.bo[state.input_buffer].buftype = "nofile"
  vim.bo[state.input_buffer].bufhidden = "wipe"
  vim.bo[state.input_buffer].filetype = "infinity_chat_input"

  -- Open input window below main chat
  local chat_win = win_data.win
  local chat_config = vim.api.nvim_win_get_config(chat_win)

  local input_win = vim.api.nvim_open_win(state.input_buffer, true, {
    relative = "editor",
    width = chat_config.width,
    height = 3,
    row = chat_config.row + chat_config.height + 1,
    col = chat_config.col,
    style = "minimal",
    border = "rounded",
    title = " Input (Ctrl+S to send, @codebase, @file) ",
    title_pos = "left",
    zindex = chat_config.zindex + 1,
  })

  vim.wo[input_win].wrap = true
  vim.wo[input_win].number = false

  -- Store input window reference
  M.windows = M.windows or {}
  M.windows[state.window_id .. "_input"] = { win = input_win, buf = state.input_buffer }

  -- Set up input keymaps
  local send_key = config.get("keymaps.send") or "<C-s>"
  vim.keymap.set({ "n", "i" }, send_key, function()
    M.send()
  end, { buffer = state.input_buffer, desc = "Send chat message" })

  -- @codebase trigger
  vim.keymap.set("i", "@codebase", function()
    M._trigger_codebase_search()
  end, { buffer = state.input_buffer, desc = "Trigger codebase search" })

  -- @file trigger
  vim.keymap.set("i", "@file", function()
    M._attach_file()
  end, { buffer = state.input_buffer, desc = "Attach file" })

  -- Exit insert mode with Escape
  vim.keymap.set("i", "<Esc>", function()
    vim.cmd("stopinsert")
  end, { buffer = state.input_buffer, desc = "Exit insert mode" })

  -- Set up syntax highlighting for triggers
  vim.api.nvim_buf_set_var(state.input_buffer, "infinity_chat_input", true)
end

-- Send message
function M.send()
  if state.streaming then
    return
  end

  local input_lines = vim.api.nvim_buf_get_lines(state.input_buffer, 0, -1, false)
  local message = table.concat(input_lines, "\n"):gsub("^%s+", ""):gsub("%s+$", "")

  if message == "" then
    return
  end

  -- Clear input
  vim.api.nvim_buf_set_lines(state.input_buffer, 0, -1, false, { "" })

  -- Add user message
  M._add_user_message(message)

  -- Check for @codebase trigger
  local codebase_query = message:match("@codebase%s+(.+)")
  if codebase_query then
    M._search_codebase(codebase_query)
    return
  end

  -- Check for @file attachments
  local file_refs = {}
  for file in message:gmatch("@file%s+(%S+)") do
    table.insert(file_refs, file)
  end

  -- Prepare messages for API
  local api_messages = {}
  for _, msg in ipairs(state.messages) do
    if msg.role ~= "system" then
      table.insert(api_messages, { role = msg.role, content = msg.content })
    end
  end

  -- Add file contents if attached
  if #state.attached_files > 0 then
    local file_contents = {}
    for _, file in ipairs(state.attached_files) do
      table.insert(file_contents, string.format("--- File: %s ---\n%s", file.path, file.content))
    end
    local last_msg = api_messages[#api_messages]
    if last_msg and last_msg.role == "user" then
      last_msg.content = last_msg.content .. "\n\n**Attached Files:**\n" .. table.concat(file_contents, "\n\n")
    end
  end

  -- Send to API
  state.streaming = true
  state.current_response = ""

  api.send_chat_message(api_messages,
    function(chunk)  -- on_chunk
      M._handle_stream_chunk(chunk)
    end,
    function(result)  -- on_complete
      M._handle_stream_complete(result)
    end
  )
end

-- Handle streaming chunk
function M._handle_stream_chunk(chunk)
  if not state.buffer or not vim.api.nvim_buf_is_valid(state.buffer) then
    return
  end

  state.current_response = state.current_response .. (chunk.content or chunk.delta or "")

  -- Update last assistant message in buffer
  vim.schedule(function()
    M._update_last_assistant_message(state.current_response)
  end)
end

-- Handle stream complete
function M._handle_stream_complete(result)
  state.streaming = false
  state.current_response = ""

  -- Final render
  vim.schedule(function()
    M._render_messages()
  end)

  -- Handle tool calls if any
  if result and result.tool_calls then
    for _, tool_call in ipairs(result.tool_calls) do
      M._display_tool_call(tool_call)
    end
  end
end

-- Add user message
function M._add_user_message(content)
  table.insert(state.messages, {
    role = "user",
    content = content,
    timestamp = os.time(),
  })
  M._render_messages()
end

-- Add assistant message
function M._add_assistant_message(content)
  table.insert(state.messages, {
    role = "assistant",
    content = content,
    timestamp = os.time(),
  })
end

-- Update last assistant message (for streaming)
function M._update_last_assistant_message(content)
  -- Find last assistant message index
  local last_idx = nil
  for i = #state.messages, 1, -1 do
    if state.messages[i].role == "assistant" then
      last_idx = i
      break
    end
  end

  if last_idx then
    state.messages[last_idx].content = content
  else
    M._add_assistant_message(content)
  end

  -- Re-render just the last message area
  M._render_messages()
end

-- Display tool call
function M._display_tool_call(tool_call)
  table.insert(state.messages, {
    role = "tool",
    content = string.format("🔧 **Tool Call**: `%s`\n```json\n%s\n```", tool_call.name, vim.json.encode(tool_call.args)),
    timestamp = os.time(),
    tool_call = tool_call,
  })
  M._render_messages()
end

-- Render all messages to buffer
function M._render_messages()
  if not state.buffer or not vim.api.nvim_buf_is_valid(state.buffer) then
    return
  end

  local lines = {}
  local highlights = {}

  for i, msg in ipairs(state.messages) do
    local prefix, hl_group
    if msg.role == "user" then
      prefix = "▸ You"
      hl_group = "InfinityChatUser"
    elseif msg.role == "assistant" then
      prefix = "◂ Assistant"
      hl_group = "InfinityChatAssistant"
    elseif msg.role == "tool" then
      prefix = "⚙ Tool"
      hl_group = "InfinityChatTool"
    elseif msg.role == "system" then
      prefix = "⚙ System"
      hl_group = "InfinityChatError"
    else
      prefix = "  " .. msg.role
      hl_group = "Normal"
    end

    local line_num = #lines + 1
    table.insert(lines, prefix)
    table.insert(highlights, { line = line_num, col_start = 0, col_end = #prefix, hl_group = hl_group })

    -- Message content
    local content_lines = vim.split(msg.content, "\n")
    for _, cline in ipairs(content_lines) do
      table.insert(lines, "  " .. cline)
    end

    -- Timestamp
    local time_str = os.date("%H:%M:%S", msg.timestamp)
    table.insert(lines, string.rep("─", 40))
    table.insert(lines, "")
  end

  vim.bo[state.buffer].modifiable = true
  vim.api.nvim_buf_set_lines(state.buffer, 0, -1, false, lines)
  vim.bo[state.buffer].modifiable = false

  -- Apply highlights
  local ns = vim.api.nvim_create_namespace("infinity_chat")
  vim.api.nvim_buf_clear_namespace(state.buffer, ns, 0, -1)
  for _, hl in ipairs(highlights) do
    vim.api.nvim_buf_add_highlight(state.buffer, ns, hl.hl_group, hl.line - 1, hl.col_start, hl.col_end)
  end

  -- Auto-scroll to bottom
  if config.get("chat.auto_scroll") ~= false then
    local win = ui.get_window(state.window_id)
    if win and vim.api.nvim_win_is_valid(win.win) then
      vim.api.nvim_win_set_cursor(win.win, { #lines, 0 })
    end
  end
end

-- Trigger codebase search
function M._trigger_codebase_search()
  ui.input("Codebase search query:", "", function(query)
    if query and query ~= "" then
      M._search_codebase(query)
    end
  end)
end

-- Search codebase
function M._search_codebase(query)
  ui.notify("Searching codebase for: " .. query, vim.log.levels.INFO)

  api.search_codebase(query, function(result)
    if result and result.results then
      state.codebase_results = result.results
      M._display_codebase_results(result.results)
    else
      ui.notify("No codebase results found", vim.log.levels.WARN)
    end
  end)
end

-- Display codebase results
function M._display_codebase_results(results)
  if #results == 0 then
    return
  end

  local lines = { "", "📚 **Codebase Results:**", "" }
  for i, result in ipairs(results) do
    table.insert(lines, string.format("  %d. `%s` (score: %.2f)", i, result.file, result.score or 0))
    if result.symbol then
      table.insert(lines, string.format("     Symbol: %s", result.symbol))
    end
    if result.preview then
      table.insert(lines, string.format("     %s", result.preview:sub(1, 80)))
    end
    table.insert(lines, "")
  end

  -- Insert into chat
  vim.bo[state.buffer].modifiable = true
  local current_lines = vim.api.nvim_buf_get_lines(state.buffer, 0, -1, false)
  for _, line in ipairs(lines) do
    table.insert(current_lines, line)
  end
  vim.api.nvim_buf_set_lines(state.buffer, 0, -1, false, current_lines)
  vim.bo[state.buffer].modifiable = false

  -- Add to messages for history
  table.insert(state.messages, {
    role = "system",
    content = table.concat(lines, "\n"),
    timestamp = os.time(),
  })
end

-- Attach file using telescope or fzf
function M._attach_file()
  local picker_prefer = config.get("picker.prefer_telescope")
  local has_telescope, telescope = pcall(require, "telescope.builtin")
  local has_fzf, fzf = pcall(require, "fzf-lua")

  if picker_prefer and has_telescope then
    telescope.find_files({
      prompt_title = "Attach File to Chat",
      attach_mappings = function(prompt_bufnr, map)
        local actions = require("telescope.actions")
        local action_state = require("telescope.actions.state")

        actions.select_default:replace(function()
          local selection = action_state.get_selected_entry()
          actions.close(prompt_bufnr)
          M._read_and_attach_file(selection.path)
        end)
        return true
      end,
    })
  elseif has_fzf then
    fzf.files({
      prompt = "Attach File > ",
      actions = {
        ["default"] = function(selected)
          M._read_and_attach_file(selected[1])
        end,
      },
    })
  else
    -- Fallback to vim.ui.input
    ui.input("File path to attach:", "", function(path)
      if path and path ~= "" then
        M._read_and_attach_file(path)
      end
    end)
  end
end

-- Read and attach file
function M._read_and_attach_file(path)
  vim.schedule(function()
    local full_path = vim.fn.fnamemodify(path, ":p")
    local content = table.concat(vim.fn.readfile(full_path), "\n")

    table.insert(state.attached_files, {
      path = path,
      content = content,
    })

    ui.notify("Attached: " .. path, vim.log.levels.INFO)

    -- Show attached file in chat
    M._add_system_message("📎 Attached file: " .. path)
  end)
end

-- Add system message
function M._add_system_message(content)
  table.insert(state.messages, {
    role = "system",
    content = content,
    timestamp = os.time(),
  })
  M._render_messages()
end

-- Event handlers
function M._on_chat_message(data)
  -- Handle incoming chat messages from WebSocket
end

function M._on_chat_chunk(data)
  M._handle_stream_chunk(data)
end

function M._on_chat_complete(data)
  M._handle_stream_complete(data)
end

function M._on_chat_error(data)
  state.streaming = false
  ui.notify("Chat error: " .. (data.error or "Unknown error"), vim.log.levels.ERROR)
end

function M._on_codebase_results(data)
  if data and data.results then
    M._display_codebase_results(data.results)
  end
end

-- Get chat history
function M.get_history()
  return state.messages
end

-- Clear chat history
function M.clear()
  state.messages = {}
  state.attached_files = {}
  state.codebase_results = {}
  M._render_messages()
end

return M