-- Infinity Neovim Plugin - API Client (REST + WebSocket)
-- Connects to Infinity API server for chat, composer, agent, autocomplete, indexing

local M = {}

-- State
local state = {
  config = nil,
  ws = nil,
  ws_connected = false,
  ws_reconnect_timer = nil,
  request_id = 0,
  pending_requests = {},
  event_handlers = {},
  auth_token = nil,
}

-- Initialize API client
function M.init(config)
  state.config = config
  state.auth_token = config.api_key

  if config.auto_connect then
    M.connect_websocket()
  end

  return M
end

-- Check if WebSocket is connected
function M.is_connected()
  return state.ws_connected
end

-- Get auth headers
local function get_headers()
  local headers = {
    ["Content-Type"] = "application/json",
  }
  if state.auth_token then
    headers["Authorization"] = "Bearer " .. state.auth_token
  end
  return headers
end

-- Generate unique request ID
local function gen_request_id()
  state.request_id = state.request_id + 1
  return state.request_id
end

-- Make HTTP request using plenary.nvim
local function http_request(method, path, body, callback)
  local url = state.config.api_url .. path
  local job_id = gen_request_id()

  local request_data = {
    method = method,
    url = url,
    headers = get_headers(),
    timeout = state.config.request_timeout,
  }

  if body then
    request_data.body = vim.json.encode(body)
  end

  -- Use plenary.curl if available, fallback to vim.system
  local has_plenary, curl = pcall(require, "plenary.curl")
  if has_plenary then
    local ok, response = pcall(curl.request, request_data)
    if ok and response then
      local data = nil
      if response.body and response.body ~= "" then
        local ok_decode, decoded = pcall(vim.json.decode, response.body)
        if ok_decode then
          data = decoded
        end
      end
      callback(data, response.status, response.headers)
    else
      callback(nil, 0, {})
    end
  else
    -- Fallback to vim.system (Neovim 0.10+)
    local args = { "curl", "-s", "-X", method, url }
    for k, v in pairs(get_headers()) do
      table.insert(args, "-H")
      table.insert(args, k .. ": " .. v)
    end
    if body then
      table.insert(args, "-d")
      table.insert(args, vim.json.encode(body))
    end
    table.insert(args, "--max-time")
    table.insert(args, tostring(math.floor(state.config.request_timeout / 1000)))

    vim.system(args, { text = true }, function(result)
      local data = nil
      if result.stdout and result.stdout ~= "" then
        local ok_decode, decoded = pcall(vim.json.decode, result.stdout)
        if ok_decode then
          data = decoded
        end
      end
      callback(data, result.code, {})
    end)
  end
end

-- ============================================================================
-- REST API Methods
-- ============================================================================

-- Health check
function M.health(callback)
  http_request("GET", "/health", nil, callback)
end

-- Chat endpoints
function M.chat_send(messages, options, callback)
  http_request("POST", "/api/infinity/chat", {
    messages = messages,
    projectId = state.config.project_id,
    options = options or {},
  }, callback)
end

function M.chat_stream(messages, options, on_chunk, on_complete)
  -- For streaming, we'll use WebSocket
  M.ws_send({
    type = "chat",
    action = "stream",
    payload = {
      messages = messages,
      projectId = state.config.project_id,
      options = options or {},
    },
  }, on_chunk, on_complete)
end

-- Composer endpoints
function M.composer_create(task, context_files, callback)
  http_request("POST", "/api/infinity/composer", {
    task = task,
    projectId = state.config.project_id,
    contextFiles = context_files or {},
  }, callback)
end

function M.composer_apply(composer_id, file_diffs, callback)
  http_request("POST", "/api/infinity/composer/" .. composer_id .. "/apply", {
    diffs = file_diffs,
  }, callback)
end

function M.composer_preview(composer_id, callback)
  http_request("GET", "/api/infinity/composer/" .. composer_id .. "/preview", nil, callback)
