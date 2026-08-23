import { useRef, useState, useCallback } from 'react';

interface UseScreenShareOptions {
  /** Called when a new frame is available (as base64 JPEG) */
  onFrame?: (base64: string) => void;
  /** Frame capture interval in ms (default: 1000) */
  frameInterval?: number;
}

interface UseScreenShareReturn {
  /** Whether screen share is active */
  sharing: boolean;
  /** Error message if any */
  error: string | null;
  /** The <video> element displaying the screen share (for AI analysis) */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Start screen sharing */
  start: () => Promise<void>;
  /** Stop screen sharing */
  stop: () => void;
  /** Capture a single frame as base64 JPEG */
  captureFrame: () => string | null;
  /** Latest captured frame (updated every frameInterval ms) */
  latestFrame: string | null;
}

/**
 * Hook for screen sharing via getDisplayMedia API.
 * Allows Infinity to see and annotate the user's screen.
 */
export function useScreenShare({
  onFrame,
  frameInterval = 1000,
}: UseScreenShareOptions = {}): UseScreenShareReturn {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latestFrame, setLatestFrame] = useState<string | null>(null);
  const frameRef = useRef<string | null>(null);

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;

    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0);
    const frame = canvas.toDataURL('image/jpeg', 0.7);
    frameRef.current = frame;
    setLatestFrame(frame);
    return frame;
  }, []);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;
      setSharing(true);
      setError(null);

      // Attach stream to video element
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      // Start periodic frame capture
      if (onFrame) {
        frameTimerRef.current = setInterval(() => {
          const frame = captureFrame();
          if (frame) onFrame(frame);
        }, frameInterval);
      }

      // Handle user stopping via the browser's "Stop sharing" button
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stop();
      });
    } catch (err) {
      if ((err as Error).name === 'NotAllowedError') {
        setError('Screen sharing was cancelled');
      } else {
        setError((err as Error).message);
      }
    }
  }, [captureFrame, frameInterval, onFrame]);

  const stop = useCallback(() => {
    if (frameTimerRef.current) {
      clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setSharing(false);
  }, []);

  return { sharing, error, videoRef, start, stop, captureFrame, latestFrame };
}
