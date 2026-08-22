/**
 * Phase 21/22: Universal Tool Layer — Tools Registration Index
 *
 * Barrel export for all tool category registration functions.
 * Call `registerAllTools()` during server initialization to populate the registry.
 */

import { registerBuildTools } from "./build";
import { registerWebTools } from "./web";
import { registerBrowserTools } from "./browser";
import { registerFilesTools } from "./files";
import { registerMemoryTools } from "./memory";
import { registerResearchTools } from "./research";
import { registerEvolutionTools } from "./evolution";

export { registerBuildTools } from "./build";
export { registerWebTools } from "./web";
export { registerBrowserTools } from "./browser";
export { registerFilesTools } from "./files";
export { registerMemoryTools } from "./memory";
export { registerResearchTools } from "./research";
export { registerEvolutionTools } from "./evolution";
// TODO: Add other category registrations as phases progress
// export { registerVisionTools } from "./vision";
// export { registerDataTools } from "./data";
// export { registerIntegrationTools } from "./integration";

/**
 * Register all currently available tools into the Universal Tool Registry.
 * This should be called once at server startup.
 */
export function registerAllTools(): void {
  registerBuildTools();
  registerWebTools();
  registerBrowserTools();
  registerFilesTools();
  registerMemoryTools();
  registerResearchTools();
  registerEvolutionTools();
  // Other categories will be added in future phases
}