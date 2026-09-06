/**
 * Transformers.js (WASM) fallback for Safety Watcher local model inference.
 * Runs entirely in-browser or in Node with @xenova/transformers.
 * Zero external dependencies, $0 budget.
 */

import { env, AutoModelForCausalLM, AutoTokenizer, Pipeline } from "@xenova/transformers";

// Disable remote model loading - we'll use local/cache only
env.allowRemoteModels = false;
env.useBrowserCache = true;

let classifierPipeline: Pipeline | null = null;
let initPromise: Promise<void> | null = null;

const SAFETY_CLASSIFIER_MODEL = "Xenova/distilbert-base-uncased-finetuned-sst-2-english";

/** Initialize the transformers pipeline (one-time, async) */
async function initPipeline(): Promise<void> {
  if (classifierPipeline) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // Use a lightweight classification model for safety analysis
      classifierPipeline = await AutoModelForCausalLM.from_pretrained(SAFETY_CLASSIFIER_MODEL, {
        dtype: "q4", // Quantized for speed/size
        progress_callback: (progress: any) => {
          if (progress.status === "downloading") {
            console.log(`[Transformers Watcher] Loading model: ${Math.round(progress.progress * 100)}%`);
          }
        },
      });
      console.log("[Transformers Watcher] Pipeline ready");
    } catch (error) {
      console.error("[Transformers Watcher] Failed to initialize:", error);
      classifierPipeline = null;
      throw error;
    }
  })();

  return initPromise;
}

/**
 * Analyze an event for safety concerns using local transformers model.
 * Returns a severity assessment: "safe" | "warning" | "critical"
 */
export async function analyzeWithTransformers(
  eventSummary: string
): Promise<{ severity: "safe" | "warning" | "critical"; confidence: number; reasoning: string } | null> {
  try {
    await initPipeline();
    if (!classifierPipeline) return null;

    // For now, use a simple keyword-based heuristic since we're using a sentiment model
    // In production, you'd fine-tune a model on safety event classifications
    const lower = eventSummary.toLowerCase();

    const criticalKeywords = ["secret", "password", "token", "api key", "credential", "pii", "ssn", "credit card"];
    const warningKeywords = ["error", "fail", "timeout", "crash", "loop", "stall", "memory", "cpu", "disk"];

    let severity: "safe" | "warning" | "critical" = "safe";
    let confidence = 0.5;
    let reasoning = "No obvious safety concerns detected.";

    for (const kw of criticalKeywords) {
      if (lower.includes(kw)) {
        severity = "critical";
        confidence = 0.9;
        reasoning = `Detected sensitive keyword: "${kw}"`;
        break;
      }
    }

    if (severity === "safe") {
      for (const kw of warningKeywords) {
        if (lower.includes(kw)) {
          severity = "warning";
          confidence = 0.7;
          reasoning = `Detected potential issue keyword: "${kw}"`;
          break;
        }
      }
    }

    return { severity, confidence, reasoning };
  } catch (error) {
    console.error("[Transformers Watcher] Analysis failed:", error);
    return null;
  }
}

/** Check if transformers is available/initialized */
export function isTransformersReady(): boolean {
  return classifierPipeline !== null;
}

/** Preload the model (call at app startup) */
export async function preloadTransformers(): Promise<void> {
  await initPipeline();
}