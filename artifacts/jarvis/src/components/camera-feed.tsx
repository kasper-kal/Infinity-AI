import { useRef, useEffect, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { Camera, RefreshCw, ImagePlus, Hand } from 'lucide-react';
import { useObjectDetection } from '@/hooks/use-object-detection';
import { useHandTracking } from '@/hooks/use-hand-tracking';
import { useFaceTracking } from '@/hooks/use-face-tracking';
import type { DetectionResult } from '@/hooks/use-object-detection';
import type { HandDetection } from '@/hooks/use-hand-tracking';
import type { FaceDetection } from '@/hooks/use-face-tracking';

interface CameraFeedProps {
  /** Css class name for the wrapper */
  className?: string;
  /** Enable object detection (uses TensorFlow.js COCO-SSD, FREE, runs in browser) */
  enableDetection?: boolean;
  /** Enable hand tracking (uses MediaPipe Tasks Vision, FREE, runs in browser) */
  enableHandTracking?: boolean;
  /** Enable face tracking (uses MediaPipe Tasks Vision, FREE, runs in browser) */
  enableFaceTracking?: boolean;
  /** Called when objects are detected */
  onDetections?: (detections: DetectionResult[]) => void;
  /** Called when hands are detected */
  onHandDetections?: (hands: HandDetection[]) => void;
  /** Called when faces are detected */
  onFaceDetections?: (faces: FaceDetection[]) => void;
  /** Called with the current snapshot frame as base64 */
  onSnapshot?: (base64: string) => void;
  /** Which classes to highlight (empty = highlight all) */
  highlightClasses?: string[];
  /** Called when the user taps "Upload a photo instead" in the error state */
  onUploadPhoto?: () => void;
}

/**
 * Live camera feed with optional TensorFlow.js object detection overlay.
 * Detects 80 object categories, completely free, runs in browser.
 *
 * Camera access can fail (permissions, non-secure context, iframe). When it
 * does we show a friendly error card with a Retry button and, when provided,
 * an "upload a photo instead" fallback, never a bare broken box.
 */
export function CameraFeed({
  className = '',
  enableDetection = false,
  enableHandTracking = false,
  enableFaceTracking = false,
  onDetections,
  onHandDetections,
  onFaceDetections,
  onSnapshot,
  highlightClasses = [],
  onUploadPhoto,
}: CameraFeedProps) {
  const webcamRef = useRef<Webcam | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const faceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [streaming, setStreaming] = useState(true);
  const animFrameRef = useRef<number | null>(null);
  const handAnimFrameRef = useRef<number | null>(null);
  const faceAnimFrameRef = useRef<number | null>(null);

  const {
    modelLoaded,
    loading: modelLoading,
    error: modelError,
    detections,
    setVideo,
    startDetection,
    stopDetection,
    detectOnce,
  } = useObjectDetection({
    enabled: enableDetection,
    detectionInterval: 1000,
    minScore: 0.5,
  });

  const {
    handLandmarkerReady,
    loading: handLoading,
    error: handError,
    detections: handDetections,
    setVideo: setHandVideo,
    startDetection: startHandDetection,
    stopDetection: stopHandDetection,
  } = useHandTracking({
    enabled: enableHandTracking,
    maxHands: 2,
    pinchThreshold: 0.05,
  });

  const {
    faceLandmarkerReady,
    loading: faceLoading,
    error: faceError,
    detections: faceDetections,
    setVideo: setFaceVideo,
    startDetection: startFaceDetection,
    stopDetection: stopFaceDetection,
  } = useFaceTracking({
    enabled: enableFaceTracking,
    maxFaces: 1,
  });

  // Connect webcam video to detection models
  useEffect(() => {
    if (cameraReady && enableDetection && webcamRef.current?.video) {
      setVideo(webcamRef.current.video);
      startDetection();
    }
    return () => {
      stopDetection();
    };
  }, [cameraReady, enableDetection, setVideo, startDetection, stopDetection]);

  useEffect(() => {
    if (cameraReady && enableHandTracking && webcamRef.current?.video) {
      setHandVideo(webcamRef.current.video);
      startHandDetection();
    }
    return () => {
      stopHandDetection();
    };
  }, [cameraReady, enableHandTracking, setHandVideo, startHandDetection, stopHandDetection]);

  useEffect(() => {
    if (cameraReady && enableFaceTracking && webcamRef.current?.video) {
      setFaceVideo(webcamRef.current.video);
      startFaceDetection();
    }
    return () => {
      stopFaceDetection();
    };
  }, [cameraReady, enableFaceTracking, setFaceVideo, startFaceDetection, stopFaceDetection]);

  // Notify parent of detections
  useEffect(() => {
    if (detections.length > 0 && onDetections) {
      onDetections(detections);
    }
  }, [detections, onDetections]);

  useEffect(() => {
    if (handDetections.length > 0 && onHandDetections) {
      onHandDetections(handDetections);
    }
  }, [handDetections, onHandDetections]);

  useEffect(() => {
    if (faceDetections.length > 0 && onFaceDetections) {
      onFaceDetections(faceDetections);
    }
  }, [faceDetections, onFaceDetections]);

  // Draw detection overlay on canvas
  const drawOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    const video = webcamRef.current?.video;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const animate = () => {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const toHighlight = highlightClasses.length > 0
        ? detections.filter((d) => highlightClasses.includes(d.class))
        : detections;

      for (const det of toHighlight) {
        const [x, y, w, h] = det.bbox;

        // Draw bounding box
        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 3;
        ctx.shadowColor = '#00ff88';
        ctx.shadowBlur = 10;
        ctx.strokeRect(x, y, w, h);
        ctx.shadowBlur = 0;

        // Draw label background
        const label = `${det.class} ${Math.round(det.score * 100)}%`;
        ctx.fillStyle = '#00ff88';
        ctx.font = 'bold 14px "Space Mono", monospace';
        const textWidth = ctx.measureText(label).width;
        ctx.fillRect(x, y - 22, textWidth + 10, 22);

        // Draw label text
        ctx.fillStyle = '#000';
        ctx.fillText(label, x + 5, y - 6);
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animate();
  }, [detections, highlightClasses]);

  // Draw hand tracking overlay on canvas
  const drawHandOverlay = useCallback(() => {
    const canvas = handCanvasRef.current;
    const video = webcamRef.current?.video;
    if (!canvas || !video || handDetections.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const animate = () => {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const hand of handDetections) {
        const landmarks = hand.landmarks;

        // Draw connections (hand skeleton)
        const connections = [
          // Thumb
          [0, 1], [1, 2], [2, 3], [3, 4],
          // Index
          [0, 5], [5, 6], [6, 7], [7, 8],
          // Middle
          [9, 10], [10, 11], [11, 12],
          // Ring
          [13, 14], [14, 15], [15, 16],
          // Pinky
          [17, 18], [18, 19], [19, 20],
          // Palm
          [5, 9], [9, 13], [13, 17], [0, 17]
        ];

        // Draw connections
        ctx.strokeStyle = hand.handedness === 'Left' ? '#00ff88' : '#ff6b6b';
        ctx.lineWidth = 2;
        ctx.shadowColor = hand.handedness === 'Left' ? '#00ff88' : '#ff6b6b';
        ctx.shadowBlur = 8;

        for (const [i, j] of connections) {
          const p1 = landmarks[i];
          const p2 = landmarks[j];
          ctx.beginPath();
          ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
          ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;

        // Draw landmarks
        ctx.fillStyle = hand.handedness === 'Left' ? '#00ff88' : '#ff6b6b';
        for (const lm of landmarks) {
          ctx.beginPath();
          ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 4, 0, 2 * Math.PI);
          ctx.fill();
        }

        // Highlight pinch points (thumb tip and index tip)
        const indexTip = hand.indexTip;
        const thumbTip = hand.thumbTip;

        ctx.fillStyle = hand.isPinching ? '#ffd700' : (hand.handedness === 'Left' ? '#00ff88' : '#ff6b6b');
        ctx.beginPath();
        ctx.arc(indexTip.x * canvas.width, indexTip.y * canvas.height, 8, 0, 2 * Math.PI);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(thumbTip.x * canvas.width, thumbTip.y * canvas.height, 8, 0, 2 * Math.PI);
        ctx.fill();

        // Draw pinch line when pinching
        if (hand.isPinching) {
          ctx.strokeStyle = '#ffd700';
          ctx.lineWidth = 3;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(indexTip.x * canvas.width, indexTip.y * canvas.height);
          ctx.lineTo(thumbTip.x * canvas.width, thumbTip.y * canvas.height);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Draw handedness label near wrist
        const wrist = landmarks[0];
        ctx.fillStyle = hand.handedness === 'Left' ? '#00ff88' : '#ff6b6b';
        ctx.font = 'bold 16px "Space Mono", monospace';
        ctx.fillText(
          `${hand.handedness} Hand ${hand.isPinching ? '🤏' : ''}`,
          wrist.x * canvas.width + 10,
          wrist.y * canvas.height - 10
        );
      }

      requestAnimationFrame(animate);
    };

    animate();
  }, [handDetections]);

  // Draw face tracking overlay on canvas
  const drawFaceOverlay = useCallback(() => {
    const canvas = faceCanvasRef.current;
    const video = webcamRef.current?.video;
    if (!canvas || !video || faceDetections.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const animate = () => {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const face of faceDetections) {
        const landmarks = face.landmarks;
        const bbox = face.boundingBox;

        // Draw face mesh connections (simplified - key facial features)
        const connections = [
          // Face oval
          [10, 338], [338, 297], [297, 332], [332, 284], [284, 251], [251, 389], [389, 356], [356, 454],
          [454, 323], [323, 361], [361, 288], [288, 397], [397, 365], [365, 379], [379, 378], [378, 400],
          [400, 377], [377, 152], [152, 148], [148, 176], [176, 149], [149, 150], [150, 136], [136, 172],
          [172, 58], [58, 132], [132, 93], [93, 234], [234, 127], [127, 162], [162, 21], [21, 54],
          [54, 103], [103, 67], [67, 109], [109, 10],

          // Left eye
          [33, 160], [160, 159], [159, 158], [158, 157], [157, 173], [173, 133],
          [133, 155], [155, 154], [154, 153], [153, 145], [145, 144], [144, 163], [163, 7], [7, 33],

          // Right eye
          [362, 398], [398, 384], [384, 385], [385, 386], [386, 387], [387, 388],
          [388, 466], [466, 263], [263, 249], [249, 390], [390, 373], [373, 374], [374, 380], [380, 381],
          [381, 382], [382, 362],

          // Nose
          [1, 2], [2, 98], [98, 327], [327, 326], [326, 2], [98, 326], [2, 4], [4, 5], [5, 4],
          [19, 94], [94, 125], [125, 220], [220, 2], [2, 1],

          // Mouth
          [61, 146], [146, 91], [91, 181], [181, 84], [84, 17], [17, 314], [314, 405], [405, 321],
          [321, 375], [375, 291], [291, 61], [78, 95], [95, 88], [88, 178], [178, 87], [87, 14],
          [14, 317], [317, 402], [402, 318], [318, 324], [324, 308], [308, 78],
        ];

        // Draw face mesh
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 1;
        ctx.shadowColor = '#00ffff';
        ctx.shadowBlur = 4;

        for (const [i, j] of connections) {
          if (landmarks[i] && landmarks[j]) {
            const p1 = landmarks[i];
            const p2 = landmarks[j];
            ctx.beginPath();
            ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
            ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
            ctx.stroke();
          }
        }
        ctx.shadowBlur = 0;

        // Draw bounding box
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(
          bbox.x * canvas.width,
          bbox.y * canvas.height,
          bbox.width * canvas.width,
          bbox.height * canvas.height
        );
        ctx.setLineDash([]);

        // Draw key feature points
        const features = [
          { point: face.leftEye, color: '#ff6b6b', label: 'L' },
          { point: face.rightEye, color: '#ff6b6b', label: 'R' },
          { point: face.noseTip, color: '#ffd700', label: 'N' },
          { point: face.mouthCenter, color: '#00ff88', label: 'M' },
          { point: face.leftEar, color: '#00ffff', label: '' },
          { point: face.rightEar, color: '#00ffff', label: '' },
          { point: face.faceCenter, color: '#ffffff', label: '●' },
        ];

        for (const f of features) {
          ctx.fillStyle = f.color;
          ctx.beginPath();
          ctx.arc(f.point.x * canvas.width, f.point.y * canvas.height, 5, 0, 2 * Math.PI);
          ctx.fill();

          if (f.label) {
            ctx.fillStyle = f.color;
            ctx.font = 'bold 12px "Space Mono", monospace';
            ctx.fillText(f.label, f.point.x * canvas.width + 8, f.point.y * canvas.height - 8);
          }
        }

        // Draw head pose indicator (line from nose showing yaw direction)
        const noseX = face.noseTip.x * canvas.width;
        const noseY = face.noseTip.y * canvas.height;
        const poseLength = 50;
        const poseX = noseX + Math.sin(face.headPose.yaw * Math.PI / 180) * poseLength;
        const poseY = noseY - Math.sin(face.headPose.pitch * Math.PI / 180) * poseLength;

        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(noseX, noseY);
        ctx.lineTo(poseX, poseY);
        ctx.stroke();

        // Draw head pose text
        ctx.fillStyle = '#ffd700';
        ctx.font = 'bold 12px "Space Mono", monospace';
        ctx.fillText(
          `Yaw: ${face.headPose.yaw.toFixed(0)}° Pitch: ${face.headPose.pitch.toFixed(0)}° Roll: ${face.headPose.roll.toFixed(0)}°`,
          bbox.x * canvas.width,
          bbox.y * canvas.height - 10
        );
      }

      requestAnimationFrame(animate);
    };

    animate();
  }, [faceDetections]);

  // Start/stop overlay animations
  useEffect(() => {
    if (enableDetection && cameraReady) {
      drawOverlay();
    }
    if (enableHandTracking && cameraReady) {
      drawHandOverlay();
    }
    if (enableFaceTracking && cameraReady) {
      drawFaceOverlay();
    }
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      if (handAnimFrameRef.current) {
        cancelAnimationFrame(handAnimFrameRef.current);
        handAnimFrameRef.current = null;
      }
      if (faceAnimFrameRef.current) {
        cancelAnimationFrame(faceAnimFrameRef.current);
        faceAnimFrameRef.current = null;
      }
    };
  }, [enableDetection, enableHandTracking, enableFaceTracking, cameraReady, drawOverlay, drawHandOverlay, drawFaceOverlay]);

  const handleUserMedia = useCallback(() => {
    setCameraError(null);
    setCameraReady(true);
  }, []);

  const handleUserMediaError = useCallback(() => {
    setCameraReady(false);
    setCameraError(
      'Camera unavailable. Your browser needs permission to use the camera (and the page must be served over HTTPS).',
    );
  }, []);

  const retry = useCallback(() => {
    setCameraError(null);
    setCameraReady(false);
    setRetryKey(k => k + 1);
  }, []);

  const captureSnapshot = useCallback(() => {
    const screenshot = webcamRef.current?.getScreenshot();
    if (screenshot && onSnapshot) {
      onSnapshot(screenshot);
    }
  }, [onSnapshot]);

  const toggleCamera = useCallback(() => {
    setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'));
  }, []);

  // Friendly error state, Retry + optional upload-photo fallback
  if (cameraError) {
    return (
      <div className={`flex flex-col items-center justify-center gap-3 bg-muted/20 rounded-lg border border-border/50 p-6 text-center ${className}`}>
        <div className="w-10 h-10 rounded-full bg-secondary/60 flex items-center justify-center flex-shrink-0">
          <Camera className="w-[18px] h-[18px] text-muted-foreground" />
        </div>
        <p className="text-sm text-foreground/80 font-medium">Camera unavailable</p>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-[260px]">
          Allow camera access in your browser, or upload a photo instead and Jarvis will run detection on it.
        </p>
        <div className="flex gap-2 flex-wrap justify-center">
          <button
            onClick={retry}
            className="px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold hover:opacity-90 active:scale-95 transition-all flex items-center gap-1.5"
          >
            <RefreshCw className="w-3 h-3" />
            Try again
          </button>
          {onUploadPhoto && (
            <button
              onClick={onUploadPhoto}
              className="px-3 py-1.5 rounded-full border border-border/60 text-[11px] font-medium text-foreground/80 hover:bg-secondary/60 active:scale-95 transition-all flex items-center gap-1.5"
            >
              <ImagePlus className="w-3 h-3" />
              Upload a photo
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-lg border border-border/50 bg-black ${className}`}>
      {/* Camera feed, keyed so a retry fully remounts the webcam element */}
      <Webcam
        key={retryKey}
        ref={webcamRef}
        audio={false}
        videoConstraints={{
          facingMode,
          width: { ideal: 640 },
          height: { ideal: 480 },
        }}
        onUserMedia={handleUserMedia}
        onUserMediaError={handleUserMediaError}
        className="w-full h-full object-cover"
        mirrored={facingMode === 'user'}
      />

      {/* Detection overlay canvas */}
      {enableDetection && cameraReady && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />
      )}

      {/* Hand tracking overlay canvas */}
      {enableHandTracking && cameraReady && (
        <canvas
          ref={handCanvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />
      )}

      {/* Face tracking overlay canvas */}
      {enableFaceTracking && cameraReady && (
        <canvas
          ref={faceCanvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />
      )}

      {/* Model loading indicator */}
      {enableDetection && modelLoading && (
        <div className="absolute top-2 left-2 px-2 py-1 bg-background/80 backdrop-blur rounded text-[11px] font-mono text-primary">
          Loading vision model…
        </div>
      )}

      {/* Model loaded indicator */}
      {enableDetection && modelLoaded && (
        <div className="absolute top-2 left-2 px-2 py-1 bg-background/80 backdrop-blur rounded text-[11px] font-mono text-green-400">
          Vision active
        </div>
      )}

      {/* Model error, non-blocking: the camera still works, detection is just off */}
      {enableDetection && modelError && !modelLoading && (
        <div className="absolute top-2 left-2 px-2 py-1 bg-background/80 backdrop-blur rounded text-[10px] font-mono text-amber-400">
          Detection unavailable, camera still works
        </div>
      )}

      {/* Hand tracking loading indicator */}
      {enableHandTracking && handLoading && (
        <div className="absolute top-2 left-2 px-2 py-1 bg-background/80 backdrop-blur rounded text-[11px] font-mono text-primary">
          Loading hand model…
        </div>
      )}

      {/* Hand tracking loaded indicator */}
      {enableHandTracking && handLandmarkerReady && !handLoading && (
        <div className="absolute top-2 left-2 px-2 py-1 bg-background/80 backdrop-blur rounded text-[11px] font-mono text-green-400">
          Hand tracking active
        </div>
      )}

      {/* Hand tracking error */}
      {enableHandTracking && handError && !handLoading && (
        <div className="absolute top-2 left-2 px-2 py-1 bg-background/80 backdrop-blur rounded text-[10px] font-mono text-amber-400">
          Hand tracking unavailable
        </div>
      )}

      {/* Face tracking loading indicator */}
      {enableFaceTracking && faceLoading && (
        <div className="absolute top-2 left-2 px-2 py-1 bg-background/80 backdrop-blur rounded text-[11px] font-mono text-primary">
          Loading face model…
        </div>
      )}

      {/* Face tracking loaded indicator */}
      {enableFaceTracking && faceLandmarkerReady && !faceLoading && (
        <div className="absolute top-2 left-2 px-2 py-1 bg-background/80 backdrop-blur rounded text-[11px] font-mono text-green-400">
          Face tracking active
        </div>
      )}

      {/* Face tracking error */}
      {enableFaceTracking && faceError && !faceLoading && (
        <div className="absolute top-2 left-2 px-2 py-1 bg-background/80 backdrop-blur rounded text-[10px] font-mono text-amber-400">
          Face tracking unavailable
        </div>
      )}

      {/* Controls overlay */}
      <div className="absolute bottom-2 right-2 flex flex-col gap-1.5 items-end">
        {streaming && (
          <>
            <button
              onClick={toggleCamera}
              className="w-7 h-7 flex items-center justify-center rounded-full bg-background/60 backdrop-blur border border-border/30 hover:bg-background/80 transition-colors"
              title="Flip camera"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            {onSnapshot && (
              <button
                onClick={captureSnapshot}
                className="w-7 h-7 flex items-center justify-center rounded-full bg-background/60 backdrop-blur border border-border/30 hover:bg-background/80 transition-colors"
                title="Capture snapshot"
              >
                <Camera className="w-3.5 h-3.5" />
              </button>
            )}
            {enableHandTracking && (
              <div className="w-7 h-7 flex items-center justify-center rounded-full bg-background/60 backdrop-blur border border-border/30 text-green-400">
                <Hand className="w-3.5 h-3.5" />
              </div>
            )}
            {enableFaceTracking && (
              <div className="w-7 h-7 flex items-center justify-center rounded-full bg-background/60 backdrop-blur border border-border/30 text-cyan-400">
                <span className="text-[10px] font-mono">👁</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
