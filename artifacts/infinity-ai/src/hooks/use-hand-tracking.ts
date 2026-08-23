import { useRef, useState, useCallback, useEffect } from 'react';
import {
  HandLandmarker,
  FilesetResolver,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';

export interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

export interface HandDetection {
  landmarks: HandLandmark[];
  handedness: 'Left' | 'Right';
  confidence: number;
  // Center of palm (landmark 0 - wrist, or average of key landmarks)
  palmCenter: { x: number; y: number };
  // Index finger tip (landmark 8)
  indexTip: { x: number; y: number };
  // Thumb tip (landmark 4)
  thumbTip: { x: number; y: number };
  // Pinch gesture detection (distance between thumb and index tips)
  pinchDistance: number;
  isPinching: boolean;
}

interface UseHandTrackingOptions {
  enabled?: boolean;
  maxHands?: number;
  minHandDetectionConfidence?: number;
  minHandPresenceConfidence?: number;
  minTrackingConfidence?: number;
  // Pinch threshold (normalized 0-1, distance between thumb and index tips)
  pinchThreshold?: number;
}

const VISION_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';

/**
 * Hook for real-time hand tracking using MediaPipe Tasks Vision.
 * 100% FREE, runs entirely in the browser via WebAssembly.
 * Tracks 21 landmarks per hand, detects handedness, and recognizes pinch gestures.
 */
export function useHandTracking({
  enabled = true,
  maxHands = 2,
  minHandDetectionConfidence = 0.5,
  minHandPresenceConfidence = 0.5,
  minTrackingConfidence = 0.5,
  pinchThreshold = 0.05,
}: UseHandTrackingOptions = {}) {
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const [handLandmarkerReady, setHandLandmarkerReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detections, setDetections] = useState<HandDetection[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number>(0);

  // Load the hand landmarker model
  useEffect(() => {
    if (!enabled || handLandmarkerRef.current) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const initHandLandmarker = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(VISION_WASM_URL);
        const handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `${VISION_WASM_URL}/hand_landmarker.task`,
            delegate: 'GPU', // Use GPU for better performance
          },
          runningMode: 'VIDEO',
          numHands: maxHands,
          minHandDetectionConfidence,
          minHandPresenceConfidence,
          minTrackingConfidence,
        });

        if (cancelled) {
          handLandmarker.close();
          return;
        }

        handLandmarkerRef.current = handLandmarker;
        setHandLandmarkerReady(true);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Failed to load hand tracking model';
          setError(msg);
          setLoading(false);
        }
      }
    };

    initHandLandmarker();

    return () => {
      cancelled = true;
      if (handLandmarkerRef.current) {
        handLandmarkerRef.current.close();
        handLandmarkerRef.current = null;
      }
      setHandLandmarkerReady(false);
    };
  }, [enabled, maxHands, minHandDetectionConfidence, minHandPresenceConfidence, minTrackingConfidence]);

  // Set video element to track
  const setVideo = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
  }, []);

  // Process a single frame
  const detect = useCallback(async (): Promise<HandDetection[]> => {
    const handLandmarker = handLandmarkerRef.current;
    const video = videoRef.current;

    if (!handLandmarker || !video || !video.videoWidth) return [];

    try {
      const timestamp = performance.now();
      // MediaPipe needs monotonically increasing timestamps
      const msSinceLastFrame = timestamp - lastTimestampRef.current;
      lastTimestampRef.current = timestamp;

      const result: HandLandmarkerResult = handLandmarker.detectForVideo(video, timestamp);

      if (!result.landmarks || result.landmarks.length === 0) {
        return [];
      }

      return result.landmarks.map((landmarks, i) => {
        // Calculate palm center (average of wrist and MCP joints)
        const palmX = (landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[13].x + landmarks[17].x) / 5;
        const palmY = (landmarks[0].y + landmarks[5].y + landmarks[9].y + landmarks[13].y + landmarks[17].y) / 5;

        // Index finger tip (landmark 8)
        const indexTip = { x: landmarks[8].x, y: landmarks[8].y };

        // Thumb tip (landmark 4)
        const thumbTip = { x: landmarks[4].x, y: landmarks[4].y };

        // Pinch distance (normalized)
        const pinchDistance = Math.sqrt(
          Math.pow(indexTip.x - thumbTip.x, 2) + Math.pow(indexTip.y - thumbTip.y, 2)
        );
        const isPinching = pinchDistance < pinchThreshold;

        return {
          landmarks: landmarks.map(lm => ({ x: lm.x, y: lm.y, z: lm.z })),
          handedness: result.handedness[i]?.[0]?.categoryName === 'Left' ? 'Left' : 'Right',
          confidence: result.handedness[i]?.[0]?.score ?? 0,
          palmCenter: { x: palmX, y: palmY },
          indexTip,
          thumbTip,
          pinchDistance,
          isPinching,
        };
      });
    } catch {
      return [];
    }
  }, [pinchThreshold]);

  // Start/stop detection loop
  const startDetection = useCallback(() => {
    if (animationFrameRef.current) return;

    const run = async () => {
      const results = await detect();
      setDetections(results);
      animationFrameRef.current = requestAnimationFrame(run);
    };

    lastTimestampRef.current = performance.now();
    run();
  }, [detect]);

  const stopDetection = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setDetections([]);
  }, []);

  // Single manual detection
  const detectOnce = useCallback(async (): Promise<HandDetection[]> => {
    const results = await detect();
    setDetections(results);
    return results;
  }, [detect]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return {
    handLandmarkerReady,
    loading,
    error,
    detections,
    setVideo,
    startDetection,
    stopDetection,
    detectOnce,
  };
}