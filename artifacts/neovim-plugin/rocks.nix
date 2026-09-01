-- LuaRocks configuration for Infinity.nvim dependencies
-- This file can be used with luarocks or nix to manage Lua dependencies

package = "infinity.nvim"
version = "0.1.0-1"

source = {
  url = "git://github.com/Infinity-AI/infinity.nvim",
  branch = "main",
}

description = {
  summary = "AI-native IDE features for Neovim: Chat, Composer, Agent, Tab Autocomplete",
  detailed = [[
    Infinity.nvim brings Cursor-level code intelligence to Neovim.
    Features include conversational chat with @codebase context,
    multi-file Composer with diff preview, autonomous Agent with
    approval workflow, and Tab autocomplete via nvim-cmp.
  ]],
  homepage = "https://github.com/Infinity-AI/infinity.nvim",
  license = "MIT",
  maintainer = "Infinity AI <kasperkal1970@gmail.com>",
}

dependencies = {
  "lua >= 5.1",
  -- Required: plenary.nvim for HTTP/WebSocket
  -- Note: plenary is a Neovim plugin, not a LuaRocks package
  -- It must be installed via package manager (lazy.nvim, packer, etc.)
}

build = {
  type = "builtin",
  modules = {
    ["infinity.init"] = "lua/infinity/init.lua",
    ["infinity.config"] = "lua/infinity/config.lua",
    ["infinity.api"] = "lua/infinity/api.lua",
    ["infinity.chat"] = "lua/infinity/chat.lua",
    ["infinity.composer"] = "lua/infinity/composer.lua",
    ["infinity.agent"] = "lua/infinity/agent.lua",
    ["infinity.autocomplete"] = "lua/infinity/autocomplete.lua",
    ["infinity.ui"] = "lua/infinity/ui.lua",
    ["infinity.commands"] = "lua/infinity/commands.lua",
    ["infinity.keymaps"] = "lua/infinity/keymaps.lua",
  },
  copy_directories = { "plugin", "doc" },
}

-- External Neovim plugin dependencies (installed via package manager)
external_dependencies = {
  -- Required
  {
    name = "plenary.nvim",
    description = "Lua utilities for Neovim (HTTP, async, etc.)",
    required = true,
    install_hint = "Install via lazy.nvim: { 'nvim-lua/plenary.nvim' }",
  },

  -- Optional but recommended
  {
    name = "telescope.nvim",
    description = "Fuzzy finder for file picking in chat",
    required = false,
    install_hint = "Install via lazy.nvim: { 'nvim-telescope/telescope.nvim' }",
  },

  {
    name = "fzf-lua",
    description = "Alternative fuzzy finder",
    required = false,
    install_hint = "Install via lazy.nvim: { 'ibhagwan/fzf-lua' }",
  },

  {
    name = "nvim-cmp",
    description = "Completion engine for Tab autocomplete",
    required = false,
    install_hint = "Install via lazy.nvim: { 'hrsh7th/nvim-cmp' }",
  },

  {
    name = "which-key.nvim",
    description = "Keymap help integration",
    required = false,
    install_hint = "Install via lazy.nvim: { 'folke/which-key.nvim' }",
  },

  {
    name = "nvim-web-devicons",
    description = "File icons for UI",
    required = false,
    install_hint = "Install via lazy.nvim: { 'nvim-tree/nvim-web-devicons' }",
  },
}

-- Nix flake output for nixpkgs
-- This can be used with flake.nix to build a Neovim package with dependencies
nix = {
  -- Example flake.nix integration:
  -- {
  --   inputs.infinity-nvim.url = "github:Infinity-AI/infinity.nvim";
  --   outputs = { self, nixpkgs, infinity-nvim }: {
  --     neovimPackages = nixpkgs.neovimPackages.extend (old: {
  --       infinity-nvim = old.buildNeovimPlugin {
  --         name = "infinity-nvim";
  --         src = infinity-nvim;
  --         dependencies = with old; [ plenary telescope fzf-lua nvim-cmp which-key ];
  --       };
  --     });
  --   };
  -- }
}