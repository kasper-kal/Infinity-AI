/**
 * Lightweight Dutch ⇄ English language detection for speech transcripts.
 *
 * The Web Speech API only transcribes one language at a time. Rather than
 * hard-coding `nl-NL` or `en-US`, we score the transcript against common
 * Dutch and English function words and pick whichever language matches best.
 * The recognizer is then (re)started with that language for the next utterance.
 *
 * Thresholds are tuned so a single ambiguous word doesn't flip the language —
 * we need a clear margin before switching.
 */

const DUTCH_WORDS: Record<string, number> = {
  de: 2, het: 2, een: 2, ik: 2, jij: 2, je: 2, niet: 2, wat: 2, hoe: 2,
  waar: 2, is: 2, zijn: 2, en: 2, maar: 2, ook: 2, nog: 2, van: 2, met: 2,
  voor: 2, dat: 2, dit: 2, weer: 2, goedemorgen: 3, hallo: 2, alsjeblieft: 3,
  bedankt: 3, gewoon: 2, even: 2, alvast: 2, wil: 2, kan: 2, moet: 2, ga: 1,
  tijd: 2, uur: 2, minuten: 2, vandaag: 3, morgen: 3, vertel: 2, vraag: 1,
  antwoord: 2, open: 1, zoek: 2, speel: 2, muziek: 2, weerbericht: 4,
};

const ENGLISH_WORDS: Record<string, number> = {
  the: 2, a: 1, an: 1, i: 2, you: 2, not: 2, what: 2, how: 2, where: 2,
  is: 2, are: 2, and: 2, but: 2, also: 2, still: 2, of: 2, with: 2, for: 2,
  that: 2, this: 2, weather: 3, good: 2, morning: 2, hello: 2, hi: 1,
  please: 3, thanks: 3, thank: 3, just: 2, want: 2, can: 2, will: 2, time: 2,
  today: 3, tomorrow: 3, tell: 2, open: 1, search: 2, play: 2, music: 2,
  forecast: 4, minutes: 2,
};

const SEPARATOR = /[^a-zà-ÿ0-9]+/i;

/** Score a transcript against a word table. */
function scoreText(text: string, table: Record<string, number>): number {
  const words = text.toLowerCase().split(SEPARATOR).filter(Boolean);
  let score = 0;
  for (const w of words) {
    score += table[w] ?? 0;
  }
  return score;
}

export type DetectedLang = 'nl' | 'en' | 'unknown';

/**
 * Detect whether a transcript is Dutch, English, or ambiguous.
 * Returns 'unknown' when the signal is too weak to flip the recognizer.
 */
export function detectSpeechLanguage(text: string): DetectedLang {
  if (!text || !text.trim()) return 'unknown';
  const nl = scoreText(text, DUTCH_WORDS);
  const en = scoreText(text, ENGLISH_WORDS);

  if (nl === 0 && en === 0) return 'unknown';
  // Require a clear margin so one shared word ("open", "is") can't flip us.
  if (nl - en >= 3) return 'nl';
  if (en - nl >= 3) return 'en';
  return 'unknown';
}

/** Map a detected language to a BCP-47 tag accepted by SpeechRecognition. */
export function toSpeechLangTag(detected: DetectedLang, fallback: string): string {
  if (detected === 'nl') return 'nl-NL';
  if (detected === 'en') return 'en-US';
  return fallback;
}
