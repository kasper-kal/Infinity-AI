/**
 * Phase 21/22: Universal Tool Layer — Tools Registration Index
 *
 * Barrel export for all tool category registration functions.
 * Call `registerAllTools()` during server initialization to populate the registry.
 */

import { registerBuildTools } from "./build";
export { registerBuildTools } from "./build";
// TODO: Add other category registrations as phases progress
// export { registerWebTools } from "./web";
// export { registerBrowserTools } from "./browser";
// export { registerFilesTools } from "./files";
// export { registerVisionTools } from "./vision";
// export { registerDataTools } from "./data";
// export { registerMemoryTools } from "./memory";
// export { registerResearchTools } from "./research";
// export { registerEvolutionTools } from "./evolution";
// export { registerIntegrationTools } from "./integration";

/**
 * Register all currently available tools into the Universal Tool Registry.
 * This should be called once at server startup.
 */
export function registerAllTools(): void {
  registerBuildTools();
  // Other categories will be added in Phase 22
}