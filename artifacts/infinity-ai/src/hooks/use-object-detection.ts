import { useRef, useState, useCallback, useEffect } from 'react';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import type { DetectedObject } from '@tensorflow-models/coco-ssd';

export interface DetectionResult {
  class: string;
  score: number;
  bbox: [number, number, number, number]; // [x, y, width, height]
  centerX: number;
  centerY: number;
}

interface UseObjectDetectionOptions {
  enabled?: boolean;
  detectionInterval?: number; // ms between detections (default: 1000)
  minScore?: number; // minimum confidence score (default: 0.5)
}

/**
 * Hook for real-time object detection using TensorFlow.js + COCO-SSD.
 * 100% FREE, runs entirely in the browser, no API key needed.
 * Detects 80 object categories (people, phones, cups, keyboards, etc.)
 */
export function useObjectDetection({
  enabled = true,
  detectionInterval = 1000,
  minScore = 0.5,
}: UseObjectDetectionOptions = {}) {
  const modelRef = useRef<cocoSsd.ObjectDetection | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detections, setDetections] = useState<DetectionResult[]>([]);
  const detectionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Load the model
  useEffect(() => {
    if (!enabled || modelRef.current) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    cocoSsd.load({
      base: 'mobilenet_v2', // Fastest model for mobile/desktop
    }).then((model) => {
      if (cancelled) {
        model.dispose();
        return;
      }
      modelRef.current = model;
      setModelLoaded(true);
      setLoading(false);
    }).catch((err) => {
      if (!cancelled) {
        const msg = err instanceof Error ? err.message : 'Failed to load detection model';
        setError(msg);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Set video element to detect on
  const setVideo = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
  }, []);

  // Run detection
  const detect = useCallback(async (): Promise<DetectionResult[]> => {
    const model = modelRef.current;
    const video = videoRef.current;
    if (!model || !video || !video.videoWidth) return [];

    try {
      const predictions: DetectedObject[] = await model.detect(video);

      return predictions
        .filter((p) => p.score >= minScore)
        .map((p) => ({
          class: p.class,
          score: p.score,
          bbox: p.bbox as [number, number, number, number],
          centerX: p.bbox[0] + p.bbox[2] / 2,
          centerY: p.bbox[1] + p.bbox[3] / 2,
        }));
    } catch {
      return [];
    }
  }, [minScore]);

  // Start/stop periodic detection
  const startDetection = useCallback(() => {
    if (detectionTimerRef.current) return;
    const run = async () => {
      const results = await detect();
      setDetections(results);
    };
    run(); // Run immediately
    detectionTimerRef.current = setInterval(run, detectionInterval);
  }, [detect, detectionInterval]);

  const stopDetection = useCallback(() => {
    if (detectionTimerRef.current) {
      clearInterval(detectionTimerRef.current);
      detectionTimerRef.current = null;
    }
    setDetections([]);
  }, []);

  // Single manual detection
  const detectOnce = useCallback(async (): Promise<DetectionResult[]> => {
    const results = await detect();
    setDetections(results);
    return results;
  }, [detect]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (detectionTimerRef.current) {
        clearInterval(detectionTimerRef.current);
      }
    };
  }, []);

  return {
    modelLoaded,
    loading,
    error,
    detections,
    setVideo,
    startDetection,
    stopDetection,
    detectOnce,
  };
}
