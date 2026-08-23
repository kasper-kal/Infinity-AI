---
name: Orb background treatment
description: The visual boundary between the infinity-ai orb and the page background texture.
---

Keep the page’s subtle global dot texture intact. When removing dots from the voice orb, remove the orb-local particle layer and use only a small background-colored halo behind the orb to hide the global texture in that local area.

**Why:** The global texture is part of the preferred page aesthetic; removing it globally makes the rest of the interface feel too plain, while a large local mask can cover nearby controls.

**How to apply:** Scope dot removal to the orb component and keep the mask tight to the orb plus a small immediate halo.