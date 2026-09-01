-- Infinity Neovim Plugin - Autocomplete (nvim-cmp source)
-- Tab autocomplete connecting to Infinity Tab API with local WASM fallback

local M = {}

local config = require("infinity.config")
local api = require("infinity.api")

-- State
local state = {
  enabled = false,
  cache = {},
  last_request = 0,
  debounce_timer = nil,
  local_model = nil,
}

-- nvim-cmp source
M.source = {}

function M.source.new()
  return setmetatable({}, { __index = M.source })
end

function M.source:is_available()
  return state.enabled and config.get("autocomplete.enabled")
end

function M.source:get_debug_name()
  return "Infinity"
end

function M.source:get_keyword_pattern()
  return [[\%(\k\|[^\w\s]\)\+]]
end

function M.source:complete(params, callback)
  if not self:is_available() then
    callback({ items = {}, isIncomplete = false })
    return
  end

  local context = params.context
  local cursor_line = context.cursor_line
  local cursor_col = context.cursor.col

  -- Get prefix (text before cursor)
  local prefix = cursor_line:sub(1, cursor_col - 1)

  -- Check minimum characters
  local min_chars = config.get("autocomplete.min_chars") or 2
  local match = prefix:match("([%w_%.%:]+)$")
  if not match or #match < min_chars then
    callback({ items = {}, isIncomplete = false })
    return
  end

  -- Debounce
  local debounce_ms = config.get("autocomplete.debounce_ms") or 100
  local now = vim.loop.hrtime() / 1e6
  if now - state.last_request < debounce_ms then
    if state.debounce_timer then
      state.debounce_timer:stop()
    end
    state.debounce_timer = vim.defer_fn(function()
      self:complete(params, callback)
    end, debounce_ms)
    return
  end
  state.last_request = now

  -- Build context for API
  local file_context = self._get_file_context()

  api.get_completions({
    prefix = match,
    file = vim.api.nvim_buf_get_name(0),
    language = vim.bo.filetype,
    context = file_context,
    cursor_position = {
      line = context.cursor.row,
      character = context.cursor.col - 1,
    },
  }, function(result)
    if not result or not result.suggestions then
      callback({ items = {}, isIncomplete = false })
      return
    end

    local items = {}
    for i, suggestion in ipairs(result.suggestions) do
      if i > (config.get("autocomplete.max_suggestions") or 5) then break end

      local item = {
        label = suggestion.text or suggestion.label,
        kind = self._map_kind(suggestion.kind),
        detail = suggestion.detail,
        documentation = suggestion.documentation and {
          kind = "markdown",
          value = suggestion.documentation,
        } or nil,
        insertText = suggestion.insertText or suggestion.text,
        insertTextFormat = suggestion.insertTextFormat or 1,
        filterText = suggestion.filterText or suggestion.text,
        sortText = suggestion.sortText or string.format("%03d", i),
        data = {
          infinity = true,
          suggestion = suggestion,
        },
      }
      table.insert(items, item)
    end

    callback({ items = items, isIncomplete = result.hasMore or false })
  end)
end

function M.source:resolve(item, callback)
  -- Resolve additional details if needed
  callback(item)
end

function M.source:execute(item, callback)
  -- Handle accept action
  callback(item)
end

