import { useRef, useCallback, useEffect } from 'react';

interface UseClapDetectionOptions {
  /** Clap detected, fire the same callback as wake word */
  onClap: () => void;
  /** Enable/disable clap detection */
  enabled?: boolean;
  /** Amplitude threshold for detecting a clap (0-1, default 0.3) */
  threshold?: number;
  /** Maximum time between two claps in ms (default 500) */
  maxClapInterval?: number;
  /** Cooldown after a double clap to prevent re-triggering in ms (default 2000) */
  cooldown?: number;
}

/**
 * Detects double clap activation via microphone amplitude monitoring.
 * Uses Web Audio API to analyze audio levels in real-time.
 *
 * Detection logic:
 * 1. Monitor audio amplitude continuously
 * 2. When amplitude exceeds threshold → clap detected
 * 3. If second clap occurs within maxClapInterval → double clap confirmed
 * 4. Fire onClap callback
 */
export function useClapDetection({
  onClap,
  enabled = true,
  threshold = 0.3,
  maxClapInterval = 500,
  cooldown = 2000,
}: UseClapDetectionOptions) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const lastClapTimeRef = useRef(0);
  const clapCountRef = useRef(0);
  const firstClapTimeRef = useRef(0);
  const onClapRef = useRef(onClap);
  const enabledRef = useRef(enabled);

  // Keep refs current
  onClapRef.current = onClap;
  enabledRef.current = enabled;

  const stop = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (!enabledRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const monitor = () => {
        if (!enabledRef.current || !analyserRef.current) return;

        analyser.getByteFrequencyData(dataArray);

        // Calculate average amplitude (RMS-like)
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avgAmplitude = sum / dataArray.length / 255; // Normalize to 0-1

        const now = Date.now();

        // Check if amplitude exceeds threshold (clap detected)
        if (avgAmplitude > threshold) {
          // Check cooldown
          if (now - lastClapTimeRef.current > cooldown) {
            if (clapCountRef.current === 0) {
              // First clap
              clapCountRef.current = 1;
              firstClapTimeRef.current = now;
            } else if (now - firstClapTimeRef.current < maxClapInterval) {
              // Second clap within interval → double clap confirmed!
              clapCountRef.current = 0;
              lastClapTimeRef.current = now;
              onClapRef.current();
              // Pause monitoring for the cooldown period to prevent re-triggering
              if (animFrameRef.current) {
                cancelAnimationFrame(animFrameRef.current);
                animFrameRef.current = null;
              }
              setTimeout(() => {
                // Restart monitoring after cooldown
                animFrameRef.current = requestAnimationFrame(monitor);
              }, cooldown);
              return; // exit the current monitoring cycle
            } else {
              // Too slow, reset and start over
              clapCountRef.current = 1;
              firstClapTimeRef.current = now;
            }
          }
        }

        // Reset clap count if interval exceeded
        if (clapCountRef.current === 1 && now - firstClapTimeRef.current > maxClapInterval) {
          clapCountRef.current = 0;
        }

        animFrameRef.current = requestAnimationFrame(monitor);
      };

      animFrameRef.current = requestAnimationFrame(monitor);
    } catch (err) {
      console.error('Clap detection failed to start:', err);
    }
  }, [threshold, maxClapInterval, cooldown]);

  // Start/stop based on enabled state
  useEffect(() => {
    if (enabled) {
      start();
    } else {
      stop();
    }
    return stop;
  }, [enabled, start, stop]);

  return { start, stop };
}
