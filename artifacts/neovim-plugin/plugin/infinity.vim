" Infinity.nvim - AI-native IDE features for Neovim
" Plugin loader for lazy.nvim, packer.nvim, and native package loading

" Guard against double loading
if exists('g:loaded_infinity_nvim')
  finish
endif
let g:loaded_infinity_nvim = 1

" Check Neovim version (require 0.9+)
if !has('nvim-0.9')
  echohl WarningMsg
  echo "Infinity.nvim requires Neovim 0.9 or higher"
  echohl None
  finish
endif

" Check for required dependencies
function! s:check_dependencies() abort
  let missing = []

  " plenary.nvim is required for HTTP requests
  if !exists('g:loaded_plenary')
    if !empty(globpath(&rtp, 'pack/*/opt/plenary.nvim'))
      " Try to load it
      try
        lua require('plenary')
      catch
        call add(missing, 'plenary.nvim')
      endtry
    else
      call add(missing, 'plenary.nvim')
    endif
  endif

  " Optional: telescope.nvim for file picking
  " Optional: fzf-lua for file picking
  " Optional: nvim-cmp for autocomplete
  " Optional: which-key.nvim for keymap help

  if !empty(missing)
    echohl WarningMsg
    echo "Infinity.nvim missing optional dependencies: " . join(missing, ', ')
    echohl None
  endif
endfunction

call s:check_dependencies()

" Auto-setup if configured globally
if exists('g:infinity_auto_setup') && g:infinity_auto_setup
  lua require('infinity').setup(vim.g.infinity_config or {})
endif

" Define :InfinitySetup command for manual setup
command! -nargs=? -complete=customlist,v:lua.require'infinity.config'.complete_config InfinitySetup lua require('infinity').setup(<f-args>)

" vim: set ft=vim ts=2 sw=2 et: