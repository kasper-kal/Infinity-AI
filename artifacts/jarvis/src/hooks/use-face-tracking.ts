import { useRef, useState, useCallback, useEffect } from 'react';
import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from '@mediapipe/tasks-vision';

export interface FaceLandmark {
  x: number;
  y: number;
  z: number;
}

export interface FaceDetection {
  landmarks: FaceLandmark[];
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
  // Key facial features
  leftEye: { x: number; y: number };
  rightEye: { x: number; y: number };
  noseTip: { x: number; y: number };
  mouthCenter: { x: number; y: number };
  leftEar: { x: number; y: number };
  rightEar: { x: number; y: number };
  // Face center (nose bridge)
  faceCenter: { x: number; y: number };
  // Head pose estimation (approximate from landmarks)
  headPose: {
    yaw: number;   // left/right rotation
    pitch: number; // up/down rotation
    roll: number;  // tilt
  };
}

interface UseFaceTrackingOptions {
  enabled?: boolean;
  maxFaces?: number;
  minFaceDetectionConfidence?: number;
  minFacePresenceConfidence?: number;
  minTrackingConfidence?: number;
}

const VISION_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';

/**
 * Hook for real-time face tracking using MediaPipe Tasks Vision.
 * 100% FREE, runs entirely in the browser via WebAssembly.
 * Tracks 478 face landmarks per face, detects bounding box, key features, and estimates head pose.
 */
export function useFaceTracking({
  enabled = true,
  maxFaces = 1,
  minFaceDetectionConfidence = 0.5,
  minFacePresenceConfidence = 0.5,
  minTrackingConfidence = 0.5,
}: UseFaceTrackingOptions = {}) {
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const [faceLandmarkerReady, setFaceLandmarkerReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detections, setDetections] = useState<FaceDetection[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number>(0);

  // Load the face landmarker model
  useEffect(() => {
    if (!enabled || faceLandmarkerRef.current) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const initFaceLandmarker = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(VISION_WASM_URL);
        const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `${VISION_WASM_URL}/face_landmarker.task`,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: maxFaces,
          minFaceDetectionConfidence,
          minFacePresenceConfidence,
          minTrackingConfidence,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: true, // For head pose
        });

        if (cancelled) {
          faceLandmarker.close();
          return;
        }

        faceLandmarkerRef.current = faceLandmarker;
        setFaceLandmarkerReady(true);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Failed to load face tracking model';
          setError(msg);
          setLoading(false);
        }
      }
    };

    initFaceLandmarker();

    return () => {
      cancelled = true;
      if (faceLandmarkerRef.current) {
        faceLandmarkerRef.current.close();
        faceLandmarkerRef.current = null;
      }
      setFaceLandmarkerReady(false);
    };
  }, [enabled, maxFaces, minFaceDetectionConfidence, minFacePresenceConfidence, minTrackingConfidence]);

  // Set video element to track
  const setVideo = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
  }, []);

  // Process a single frame
  const detect = useCallback(async (): Promise<FaceDetection[]> => {
    const faceLandmarker = faceLandmarkerRef.current;
    const video = videoRef.current;

    if (!faceLandmarker || !video || !video.videoWidth) return [];

    try {
      const timestamp = performance.now();
      // MediaPipe needs monotonically increasing timestamps
      lastTimestampRef.current = timestamp;

      const result: FaceLandmarkerResult = faceLandmarker.detectForVideo(video, timestamp);

      if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
        return [];
      }

      return result.faceLandmarks.map((landmarks, i) => {
        // Calculate bounding box from landmarks
        let minX = 1, minY = 1, maxX = 0, maxY = 0;
        for (const lm of landmarks) {
          minX = Math.min(minX, lm.x);
          minY = Math.min(minY, lm.y);
          maxX = Math.max(maxX, lm.x);
          maxY = Math.max(maxY, lm.y);
        }
        const width = maxX - minX;
        const height = maxY - minY;

        // Key facial landmarks (using MediaPipe face landmark indices)
        // Left eye center (approximate from landmarks 33, 133, 159, 145, 153, 154, 155, 173)
        const leftEyeX = (landmarks[33].x + landmarks[133].x) / 2;
        const leftEyeY = (landmarks[33].y + landmarks[133].y) / 2;

        // Right eye center (landmarks 362, 263, 386, 374, 380, 381, 382, 390)
        const rightEyeX = (landmarks[362].x + landmarks[263].x) / 2;
        const rightEyeY = (landmarks[362].y + landmarks[263].y) / 2;

        // Nose tip (landmark 1)
        const noseTip = { x: landmarks[1].x, y: landmarks[1].y };

        // Mouth center (between landmarks 13 and 14)
        const mouthCenterX = (landmarks[13].x + landmarks[14].x) / 2;
        const mouthCenterY = (landmarks[13].y + landmarks[14].y) / 2;

        // Ears (landmarks 234 and 454)
        const leftEar = { x: landmarks[234].x, y: landmarks[234].y };
        const rightEar = { x: landmarks[454].x, y: landmarks[454].y };

        // Face center (nose bridge - landmark 6)
        const faceCenter = { x: landmarks[6].x, y: landmarks[6].y };

        // Head pose estimation from facial transformation matrix (if available)
        // or approximate from eye/nose positions
        let yaw = 0, pitch = 0, roll = 0;
        if (result.facialTransformationMatrixes && result.facialTransformationMatrixes[i]) {
          const matrix = result.facialTransformationMatrixes[i] as unknown as number[];
          // Extract Euler angles from 4x4 transformation matrix
          // Matrix is in column-major order
          yaw = Math.atan2(matrix[8], matrix[10]) * 180 / Math.PI;
          pitch = Math.asin(-matrix[9]) * 180 / Math.PI;
          roll = Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI;
        } else {
          // Approximate from eye positions
          const eyeDx = rightEyeX - leftEyeX;
          const eyeDy = rightEyeY - leftEyeY;
          roll = Math.atan2(eyeDy, eyeDx) * 180 / Math.PI;

          // Approximate yaw from nose position relative to eye center
          const eyeCenterX = (leftEyeX + rightEyeX) / 2;
          const eyeCenterY = (leftEyeY + rightEyeY) / 2;
          const noseDx = noseTip.x - eyeCenterX;
          yaw = (noseDx / (width || 1)) * 90; // approximate

          // Approximate pitch from nose/mouth vertical position
          const noseDy = noseTip.y - eyeCenterY;
          const mouthDy = mouthCenterY - eyeCenterY;
          pitch = ((mouthDy - noseDy) / (height || 1)) * 45; // approximate
        }

        return {
          landmarks: landmarks.map(lm => ({ x: lm.x, y: lm.y, z: lm.z })),
          boundingBox: { x: minX, y: minY, width, height },
          confidence: 1.0, // MediaPipe doesn't return per-face confidence in VIDEO mode
          leftEye: { x: leftEyeX, y: leftEyeY },
          rightEye: { x: rightEyeX, y: rightEyeY },
          noseTip,
          mouthCenter: { x: mouthCenterX, y: mouthCenterY },
          leftEar,
          rightEar,
          faceCenter,
          headPose: { yaw, pitch, roll },
        };
      });
    } catch {
      return [];
    }
  }, []);

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
  const detectOnce = useCallback(async (): Promise<FaceDetection[]> => {
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
    faceLandmarkerReady,
    loading,
    error,
    detections,
    setVideo,
    startDetection,
    stopDetection,
    detectOnce,
  };
}