-- Get file context (surrounding lines)
function M.source._get_file_context()
  local buf = vim.api.nvim_get_current_buf()
  local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
  local cursor = vim.api.nvim_win_get_cursor(0)
  local row = cursor[1] - 1
  local col = cursor[2]

  -- Get ~50 lines before and after cursor
  local start = math.max(0, row - 50)
  local finish = math.min(#lines, row + 50)

  local context_lines = {}
  for i = start, finish - 1 do
    local prefix = (i == row) and "> " or "  "
    table.insert(context_lines, prefix .. lines[i + 1])
  end

  return table.concat(context_lines, "\n")
end

-- Map completion kind to nvim-cmp kind
function M.source._map_kind(kind)
  local kinds = {
    text = 1,           -- Text
    method = 2,         -- Method
    func = 3,           -- Function
    constructor = 4,    -- Constructor
    field = 5,          -- Field
    variable = 6,       -- Variable
    class = 7,          -- Class
    interface = 8,      -- Interface
    module = 9,         -- Module
    property = 10,      -- Property
    unit = 11,          -- Unit
    value = 12,         -- Value
    enum = 13,          -- Enum
    keyword = 14,       -- Keyword
    snippet = 15,       -- Snippet
    color = 16,         -- Color
    file = 17,          -- File
    reference = 18,     -- Reference
    folder = 19,        -- Folder
    enum_member = 20,   -- EnumMember
    constant = 21,      -- Constant
    struct = 22,        -- Struct
    event = 23,         -- Event
    operator = 24,      -- Operator
    type_parameter = 25,-- TypeParameter
  }
  return kinds[kind] or 1
end

-- Ghost text support (for inline preview)
M.ghost_text = {}

function M.ghost_text.setup()
  local ns = vim.api.nvim_create_namespace("infinity_ghost_text")

  vim.api.nvim_create_autocmd({ "TextChangedI", "TextChangedP" }, {
    group = vim.api.nvim_create_augroup("InfinityGhostText", { clear = true }),
    callback = function()
      if not state.enabled then return end
      M.ghost_text._update()
    end,
  })

  vim.api.nvim_create_autocmd("InsertLeave", {
    group = vim.api.nvim_create_augroup("InfinityGhostTextClear", { clear = true }),
    callback = function()
      M.ghost_text.clear()
    end,
  })
end

function M.ghost_text._update()
  local buf = vim.api.nvim_get_current_buf()
  local cursor = vim.api.nvim_win_get_cursor(0)
  local row = cursor[1] - 1
  local col = cursor[2]

  local line = vim.api.nvim_buf_get_lines(buf, row, row + 1, false)[1] or ""
  local prefix = line:sub(1, col)

  -- Check if we should trigger
  local match = prefix:match("([%w_%.%:]+)$")
  if not match or #match < (config.get("autocomplete.min_chars") or 2) then
    M.ghost_text.clear()
    return
  end

  -- Check cache
  local cache_key = vim.api.nvim_buf_get_name(buf) .. ":" .. row .. ":" .. col .. ":" .. match
  if state.cache[cache_key] then
    M.ghost_text._show(state.cache[cache_key])
    return
  end

  -- Request completion
  api.get_completions({
    prefix = match,
    file = vim.api.nvim_buf_get_name(buf),
    language = vim.bo.filetype,
    context = M.source._get_file_context(),
    cursor_position = { line = row, character = col - 1 },
  }, function(result)
    if result and result.suggestions and #result.suggestions > 0 then
      local suggestion = result.suggestions[1]
      state.cache[cache_key] = suggestion
      M.ghost_text._show(suggestion)
    end
  end)
end

function M.ghost_text._show(suggestion)
  local buf = vim.api.nvim_get_current_buf()
  local cursor = vim.api.nvim_win_get_cursor(0)
  local row = cursor[1] - 1
  local col = cursor[2]

  local text = suggestion.insertText or suggestion.text or ""
  if text == "" then return end

  -- Only show the completion part (after the prefix)
  local prefix_match = text:match("^([%w_%.%:]+)")
  local ghost = text
  if prefix_match then
    ghost = text:sub(#prefix_match + 1)
  end

  if ghost == "" then return end

  local ns = vim.api.nvim_create_namespace("infinity_ghost_text")
  vim.api.nvim_buf_set_extmark(buf, ns, row, col, {
    virt_text = { { ghost, "InfinityAutocompleteGhost" } },
    virt_text_pos = "inline",
    hl_mode = "blend",
  })
end

function M.ghost_text.clear()
  local buf = vim.api.nvim_get_current_buf()
  local ns = vim.api.nvim_create_namespace("infinity_ghost_text")
  vim.api.nvim_buf_clear_namespace(buf, ns, 0, -1)
end

-- Initialize autocomplete
function M.init()
  state.enabled = config.get("autocomplete.enabled")

  -- Register nvim-cmp source
  local has_cmp, cmp = pcall(require, "cmp")
  if has_cmp then
    cmp.register_source("infinity", M.source.new())
    -- Add to default sources
    local sources = cmp.get_config().sources or {}
    table.insert(sources, 1, { name = "infinity", priority = 100 })
    cmp.setup({ sources = sources })
  end

  -- Set up ghost text
  if config.get("autocomplete.trigger_on_tab") then
    M.ghost_text.setup()
  end

  -- Load local model if configured
  if config.get("autocomplete.use_local_fallback") then
    M._load_local_model()
  end

  -- Tab key mapping for accepting ghost text
  vim.keymap.set("i", "<Tab>", function()
    if M.ghost_text._has_ghost_text() then
      M.ghost_text._accept()
      return ""
    end
    return "<Tab>"
  end, { expr = true, desc = "Accept Infinity completion" })

  return M
end

function M.ghost_text._has_ghost_text()
  local buf = vim.api.nvim_get_current_buf()
  local ns = vim.api.nvim_create_namespace("infinity_ghost_text")
  local marks = vim.api.nvim_buf_get_extmarks(buf, ns, 0, -1, {})
  return #marks > 0
end

function M.ghost_text._accept()
  local buf = vim.api.nvim_get_current_buf()
  local ns = vim.api.nvim_create_namespace("infinity_ghost_text")
  local marks = vim.api.nvim_buf_get_extmarks(buf, ns, 0, -1, { details = true })

  if #marks > 0 then
    local mark = marks[1]
    local virt_text = mark[4].virt_text
    if virt_text and virt_text[1] then
      local ghost_text = virt_text[1][1]
      -- Insert the ghost text
      local row = mark[2]
      local col = mark[3]
      vim.api.nvim_buf_set_text(buf, row, col, row, col, { ghost_text })
    end
  end

  M.ghost_text.clear()
end

-- Load local WASM model (placeholder for future implementation)
function M._load_local_model()
  local model_path = config.get("autocomplete.local_model_path")
  if model_path and vim.fn.filereadable(model_path) == 1 then
    -- TODO: Load local model (e.g., using llama.cpp bindings or WASM)
    -- For now, just note it's available
    state.local_model = model_path
  end
end

-- Enable/disable autocomplete
function M.enable()
  state.enabled = true
end

function M.disable()
  state.enabled = false
  M.ghost_text.clear()
end

function M.toggle()
  if state.enabled then
    M.disable()
  else
    M.enable()
  end
  vim.notify("Infinity Autocomplete " .. (state.enabled and "enabled" or "disabled"), vim.log.levels.INFO)
end

-- Clear cache
function M.clear_cache()
  state.cache = {}
end

return M