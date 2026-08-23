---
name: UI icon system
description: Shared icon rules for the infinity-ai interface.
---

Use Lucide icons for interface actions, status indicators, widgets, and controls. Reuse the same semantic icon everywhere an action repeats, especially the canonical `Search` icon for all search affordances. Avoid emoji, text glyphs, and hand-drawn inline SVGs as UI icons; data visualizations such as timer progress rings are not icons.

**Why:** Mixed emoji, glyph, custom SVG, and Lucide icons made repeated actions visually inconsistent and weakened the app’s visual language.

**How to apply:** New UI icons should come from Lucide, inherit the shared stroke treatment, and reuse an existing semantic icon before introducing a new one. Preserve the existing Search shape wherever search appears.