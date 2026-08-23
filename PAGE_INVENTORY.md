# Complete Page Inventory — Infinity AI / Infinity

**Generated:** 2026-08-20  
**Source:** `/workspaces/Infinity-AI/artifacts/Infinity/src/**`

---

## Table of Contents

1. [Main Entry Point: `home.tsx`](#1-main-entry-point-hometx)
2. [Chat Mode — Primary Chat Interface](#2-chat-mode--primary-chat-interface)
3. [Voice Mode — Full-Screen Voice Assistant](#3-voice-mode--full-screen-voice-assistant)
4. [Camera Mode — Object Detection](#4-camera-mode--object-detection)
4. [Settings View](#4-settings-view)
5. [Build Studio / Build View](#5-build-studio--build-view)
6. [Projects View & Project Home Variants](#6-projects-view--project-home-variants)
7. [Terminal View](#7-terminal-view)
8. [Overlay / Modal Pages](#8-overlay--modal-pages)
9. [Plus Menu States](#9-plus-menu-states)
10. [@ Autocomplete Popup](#10--autocomplete-popup)
11. [Command Palette (Cmd+K)](#11-command-palette-cmdk)
12. [Demo Pages](#12-demo-pages)

---

## 1. Main Entry Point: `home.tsx`

**File:** `artifacts/Infinity/src/pages/home.tsx` (1,681 lines)

The root component that orchestrates the entire application. It manages all global state and renders the appropriate view based on `mode`.

### Global State Managed Here
- `mode`: `'voice' | 'chat' | 'agent' | 'camera'` — persisted to localStorage
- `status`: `'idle' | 'thinking' | 'transcribing' | 'recording' | 'wake' | 'speaking'`
- `messages`: `ChatMessage[]` — conversation history
- `activeConversationId`: string | null
- `activeProjectId`: string | null
- `activeProjectView`: `'home' | 'memory' | 'instructions' | 'activity'`
- `thinkingEnabled`: boolean — persisted
- `webSearchEnabled`: boolean — from settings
- `agentModeActive`: boolean
- Various overlay states: `settingsOpen`, `researchPanelOpen`, `expertDialogOpen`, `dataLabOpen`, `buildPanelOpen`, `studiosOpen`, `designStudioOpen`, `musicStudioOpen`, `bookStudioOpen`, `paletteOpen`, `pipBrowserOpen`
- Screen sharing, timers, image generation, voice emotion detection

### Rendering Logic (Priority Order)
1. **KeyRetryBanner** — LLM key cooldown retry (top of page)
2. **HomeHeader** — Always visible except in voice mode
3. **ChatSidebar** — Hidden in voice mode; shows conversations + project gallery
4. **Main Content Area** — Renders ONE of:
   - `ProjectMemory` — when `activeProjectId` && `activeProjectView === 'memory'`
   - `ProjectInstructions` — when `activeProjectId` && `activeProjectView === 'instructions'`
   - `ProjectHomeRouter` — when `activeProjectId` && `activeProjectView === 'home'`
   - `CameraModeView` — when `mode === 'camera'` && no project
   - `VoiceModeView` — when `mode === 'voice'` && no project
   - `ChatModeView` — when `mode === 'chat'` && no project (DEFAULT)
5. **PipBrowserWindow** — Floating agent browser (always rendered, conditionally shown)
6. **ExpertDialog** — New expert creation modal
7. **AppOverlays** — All modal overlays (settings, research, data lab, command palette, build panel, studios hub, design studio, music studio, book studio)

---

## 2. Chat Mode — Primary Chat Interface

**Component:** `ChatModeView` (in `artifacts/Infinity/src/components/home/chat-mode-view.tsx`)
**Composer:** `ChatComposer` (in `artifacts/Infinity/src/components/home/chat-composer.tsx`)
**Feed:** `ConversationFeed` (in `artifacts/Infinity/src/components/conversation-feed.tsx`)

### 2A. New Chat (Empty State)
**Trigger:** Fresh load, or "New Chat" button clicked
- **Visual:** Centered empty state with ∞ logo, "Start a conversation" title, description text
- **Sidebar:** Shows conversation list (empty) + "New Chat" button + project gallery
- **Composer:** Clean input bar with:
  - **+ button** — opens Plus Menu
  - **Lightbulb** — Thinking mode toggle
  - **Search icon** — Agent mode toggle
  - **Textarea** — placeholder "Ask anything..."
  - **Mic button** — starts in-chat dictation (continuous, interim results)
  - **Blue waveform button** — opens full Voice Mode
- **Status bar:** Empty

### 2B. Running Chat (Active Conversation)
**Trigger:** Messages exist in `messages` array
- **Feed:** `ConversationFeed` renders all messages with:
  - User messages (right-aligned, blue)
  - Assistant messages (left-aligned, with reasoning blocks if thinking)
  - Widgets: 18 types (image, chart, code, terminal, file tree, etc.)
  - Action rows: Regenerate, Edit, Speak, "Use code for this answer?", Source code confirm, Build mode confirm
  - Suggestions chips below last assistant message
- **Composer:** Same as empty but:
  - Placeholder changes contextually: "processing...", "File attached: name", "Listening...", or dictation interim text
  - Attached file preview shown above input (if any)
  - Upload progress bar during file read
  - Agent mode indicator banner when active ("🔍 Agent mode active")
- **Sidebar:** Conversation list with active highlighted, project gallery
- **Status bar:** Shows "Thinking...", "Listening...", "Speaking..." with stop button

### 2C. Running Chat — Plus Menu Clicked (`+` button)
**Trigger:** Click + button in composer (or `@` autocomplete)
- **Portal-rendered** fixed-position menu anchored to + button
- **Sections (conditional):**
  - **Attach:** Attach File (📎), Camera (📷) — hidden during `@` autocomplete unless query matches
  - **Create:** New Expert (✨), Generate Image (🖼) — hidden during `@` autocomplete unless query matches
  - **Tools** — **ONLY shown during `@` autocomplete**: Thinking mode, Agent mode, Web search, Screen share, Build mode, Deep research, Data Lab
  - **Studios:** All Studios, Design Studio, Music Studio — hidden during `@` autocomplete unless query matches
- **Animation:** Framer-motion enter (scale 0.95→1, fade), exit (scale 0.95, fade)
- **Filtering:** Real-time fuzzy match on `query` (from `@` text or manual typing in menu)
- **No matches:** "No plug-in matches" message
- **Close:** Click backdrop, Escape, or select action

### 2D. Running Chat — @ Typed (Plugin Autocomplete Popup)
**Trigger:** Type `@` in composer textarea (detected via `input`/`keyup` listeners on `.chat-composer-input`)
- **Same PlusMenu component** but `isPluginAutocomplete = true`
- **Behavior differences from regular + menu:**
  - Only **Tools** section visible by default (filtered by query)
  - Other sections hidden unless query matches their labels
  - Enter key selects first match (dispatches `Infinity-plugin-action` event)
  - Updates live as user types after `@`
  - Coordinates tracked from textarea caret position
- **Actions available via @:** thinking, agent-mode, web-search, screen-share, build-mode, research, data-lab

---

## 3. Voice Mode — Full-Screen Voice Assistant

**Component:** `VoiceModeView` (`artifacts/Infinity/src/components/home/voice-mode-view.tsx`)

### Visual Layout
- **Full-screen**, no header, no sidebar
- **Central Orb:** Animated gradient sphere with amplitude visualization
  - Breathing animation when idle/wake
  - Pulse/ripple when recording
  - Waveform bars when speaking
  - Color shifts by `voiceEmotion` (neutral, happy, sad, angry, calm, excited)
- **Status text** below orb: "Listening...", "Thinking...", "Speaking...", "Say 'Hey Infinity'"
- **Active timers** displayed as pills with pause/cancel
- **Active widget** card (if any) — e.g., weather, timer, music
- **Bottom toolbar:** 
  - Agent mode toggle
  - PiP browser toggle
  - Camera mode button
  - Settings (gear)
- **Tap orb** → start recording (barge-in if speaking)
- **Spacebar** (desktop) → push-to-talk

### States
| Status | Orb Visual | Text |
|--------|-----------|------|
| `idle` / `wake` | Breathing, subtle glow | "Say 'Hey Infinity'" |
| `recording` | Pulse rings, amplitude bars | "Listening..." |
| `thinking` | Rotating, processing animation | "Thinking..." |
| `speaking` | Waveform bars synced to audio | "Speaking..." + stop button |
| `transcribing` | Waveform → text animation | "Transcribing..." |

---

## 4. Camera Mode — Object Detection

**Component:** `CameraModeView` (`artifacts/Infinity/src/components/home/camera-mode-view.tsx`)

### Visual Layout
- **Full-screen** camera feed (`<video>` element)
- **Top bar:** Back button (→ chat), flash toggle, flip camera
- **Bottom bar:** Capture button (large), gallery thumbnail, mode selector (photo/video/scan)
- **Overlays:** Detected object bounding boxes with labels + confidence
- **Permission state:** Requests camera permission on mount

---

## 5. Settings View

**Component:** `SettingsView` (`artifacts/Infinity/src/components/views/SettingsView.tsx`)

### Desktop Layout
- **AppShell** with collapsible sidebar (240px)
- **Sidebar sections** (5 items):
  1. **Theme** (☀️/🌙/💻) — Light / Dark / System buttons
  2. **Notifications** — Enable notifications checkbox
  3. **API Keys** — Password input for API key (sk-...)
  4. **Language** — Select: English / Nederlands
  5. **Advanced** — Debug mode checkbox, "Reset to defaults" danger button
- **Main panel:** Renders active section content
- **Header:** Back button, title "Settings", view switcher (Terminal/Build/Chat)

### Mobile Layout
- **Full-screen** with bottom navigation (5 tabs)
- **Header:** Back button, title, reset button
- **Content:** Single section at a time (switched via bottom nav)
- **Sheet modal** for reset confirmation

### Settings Persisted
- Theme (`light|dark|auto`) → localStorage + CSS
- API key → server settings endpoint
- Language → localStorage + i18n
- Notifications, debug mode → localStorage

---

## 6. Build Studio / Build View

**Component:** `BuildView` (`artifacts/Infinity/src/components/views/BuildView.tsx`)

### Desktop Layout
- **AppShell** with left sidebar (280px) + right sidebar (320px, collapsible)
- **Header tabs:** Plan / Transcript / Diff / Debug / Terminal
- **Left sidebar sections:**
  - **Project:** All Projects button + project list
  - **History:** Recent Builds, Snapshots
  - **Tools:** Plan, Terminal
- **Right sidebar:** BuildDebugPanel
- **Tab content:**
  - **Plan:** `BuildStudio` — full build interface with plan, transcript, diff
  - **Transcript:** `BuildTranscript` — tool call log
  - **Diff:** `BuildDiffPreview` — file diffs
  - **Debug:** `BuildDebugPanel` — detailed debug info
  - **Terminal:** Full terminal with command input bar
- **Plus menu:** Build-specific actions (build-mode, studios)
- **BuildCommandPalette:** Custom command palette for build actions

### Mobile Layout
- Simplified single-column with bottom nav

---

## 7. Projects View & Project Home Variants

### 7A. Projects View (Gallery)
**Component:** `ProjectsView` (`artifacts/Infinity/src/components/views/ProjectsView.tsx`)

#### Desktop
- **AppShell** with sidebar (project list with status badges)
- **Header:** Search input, filter dropdown (All/Active/Paused/Completed), Create Project button
- **Main:** Responsive grid (1/2/3 cols) of project cards
- **Card:** Name, status badge, description, last modified date
- **Click card** → opens ProjectHomeRouter

#### Mobile
- **Header:** Back, title, filter sheet button
- **List:** Touch-friendly list items with status indicators
- **Bottom nav:** Gallery / List (opens filter sheet) / Create

### 7B. Project Home Router
**Component:** `ProjectHomeRouter` (`artifacts/Infinity/src/components/projects/project-home-router.tsx`)
- Fetches project type from API (`/api/Infinity/projects/:id`)
- Routes to appropriate variant based on `project.type`

### 7C. Project Home Variants (6 Types)

| Variant | File | Key Features |
|---------|------|--------------|
| **General** | `project-home.tsx` | Standard 5 overview cards (conversations, files, research, tasks, memory), recent conversations + activity |
| **App** | `ProjectHomeApp.tsx` | 4 app-specific tools (Scaffold, Store, Crash, Analytics) + standard overview |
| **Website** | `ProjectHomeWebsite.tsx` | GitHub integration (connect, repo select), Build & Deploy panels, preview URL |
| **Company** | `ProjectHomeCompany.tsx` | Business metrics, team, resources |
| **Research** | `ProjectHomeResearch.tsx` | Research jobs, sources, reports |
| **Course** | `ProjectHomeCourse.tsx` | Lessons, progress, curriculum |

#### Common Structure (All Variants)
1. **Back button** (top-left)
2. **Hero section:** Project name, type badge, description, updated date, Continue/New Chat buttons
3. **Type-specific tools section** (grid of action cards)
4. **Standard overview cards** (5 cards: conversations, files, research, memory, activity)
5. **Empty state** (if no data): "Ready to start" with quick actions
6. **Data state:** Two-column grid:
   - Left: Recent conversations (click to continue)
   - Right: Recent activity timeline

#### Variant-Specific Actions
- **App:** `scaffold`, `store`, `crash`, `analytics`
- **Website:** `build`, `github`, `figma`, `deploy`, `preview`
- **General/others:** `conversations`, `files`, `research`, `tasks`, `memory`, `instructions`, `activity`

### 7D. Project Sub-Views
- **ProjectMemory** — Memory management for project
- **ProjectInstructions** — Custom instructions for project

---

## 8. Terminal View

**Component:** `TerminalView` (`artifacts/Infinity/src/components/views/TerminalView.tsx`)

### Desktop
- **AppShell** with sidebar (280px)
- **Header:** Tab switcher (Terminal/Build/Chat), theme toggle
- **Sidebar sections:**
  - **Project:** All Projects, Clear Terminal
  - **History:** Last 10 commands (click to reuse)
  - **Tools:** Terminal (active), Plan (→ Build view)
- **Main:** Full-screen `Terminal` component (xterm.js)
- **Bottom command bar:** `$` prompt + input + Run button + Clear button

### Mobile
- **Header:** Back, title, theme toggle, history button
- **Full-screen terminal**
- **Bottom command bar** (same)
- **Bottom nav:** Terminal / History (sheet) / Tools (clear)
- **History sheet:** Half-screen, tap command to reuse

### Keyboard Shortcuts (Desktop)
- `Ctrl+L` / `Cmd+L` → Clear terminal
- `Ctrl+K` / `Cmd+K` → Focus command input

---

## 9. Overlay / Modal Pages

All rendered via `AppOverlays` component in `home.tsx`:

| Overlay | Trigger | Description |
|---------|---------|-------------|
| **Settings** | Gear icon / Cmd+K → Settings | Full SettingsView in drawer |
| **Research Panel** | + menu → Research / @research | List of background research jobs, start new, cancel |
| **Expert Dialog** | + menu → New Expert / @new-expert | Create custom expert persona |
| **Data Lab** | + menu → Data Lab / @data-lab | Data analysis workspace |
| **Build Panel** | + menu → Build Mode / @build-mode / @Build <msg> | Build studio in side panel |
| **Studios Hub** | + menu → All Studios | Grid of 10 studio cards (Chat, Voice, Camera, Research, Build, Design, Music, Book, Fact-check, Data Lab) |
| **Design Studio** | Studios → Design / @design-studio | Image generation/editing workspace |
| **Music Studio** | Studios → Music / @music-studio | Music generation workspace |
| **Book Studio** | Studios → Book | Long-form book generation |
| **Command Palette** | `Cmd+K` | Search conversations + run actions (mode switch, research, expert, image, theme, settings) |
| **Error Detail Panel** | Toast → DETAILS button | Full error context with copy-to-clipboard |
| **PiP Browser Window** | Agent mode / @web-search | Floating browser for autonomous agent |

---

## 10. Plus Menu States

**Component:** `PlusMenu` (`artifacts/Infinity/src/components/plus-menu.tsx`)

### Two Distinct Modes

#### A. Regular + Menu (Click + button)
```
┌─────────────────────────┐
│ Attach                  │
│ 📎 Attach File          │
│ 📷 Camera               │
├─────────────────────────┤
│ Create                  │
│ ✨ New Expert           │
│ 🖼 Generate Image       │
├─────────────────────────┤
│ Studios                 │
│ 📦 All Studios          │
│ 🎨 Design Studio        │
│ 🎵 Music Studio         │
└─────────────────────────┘
```

#### B. @ Autocomplete (Type @ in composer)
```
┌─────────────────────────┐
│ Tools                   │
│ 💡 Thinking mode        │
│ 🤖 Agent mode           │
│ 🔍 Web search           │
│ 🖥 Screen share         │
│ 🔨 Build mode           │
│ 🔬 Deep research        │
│ 📊 Data Lab             │
└─────────────────────────┘
```
- **Other sections hidden** unless query matches (e.g., type `@stud` → Studios shows)
- **Enter** selects first match, dispatches `Infinity-plugin-action` event
- **Escape** closes

### Positioning Logic
- Anchored to `+` button (or textarea for `@`)
- Opens **upward** if space above, else **downward**
- Right-aligned to button
- Viewport-clamped (8px margins)

---

## 11. Command Palette (Cmd+K)

**Component:** `CommandPalette` (`artifacts/Infinity/src/components/command-palette.tsx`)

### Trigger
- `Ctrl+K` / `Cmd+K` anywhere

### Layout
- **Centered modal** with backdrop blur
- **Search input** at top (auto-focused)
- **Results sections:**
  1. **Memory** — Conversation search (debounced API call to `/api/Infinity/conversations/search`)
  2. **Actions** — Filtered by query (fuzzy substring match)
- **Keyboard:** ↑/↓ navigate, Enter select, Escape close
- **Footer quick actions:** New Chat, Toggle Web Search, Toggle Theme, Settings

### Actions Available
| ID | Label | Shortcut | Action |
|----|-------|----------|--------|
| chat | Chat | G | Switch to chat mode |
| voice | Voice | V | Switch to voice mode |
| agent | Agent | A | Switch to agent mode |
| camera | Camera | C | Switch to camera mode |
| research | Deep Research | R | Open research panel |
| expert | New Expert | N | Open expert dialog |
| datalab | Data Lab | D | Open data lab |
| image | Generate Image | I | Focus chat input for image prompt |

---

## 12. Demo Pages

### 12A. ChatDemo (`ChatDemo.tsx`)
**Route:** `/demo/chat` (presumably)
- Showcases `ChatView` with mock messages demonstrating:
  - User/assistant messages
  - Reasoning blocks
  - All 18 widget types
  - Suggestions
  - Deep research expert button

### 12B. WidgetShowcase (`WidgetShowcase.tsx`)
**Route:** `/demo/widgets` (presumably)
- Grid of all 18 widget components with sample data:
  - Text, Markdown, Code, Image, Chart, Table, FileTree, Terminal, Diff, Mermaid, Map, Video, Audio, PDF, JSON, HTML, React, Widget

---

## Summary: Page/State Matrix

| Page / State | Route / Trigger | Key Components |
|-------------|-----------------|----------------|
| **New Chat** | `/` (default), New Chat btn | `ChatModeView` + empty `ConversationFeed` |
| **Running Chat** | `/` with messages | `ChatModeView` + `ConversationFeed` + widgets |
| **Chat + Menu** | Click + in composer | `PlusMenu` (Attach/Create/Studios) |
| **Chat @ Popup** | Type @ in composer | `PlusMenu` (Tools only, filtered) |
| **Voice Mode** | Blue waveform btn, Cmd+K→Voice | `VoiceModeView` (full-screen orb) |
| **Camera Mode** | +→Camera, Cmd+K→Camera | `CameraModeView` (full-screen camera) |
| **Agent Mode** | +→Agent, @agent-mode | `ChatModeView` with `agentModeActive=true` |
| **Settings** | Gear icon, Cmd+K→Settings | `SettingsView` (5 sections) |
| **Build Studio** | +→Build, @build-mode, @Build | `BuildView` (5 tabs + sidebars) |
| **Projects Gallery** | Sidebar project list | `ProjectsView` (grid + sidebar) |
| **Project Home** | Click project card | `ProjectHomeRouter` → 1 of 6 variants |
| **Project Memory** | Project home → Memory | `ProjectMemory` |
| **Project Instructions** | Project home → Instructions | `ProjectInstructions` |
| **Terminal** | Cmd+K→Terminal, Build→Terminal | `TerminalView` (xterm.js) |
| **Research Panel** | +→Research, @research | Research jobs list + start new |
| **Expert Dialog** | +→New Expert, @new-expert | Create expert persona form |
| **Data Lab** | +→Data Lab, @data-lab | Data analysis workspace |
| **Studios Hub** | +→All Studios | 10 studio cards grid |
| **Design Studio** | Studios→Design, @design-studio | Image generation workspace |
| **Music Studio** | Studios→Music, @music-studio | Music generation workspace |
| **Book Studio** | Studios→Book | Book generation jobs |
| **Command Palette** | Cmd+K | Search + actions |
| **PiP Browser** | Agent mode, @web-search | Floating browser window |
| **Error Details** | Toast→DETAILS | Full error context panel |

---

## Widget Types (18 Total)
Rendered inside `ConversationFeed` via `WidgetRenderer`:

1. **Text** — Plain text
2. **Markdown** — Rendered markdown
3. **Code** — Syntax-highlighted code blocks
4. **Image** — Generated/uploaded images
5. **Chart** — Chart.js visualizations
6. **Table** — Sortable data tables
7. **FileTree** — Hierarchical file explorer
8. **Terminal** — Command output
9. **Diff** — File diffs
10. **Mermaid** — Diagrams
11. **Map** — Geographic maps
12. **Video** — Video player
13. **Audio** — Audio player
14. **PDF** — PDF viewer
15. **JSON** — Formatted JSON
16. **HTML** — HTML preview
17. **React** — Live React components
18. **Widget** — Generic container

---

## Navigation Flow Summary

```
┌─────────────────────────────────────────────────────────────┐
│                        HOME (root)                          │
│  ┌──────────┬──────────┬──────────┬──────────┐             │
│  │  CHAT    │  VOICE   │  AGENT   │  CAMERA  │  ← Modes    │
│  └────┬─────┴────┬─────┴────┬─────┴────┬─────┘             │
│       │          │          │          │                    │
│  ┌────▼────┐  ┌───▼───┐  ┌───▼───┐  ┌──▼──┐               │
│  │ ChatView│  │Orb UI │  │ChatView│  │Camera│               │
│  │+Composer│  │       │  │+Agent  │  │Feed  │               │
│  └────┬────┘  └───────┘  └────────┘  └──────┘               │
│       │                                                        │
│  ┌────▼──────────────────────────────────────┐              │
│  │         SIDEBAR (ChatSidebar)             │              │
│  │  Conversations │ Project Gallery          │              │
│  └───────────────────────────────────────────┘              │
│       │                                                        │
│  ┌────▼──────────────────────────────────────┐              │
│  │       PROJECT HOME (6 variants)           │              │
│  │  General │ App │ Website │ Company        │              │
│  │  Research │ Course                        │              │
│  └───────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────────┘

OVERLAYS (AppOverlays - all modal):
Settings │ Research │ Expert │ Data Lab │ Build │ Studios │
Design │ Music │ Book │ Palette │ PiP Browser │ Error Details
```

---

*This inventory reflects the codebase state as of 2026-08-20. All paths relative to `/workspaces/Infinity-AI/artifacts/Infinity/src/`.*