end

-- Agent endpoints
function M.agent_run(goal, options, callback)
  http_request("POST", "/api/infinity/agent/run", {
    goal = goal,
    projectId = state.config.project_id,
    options = options or {},
  }, callback)
end

function M.agent_status(agent_id, callback)
  http_request("GET", "/api/infinity/agent/" .. agent_id .. "/status", nil, callback)
end

function M.agent_stop(agent_id, callback)
  http_request("POST", "/api/infinity/agent/" .. agent_id .. "/stop", nil, callback)
end

function M.agent_approve(agent_id, step_id, approved, callback)
  http_request("POST", "/api/infinity/agent/" .. agent_id .. "/approve", {
    stepId = step_id,
    approved = approved,
  }, callback)
end

-- Autocomplete (Tab) endpoints
function M.autocomplete_suggest(context, callback)
  http_request("POST", "/api/infinity/autocomplete/suggest", {
    projectId = state.config.project_id,
    context = context,
  }, callback)
end

-- Indexing endpoints
function M.index_project(callback)
  http_request("POST", "/api/infinity/index", {
    projectId = state.config.project_id,
  }, callback)
end

function M.index_status(callback)
  http_request("GET", "/api/infinity/index/status", {
    projectId = state.config.project_id,
  }, callback)
end

function M.index_search(query, options, callback)
  http_request("POST", "/api/infinity/index/search", {
    projectId = state.config.project_id,
    query = query,
    options = options or {},
  }, callback)
end

-- Review endpoints
function M.review_create(diff, options, callback)
  http_request("POST", "/api/infinity/review", {
    projectId = state.config.project_id,
    diff = diff,
    options = options or {},
  }, callback)
end

function M.review_status(review_id, callback)
  http_request("GET", "/api/infinity/review/" .. review_id .. "/status", nil, callback)
end

-- File operations
function M.file_read(path, callback)
  http_request("GET", "/api/infinity/files/read", {
    projectId = state.config.project_id,
    path = path,
  }, callback)
end

function M.file_write(path, content, callback)
  http_request("POST", "/api/infinity/files/write", {
    projectId = state.config.project_id,
    path = path,
    content = content,
  }, callback)
end

function M.file_list(dir, callback)
  http_request("GET", "/api/infinity/files/list", {
    projectId = state.config.project_id,
    path = dir or ".",
  }, callback)
end

-- ============================================================================
-- WebSocket Connection
-- ============================================================================

function M.connect_websocket()
  if state.ws_connected then
    return
  end

  local ws_url = state.config.api_url:gsub("^http", "ws") .. "/ws"
    .. "?projectId=" .. (state.config.project_id or "")
    .. (state.auth_token and "&token=" .. state.auth_token or "")

  local has_websocket, websocket = pcall(require, "websocket")
  if not has_websocket then
    -- Try nvim-websocket or built-in
    has_websocket, websocket = pcall(require, "nvim-websocket")
  end

  if not has_websocket then
    -- Use native Neovim 0.10+ vim.uv for WebSocket
    M._connect_websocket_native(ws_url)
    return
  end

  -- Use websocket library
  state.ws = websocket.new(ws_url)
  state.ws:on_open(function()
    state.ws_connected = true
    M._emit("connected", {})
    M._clear_reconnect_timer()
  end)

  state.ws:on_message(function(msg)
    M._handle_ws_message(msg)
  end)

  state.ws:on_close(function()
    state.ws_connected = false
    M._emit("disconnected", {})
    M._schedule_reconnect()
  end)

  state.ws:on_error(function(err)
    M._emit("error", { error = err })
    state.ws_connected = false
    M._schedule_reconnect()
  end)

  state.ws:connect()
end

-- Native WebSocket using vim.uv (Neovim 0.10+)
function M._connect_websocket_native(ws_url)
  -- This is a simplified implementation
  -- In production, you'd want a proper WebSocket implementation
  -- For now, we'll use a polling fallback or external tool
  vim.notify("Infinity: Native WebSocket not fully implemented, using REST fallback", vim.log.levels.WARN)
end

function M._schedule_reconnect()
  M._clear_reconnect_timer()
  state.ws_reconnect_timer = vim.defer_fn(function()
    if not state.ws_connected then
      M.connect_websocket()
    end
  end, state.config.reconnect_interval)
end

function M._clear_reconnect_timer()
  if state.ws_reconnect_timer then
    vim.fn.timer_stop(state.ws_reconnect_timer)
    state.ws_reconnect_timer = nil
  end
end

function M._handle_ws_message(msg)
  local ok, data = pcall(vim.json.decode, msg)
  if not ok then
    return
  end

  -- Handle response to pending request
  if data.id and state.pending_requests[data.id] then
    local handler = state.pending_requests[data.id]
    state.pending_requests[data.id] = nil
    if data.error then
      handler.on_error(data.error)
    else
      handler.on_complete(data.result)
    end
    return
  end

  -- Handle streaming chunk
  if data.type == "chunk" and data.request_id and state.pending_requests[data.request_id] then
    local handler = state.pending_requests[data.request_id]
    if handler.on_chunk then
      handler.on_chunk(data.chunk)
    end
    return
  end

  -- Handle stream complete
  if data.type == "complete" and data.request_id and state.pending_requests[data.request_id] then
    local handler = state.pending_requests[data.request_id]
    state.pending_requests[data.request_id] = nil
    if handler.on_complete then
      handler.on_complete(data.result)
    end
    return
  end

  -- Handle events
  if data.event then
    M._emit(data.event, data.data)
  end
end

-- Send message over WebSocket
function M.ws_send(payload, on_chunk, on_complete)
  if not state.ws_connected then
    -- Queue and connect
    vim.defer_fn(function()
      M.ws_send(payload, on_chunk, on_complete)
    end, 100)
    return
  end

  local request_id = gen_request_id()
  state.pending_requests[request_id] = {
    on_chunk = on_chunk,
    on_complete = on_complete,
    on_error = function(err) vim.notify("Infinity API Error: " .. err, vim.log.levels.ERROR) end,
  }

  local message = vim.json.encode(vim.tbl_extend("force", payload, { id = request_id }))

  if state.ws and state.ws.send then
    state.ws:send(message)
  end
end

-- Disconnect WebSocket
function M.disconnect()
  M._clear_reconnect_timer()
  if state.ws then
    if state.ws.close then
      state.ws:close()
    end
    state.ws = nil
  end
  state.ws_connected = false
end

-- ============================================================================
-- Event System
-- ============================================================================

function M.on(event, handler)
  state.event_handlers[event] = state.event_handlers[event] or {}
  table.insert(state.event_handlers[event], handler)
end

function M.off(event, handler)
  if not state.event_handlers[event] then
    return
  end
  for i, h in ipairs(state.event_handlers[event]) do
    if h == handler then
      table.remove(state.event_handlers[event], i)
      break
    end
  end
end

function M._emit(event, data)
  local handlers = state.event_handlers[event] or {}
  for _, handler in ipairs(handlers) do
    pcall(handler, data)
  end
end

-- ============================================================================
-- High-level convenience methods
-- ============================================================================

-- Send chat message with streaming
function M.send_chat_message(messages, on_chunk, on_complete)
  M.chat_stream(messages, { stream = true }, on_chunk, on_complete)
end

-- Get autocomplete suggestions
function M.get_completions(context, callback)
  M.autocomplete_suggest(context, callback)
end

-- Trigger codebase indexing
function M.trigger_indexing(callback)
  M.index_project(callback)
end

-- Search codebase
function M.search_codebase(query, callback)
  M.index_search(query, { type = "semantic" }, callback)
end

return M