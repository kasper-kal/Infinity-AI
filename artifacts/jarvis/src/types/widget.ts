export interface ClockTimezone { label: string; tz: string }
export interface ForecastDay { date: string; maxTemp_c: number; minTemp_c: number; condition: string; conditionCode: number }
export interface CalendarEvent { id: string; title: string; start: string; end?: string; allDay: boolean; calendarName?: string }
export interface ImageResult {
  url: string;
  thumbnail: string;
  title: string;
  source: string;
  creator?: string;
  license: string;
  licenseUrl?: string;
  landingUrl?: string;
  width?: number;
  height?: number;
}
export interface DefineMeaning {
  partOfSpeech: string;
  definition: string;
  example?: string;
}

export interface MusicNote {
  note: string;
  dur: number;
  time: number;
}

export interface MusicComposition {
  title: string;
  mood: 'happy' | 'chill' | 'epic' | 'sad';
  tempo: number;
  root: string;
  scale: number[];
  chords: string[];
  bass: string[];
  melody: MusicNote[];
  drumPattern: number[];
}

export interface FileEdit {
  path: string;
  bytesWritten: number;
  oldContent: string;
  newContent: string;
}

export type Widget =
  | { type: 'clock'; timezones: ClockTimezone[] }
  | { type: 'weather'; location: string; temp_c: number; temp_f: number; feelsLike_c: number; condition: string; conditionCode: number; humidity: number; windSpeed_kmh: number; windDir: string; isDay: boolean; forecast: ForecastDay[] }
  | { type: 'timer'; durationSeconds: number; label?: string; timerAction?: 'set' | 'add' | 'cancel'; deltaSeconds?: number }
  | { type: 'alarm'; time: string; label?: string }
  | { type: 'calendar'; events: CalendarEvent[]; weekStart: string }
  | { type: 'images'; query: string; results: ImageResult[] }
  | { type: 'date' }
  | { type: 'calculator'; expression: string; result: string }
  | { type: 'define'; word: string; phonetic?: string; meanings: DefineMeaning[] }
  | { type: 'unit'; value: number; fromUnit: string; toUnit: string; category: string; label: string }
  | { type: 'currency'; from: string; to: string; amount: number; rate: number; updated: string }
  | { type: 'map'; query: string; lat: number; lon: number; displayName: string }
  | { type: 'random'; kind: 'dice' | 'coin' | 'number'; value: number; label: string }
  | { type: 'music'; composition: MusicComposition }

/** A terminal command card shown in chat (from run_terminal SSE events). */
export interface TerminalResult {
  command: string;
  exitCode: number;
  output: string;
}

/** A file the user attached to a message (base64 + metadata). */
export interface AttachedFile {
  base64: string;
  mimeType: string;
  fileName: string;
  preview?: string; // object URL for images
}

/** Fact-check result for an assistant message (from /api/jarvis/verify). */
export interface VerifyClaim {
  claim: string;
  verdict: 'supported' | 'contradicted' | 'unverifiable';
  evidence: { title: string; url: string; snippet: string }[];
  note?: string;
}
