import { useEffect, useRef, useCallback, useState } from 'react';

/**
 * Free, fully client-side emotion detection from microphone audio.
 *
 * Instead of a heavyweight ML model (wav2vec/emotion2vec, ~100MB+ downloads),
 * this analyses PROSODY from the live mic with the Web Audio API:
 *   - RMS energy (loudness)
 *   - spectral centroid (brightness/tension)
 *   - zero-crossing rate (vocal tension / harshness)
 *   - pitch via autocorrelation (and its variance, excitement raises pitch)
 *   - speaking rate from the energy-envelope syllable peaks
 *
 * Windows of ~2.4s are classified into calm / excited / frustrated /
 * stressed / tired / neutral with heuristic thresholds. Zero cost, zero
 * network, runs entirely in the browser.
 */

export type EmotionLabel =
  | 'neutral'
  | 'calm'
  | 'excited'
  | 'frustrated'
  | 'stressed'
  | 'tired';

interface Frame {
  rms: number;       // 0..1 normalized energy
  centroid: number;  // Hz
  zcr: number;       // 0..1 ratio
  pitch: number;     // Hz, 0 if unvoiced
}

interface UseEmotionDetectionOptions {
  /** Set to true while actively recording the user's voice. */
  enabled: boolean;
  onEmotion?: (label: EmotionLabel) => void;
  /** Smoothed voice energy, normalized 0..1, for lightweight visual reactions. */
  onAmplitude?: (amplitude: number) => void;
  /** How often (ms) a fresh classification window is emitted. */
  windowMs?: number;
}

