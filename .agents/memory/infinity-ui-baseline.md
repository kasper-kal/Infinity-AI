---
name: Jarvis UI visual baseline
description: The approved Jarvis mobile visual language and layout baseline to restore after upstream GitHub pulls.
---

The approved Jarvis UI is a light, Apple-like glass interface with a very subtle page-wide dotted texture. Preserve the original luminous neural-network orb identity; do not add orb-local particles or replace it with a generated concept. The orb should remain quiet and minimal when idle.

**Why:** The user evaluates this interface visually from phone screenshots and has explicitly preferred the original Jarvis identity over experimental replacements.

**How to apply:** After any upstream merge or pull, compare the mobile empty chat screen against the saved reference screenshots and restore this baseline before making new visual changes.

## Approved icon language

Use Lucide icons consistently for interface controls, with the canonical Lucide `Search` preserved everywhere search appears. Do not replace these with emoji, text glyphs, or unrelated substitutes:

- Header new-chat control: `SquarePen`; header overflow: `EllipsisVertical`; history/menu: `PanelLeft`.
- Sidebar new chat: `Pencil`; settings: `Settings`.
- Empty-state suggestions: `Sun` for briefing, `Image` for image creation, `Pencil` for writing/editing, `Search` for web search.
- Composer: `Plus`, `Lightbulb`, canonical `Search`, and a normal `Mic` inside the textarea.
- The blue voice-mode composer button intentionally uses a custom five-mark voice symbol, not a Lucide icon: a near-dot, tall stripe, tallest stripe, tall stripe, near-dot. The outer marks are slightly longer than dots, but almost dots.
- Plus menu: `Paperclip`, `Camera`, `Sparkles`, `ImageIcon`, `LayoutGrid`, `Palette`, and `Music2`.

**Why:** The user requested a specific mix of original semantic icons and one custom voice mark; changing the icons while restoring layout would regress an already-approved visual pass.

**How to apply:** Restore the icon mapping before evaluating spacing. Do not “modernize” or redesign icons while fixing responsive layout.

## Empty chat composition

The mobile empty state contains all four suggestions: briefing, create image, write/edit, and web search. They must remain visible on mobile and desktop; never hide the secondary suggestions as a shortcut for avoiding overlap with the plus menu.

The header is a compact top zone, the composer is a stable bottom zone, and the Jarvis orb plus all suggestions form one flexible middle-zone cluster. The cluster should be positioned relative to the available space between header and composer, not by a single fixed pixel offset. Taller phones may place the cluster slightly lower; short phones must keep the entire stack inside the usable chat area.

The composer is a rounded pill anchored at the bottom with safe-area support. On very narrow, short phones it stays a stable single-line height rather than expanding into a multi-line block. The plus menu remains reachable above the composer; on short screens it can scroll internally so every action remains accessible.

**Why:** Fixed offsets looked acceptable on an iPhone 15-sized screen but clipped or crowded the same content on iPhone 4-sized and compact phones. The user specifically wants the composition to adapt automatically to phone height.

**How to apply:** Validate at 320×480, 375×667, 393×852, and an extra-tall phone viewport around 402×1000. Force persisted mode to `chat` before taking screenshots because the app may reopen in saved voice mode.

## Interaction and surface treatment

Keep the page mostly white/light with restrained borders, soft shadows, rounded Apple-style controls, and the existing subtle background texture. The open plus menu is a single action surface above the composer; it should not be mistaken for a second suggestion stack. Preserve the readable primary briefing card and the lighter secondary suggestion rows.

**Why:** The intended visual hierarchy is calm and spacious: one welcome cluster in the middle, one stable composer at the bottom, and overlays that attach to their triggering control.

**How to apply:** If an upstream change makes the screen feel empty, crowded, or vertically arbitrary, fix the zone sizing and available-space calculation rather than adding decorative elements or changing iconography.