/**
 * Fast capability classification for chat routing.
 *
 * This intentionally only returns high-confidence intents. Anything uncertain
 * stays `none` and follows the normal model path instead of hijacking a turn.
 */

export type CapabilityIntent =
  | 'web_search'
  | 'timer'
  | 'image_generation'
  | 'screen_share'
  | 'agent_browser'
  | 'build'
  | 'none';

export interface CapabilityClassification {
  intent: CapabilityIntent;
  confidence: 'high' | 'none';
}

export function classifyCapabilityIntent(message: string): CapabilityClassification {
  const text = message.trim().toLowerCase();
  if (!text) return { intent: 'none', confidence: 'none' };

  // Preserve the more specific existing widget/action routes first.
  if (/\b(set|start)\s+(?:a\s+)?(?:\d+[\s\w]*?\s+)?timer\b|\b(countdown|count down)\b|\b(timer\s+(for|of))\b/.test(text)) {
    return { intent: 'timer', confidence: 'high' };
  }
  if (/\b(draw|generate|create|make|paint)\b[\s\w]*(image|picture|photo|art|illustration|drawing|sketch)\b/.test(text)) {
    return { intent: 'image_generation', confidence: 'high' };
  }
  if (/\b(start|begin|activate|enable)\s+(screen\s+)?(share|sharing)|\bshare\s+(my\s+)?screen\b|\blet\s+(me|infinity)\s+see\s+(your\s+)?screen\b/.test(text)) {
    return { intent: 'screen_share', confidence: 'high' };
  }
  if (/\b(use|open|launch|start|enter)\b[\s\w]*(agent|browser)\b|\b(browse|navigate)\b[\s\w]*\b(agent|browser)\b/.test(text)) {
    return { intent: 'agent_browser', confidence: 'high' };
  }
  if (/\b(build|code|implement|scaffold)\b[\s\w]*(app|website|project|component|feature)\b|\b(open|enter|start)\s+build\s+mode\b/.test(text)) {
    return { intent: 'build', confidence: 'high' };
  }

  // Current or time-sensitive wording should search automatically. Do not
  // classify generic questions as web searches: that keeps normal chat fast.
  const liveSignal = /\b(latest|recent|news|today|currently|current|right now|this week|this month|as of now|what happened)\b/.test(text);
  const explicitSearch = /\b(search|look up|find online|browse the web|on the web|online)\b/.test(text);
  if (liveSignal || explicitSearch) {
    return { intent: 'web_search', confidence: 'high' };
  }

  return { intent: 'none', confidence: 'none' };
}
