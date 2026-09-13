/**
 * CREW TIERS — the one source of truth for Phase 2 per-agent key assignment.
 *
 * Zero-dependency leaf so the harness (and adapter-factory) both prove the same
 * mapping: which crew role gets which tier of the user's key pool.
 *
 *   planner  → max  (best healthy key)     — architecture, plan quality
 *   reviewer → max  (best healthy key)     — independent, high-stakes critique
 *   coder    → high (second-best key)      — daily implementation work
 *   fixer    → high (second-best key)      — cheap targeted patches
 *   helper   → local (Ollama; $0)          — history index / BM25 answers
 *   designer → max                          — pixel/UX judgment
 *
 * Honest degradation: with a SINGLE key every non-helper tier shares it (the
 * user has nothing else). pickKeyIndex is pure so the assignment is testable.
 */

export type CrewEffort = "max" | "high" | "lite" | "local";

/** Crew role → effort tier. Unknown roles default to "high" (safe middle tier). */
export const CREW_ROLE_EFFORTS: Record<string, CrewEffort> = {
  planner: "max",
  reviewer: "max",
  coder: "high",
  fixer: "high",
  helper: "local",
  designer: "max",
};

/**
 * Which index of the priority-sorted key pool a tier consumes:
 *
 *   max  → keys[0]                             (best)
 *   high → keys[min(1, n-1)]                   (second-best; single key → keys[0])
 *   lite → keys[n-1]                           (cheapest)
 *   local → never a pool key (Ollama first)    (returns -1)
 */
export function pickKeyIndex(effort: CrewEffort, keyCount: number): number {
  if (effort === "local") return -1;
  if (effort === "max") return 0;
  if (keyCount <= 1) return 0; // one key → every tier shares it (honest)
  if (effort === "high") return 1;
  return keyCount - 1; // lite
}

/** Human-readable description of a role's tier (for logs / the harness). */
export function describeCrewTier(role: string): { role: string; effort: CrewEffort; note: string } {
  const effort = crewEffortFor(role);
  const note = effort === "local"
    ? "local model (Ollama, $0)"
    : effort === "max"
      ? "best healthy key"
      : effort === "lite"
        ? "cheapest healthy key"
        : "second-best healthy key";
  return { role, effort, note };
}

/** Resolve a role → effort without touching the key pool (safe anywhere). */
export function crewEffortFor(role: string): CrewEffort {
  return CREW_ROLE_EFFORTS[role] ?? "high";
}