/**
 * Shared EventEmitter — singleton used across Infinity modules
 * for cross-module pub/sub (workflow updates, clarification sessions, etc.).
 */

import { EventEmitter } from "events";

export const eventEmitter = new EventEmitter();
eventEmitter.setMaxListeners(100);