export function useEmotionDetection({
  enabled,
  onEmotion,
  onAmplitude,
  windowMs = 2400,
}: UseEmotionDetectionOptions) {
  const [emotion, setEmotion] = useState<EmotionLabel>('neutral');
  const [supported, setSupported] = useState<boolean | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const framesRef = useRef<Frame[]>([]);
  const windowStartRef = useRef<number>(0);
  const noiseFloorRef = useRef(0.02);
  const enabledRef = useRef(enabled);
  const onEmotionRef = useRef(onEmotion);
  const onAmplitudeRef = useRef(onAmplitude);
  const failedRef = useRef(false);

  enabledRef.current = enabled;
  onEmotionRef.current = onEmotion;
  onAmplitudeRef.current = onAmplitude;

  /* ── feature extraction ─────────────────────────────────────── */

  const extractFrame = useCallback((
    analyser: AnalyserNode,
    timeData: Uint8Array<ArrayBuffer>,
    freqData: Uint8Array<ArrayBuffer>,
    binCount: number,
    sampleRate: number,
  ): Frame => {
    analyser.getByteTimeDomainData(timeData);
    analyser.getByteFrequencyData(freqData);

    // RMS energy (time domain, normalized 0..1)
    let sumSq = 0;
    let zcr = 0;
    for (let i = 0; i < timeData.length; i++) {
      const v = (timeData[i] - 128) / 128;
      sumSq += v * v;
      if (i > 0 && ((timeData[i - 1] - 128) ^ (timeData[i] - 128)) < 0) zcr++;
    }
    const rms = Math.sqrt(sumSq / timeData.length);
    const zcrRatio = zcr / timeData.length;

    // Spectral centroid (Hz)
    let num = 0;
    let den = 0;
    const binHz = sampleRate / 2 / binCount;
    for (let i = 0; i < binCount; i++) {
      const mag = freqData[i] / 255;
      num += mag * i * binHz;
      den += mag;
    }
    const centroid = den > 0 ? num / den : 0;

    // Pitch via autocorrelation (time domain), only when voiced
    let pitch = 0;
    if (rms > noiseFloorRef.current * 1.6) {
      const minLag = Math.floor(sampleRate / 400); // 400 Hz max
      const maxLag = Math.floor(sampleRate / 70);  // 70 Hz min
      let bestLag = 0;
      let bestCorr = 0;
      for (let lag = minLag; lag <= maxLag; lag++) {
        let corr = 0;
        for (let i = 0; i < Math.min(timeData.length - lag, 1024); i++) {
          corr += ((timeData[i] - 128) / 128) * ((timeData[i + lag] - 128) / 128);
        }
        corr /= Math.min(timeData.length - lag, 1024);
        if (corr > bestCorr) {
          bestCorr = corr;
          bestLag = lag;
        }
      }
      if (bestLag > 0 && bestCorr > 0.3) pitch = sampleRate / bestLag;
    }

    return { rms, centroid, zcr: zcrRatio, pitch };
  }, []);

  /* ── classifier ─────────────────────────────────────────────── */

  const classifyWindow = useCallback((frames: Frame[]): EmotionLabel => {
    if (frames.length === 0) return 'neutral';

    // Speech detection: fraction of frames above the noise floor
    let voiced = 0;
    for (const f of frames) if (f.rms > noiseFloorRef.current * 1.8) voiced++;
    const voicedRatio = voiced / frames.length;
    if (voicedRatio < 0.28) return 'neutral'; // not enough actual speech

    const voicedFrames = frames.filter((f) => f.rms > noiseFloorRef.current * 1.8);
    const avgEnergy = voicedFrames.reduce((a, f) => a + f.rms, 0) / Math.max(1, voicedFrames.length);
    const avgCentroid = voicedFrames.reduce((a, f) => a + f.centroid, 0) / Math.max(1, voicedFrames.length);
    const avgZcr = voicedFrames.reduce((a, f) => a + f.zcr, 0) / Math.max(1, voicedFrames.length);

    const pitches = voicedFrames.filter((f) => f.pitch > 60).map((f) => f.pitch);
    const avgPitch = pitches.length ? pitches.reduce((a, b) => a + b, 0) / pitches.length : 0;
    const pitchVar = pitches.length > 1
      ? Math.sqrt(pitches.reduce((a, p) => a + (p - avgPitch) ** 2, 0) / pitches.length)
      : 0;

    // Speaking rate: count energy-envelope onsets (syllable-ish peaks)
    let peaks = 0;
    let prev = frames[0]?.rms ?? 0;
    let rising = false;
    for (const f of frames) {
      if (f.rms > prev * 1.25 && f.rms > noiseFloorRef.current * 2) {
        if (!rising) peaks++;
        rising = true;
      } else {
        rising = false;
      }
      prev = f.rms;
    }
    const seconds = frames.length * 0.05; // frames are ~50ms apart
    const rate = seconds > 0 ? peaks / seconds : 0; // syllables per second

    const energyNorm = Math.min(1, avgEnergy / 0.35);
    const pitchNorm = Math.min(1, avgPitch / 350);
    const centroidNorm = Math.min(1, avgCentroid / 3000);

    // High energy + high pitch + high pitch variance + fast rate → excited
    if (energyNorm > 0.62 && pitchNorm > 0.55 && pitchVar > 45 && rate > 3.6) return 'excited';
    // Very high energy + very high ZCR + fast rate → frustrated (tense, harsh)
    if (energyNorm > 0.7 && avgZcr > 0.14 && rate > 3.2 && centroidNorm > 0.5) return 'frustrated';
    // High energy + high pitch variance + fast rate → stressed
    if (energyNorm > 0.55 && pitchVar > 50 && rate > 3.2) return 'stressed';
    // Low energy + slow rate + low pitch variance → tired / low
    if (energyNorm < 0.18 && rate < 2.0 && pitchVar < 25) return 'tired';
    // Moderate everything with low centroid → calm
    if (energyNorm < 0.38 && rate < 3.0 && centroidNorm < 0.45 && pitchVar < 40) return 'calm';

    return 'neutral';
  }, []);

  /* ── lifecycle ──────────────────────────────────────────────── */

  useEffect(() => {
    if (!enabled || failedRef.current) return;

    let cancelled = false;

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          failedRef.current = true;
          setSupported(false);
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctor();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);

        ctxRef.current = ctx;
        analyserRef.current = analyser;
        streamRef.current = stream;
        setSupported(true);

        const timeData = new Uint8Array(new ArrayBuffer(analyser.fftSize)) as Uint8Array<ArrayBuffer>;
        const freqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)) as Uint8Array<ArrayBuffer>;
        framesRef.current = [];
        windowStartRef.current = performance.now();
        let lastFrameTime = 0;
        let lastAmplitudeTime = 0;
        let smoothedAmplitude = 0;

        const loop = () => {
          if (cancelled || !analyserRef.current) return;
          const now = performance.now();
          if (now - lastFrameTime >= 50) {
            lastFrameTime = now;
            const frame = extractFrame(analyser, timeData, freqData, analyser.frequencyBinCount, ctx.sampleRate);
            framesRef.current.push(frame);
            if (framesRef.current.length > 60) framesRef.current.shift();

            // Reuse the existing analyser for a low-cost visual voice meter.
            // The smoothing makes the orb feel physical instead of jittering
            // on individual samples, and silence naturally settles to zero.
            if (now - lastAmplitudeTime >= 80) {
              lastAmplitudeTime = now;
              const target = Math.min(1, Math.max(0, (frame.rms - noiseFloorRef.current * 1.15) / 0.12));
              smoothedAmplitude = smoothedAmplitude * 0.78 + target * 0.22;
              onAmplitudeRef.current?.(smoothedAmplitude);
            }

            if (now - windowStartRef.current >= windowMs) {
              const label = classifyWindow(framesRef.current);
              framesRef.current = [];
              windowStartRef.current = now;
              if (label !== 'neutral') {
                setEmotion(label);
                onEmotionRef.current?.(label);
              }
            }
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
      } catch {
        // Mic busy (e.g. SpeechRecognition owns it on iOS), disable quietly.
        failedRef.current = true;
        setSupported(false);
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (ctxRef.current) {
        ctxRef.current.close().catch(() => {});
        ctxRef.current = null;
      }
      analyserRef.current = null;
      framesRef.current = [];
      onAmplitudeRef.current?.(0);
    };
  }, [enabled, windowMs, extractFrame, classifyWindow]);

  return { emotion, supported };
}
