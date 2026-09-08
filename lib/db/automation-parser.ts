/**
 * Automation Parser bridge for @workspace/db.
 *
 * The AutomationRegistry (in this package) depends on the api-server's
 * AutomationParser for spec validation and natural-language parsing. That
 * class lives in `artifacts/api-server/src/lib/automation-parser.ts` and also
 * exposes `generateId` / `generateIdempotencyKeyTemplate` as static methods.
 * This module re-exports the class/types and wraps the static helpers as
 * standalone functions so the registry's imports resolve.
 */

import {
  AutomationParser,
  AutomationTriggerType,
} from "../../artifacts/api-server/src/lib/automation-parser.js";
import type {
  AutomationSpec,
  AutomationTrigger,
} from "../../artifacts/api-server/src/lib/automation-parser.js";

export { AutomationParser, AutomationTriggerType };
export type { AutomationSpec, AutomationTrigger };

/** Wrap AutomationParser.generateId as a standalone helper. */
export function generateId(name: string): string {
  return AutomationParser.generateId(name);
}

/** Wrap AutomationParser.generateIdempotencyKeyTemplate as a standalone helper. */
export function generateIdempotencyKeyTemplate(trigger: AutomationTrigger): string {
  return AutomationParser.generateIdempotencyKeyTemplate(trigger);
}
