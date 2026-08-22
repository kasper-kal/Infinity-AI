import { useCallback, useRef, useEffect, useState } from 'react';
import { Monitor, MonitorStop, Pencil, Trash2 } from 'lucide-react';
import { useScreenShare } from '@/hooks/use-screen-share';

interface Annotation {
  id: number;
  x: number;
  y: number;
  text: string;
}

interface ScreenShareProps {
  /** CSS class name */
  className?: string;
  /** Called when a new screen frame is captured */
  onFrame?: (base64: string) => void;
  /** Voice command text to interpret */
  voiceCommand?: string | null;
}

/**
 * Screen sharing component.
 * Allows the user to share their screen, and Infinity to see and annotate it.
 */
export function ScreenShare({ className = '', onFrame, voiceCommand }: ScreenShareProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const nextIdRef = useRef(0);

  const { sharing, error, videoRef, start, stop, captureFrame } = useScreenShare({
    onFrame,
    frameInterval: 1000,
  });

  // Process voice commands for annotation
  useEffect(() => {
    if (!voiceCommand) return;
    const cmd = voiceCommand.toLowerCase().trim();

    // "highlight [x,y],[text]" or "annotate [x,y],[text]"
    const annotateMatch = cmd.match(/^(annotate|highlight|mark|label)\s+(.+),\s*(.+)/i);
    if (annotateMatch) {
      const area = annotateMatch[2].trim();
      const label = annotateMatch[3].trim();

      // Try to center the annotation in the middle of the screen
      if (videoRef.current) {
        const w = videoRef.current.videoWidth || 1920;
        const h = videoRef.current.videoHeight || 1080;
        const newAnnotation: Annotation = {
          id: nextIdRef.current++,
          x: w / 2,
          y: h / 2,
          text: label,
        };
        setAnnotations((prev) => [...prev, newAnnotation]);
      }
    }

    // "clear" / "remove all"
    if (/^(clear|remove all|erase)/i.test(cmd)) {
      setAnnotations([]);
    }
  }, [voiceCommand, videoRef]);

  // Draw annotations on canvas overlay
  const drawAnnotations = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const ann of annotations) {
      // Draw highlight circle
      ctx.beginPath();
      ctx.arc(ann.x, ann.y, 30, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 255, 136, 0.15)';
      ctx.fill();
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#00ff88';
      ctx.shadowBlur = 15;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Draw label
      ctx.fillStyle = '#00ff88';
      ctx.font = 'bold 14px "Space Mono", monospace';
      const textWidth = ctx.measureText(ann.text).width;
      ctx.fillRect(ann.x + 28, ann.y - 10, textWidth + 10, 22);
      ctx.fillStyle = '#000';
      ctx.fillText(ann.text, ann.x + 33, ann.y + 6);
    }
  }, [annotations, videoRef]);

  // Redraw on annotation change
  useEffect(() => {
    drawAnnotations();
  }, [annotations, drawAnnotations]);

  return (
    <div className={`relative overflow-hidden rounded-lg border border-border/50 bg-black ${className}`}>
      {/* Hidden video element for screen capture */}
      <video
        ref={videoRef}
        className="hidden"
        playsInline
        muted
      />

      {/* Screen share display */}
      {sharing ? (
        <div className="relative">
          <div
            className="bg-muted/20 aspect-video flex items-center justify-center text-muted-foreground font-mono text-xs"
            style={{ minHeight: 200 }}
          >
            Screen sharing active, use browser UI to stop
          </div>

          {/* Annotation canvas overlay */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
          />

          {/* Controls */}
          <div className="absolute bottom-2 right-2 flex gap-1.5">
            <button
              onClick={stop}
              className="px-2 py-1 text-[11px] font-mono flex items-center gap-1 rounded bg-destructive/80 hover:bg-destructive text-destructive-foreground transition-colors"
            >
              <MonitorStop className="w-3 h-3" />
              Stop Sharing
            </button>
          </div>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center p-6 gap-2 bg-muted/20">
          <Monitor className="w-8 h-8 text-muted-foreground/60" />
          <p className="text-xs font-mono text-muted-foreground">{error}</p>
          <button
            onClick={start}
            className="mt-2 px-3 py-1.5 text-xs font-mono rounded bg-primary/80 hover:bg-primary text-primary-foreground transition-colors"
          >
            Try Again
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center p-6 gap-2 bg-muted/20">
          <Monitor className="w-8 h-8 text-muted-foreground/60" />
          <p className="text-xs font-mono text-muted-foreground">Share your screen with Infinity</p>
          <p className="text-[10px] font-mono text-muted-foreground/50 text-center max-w-[200px]">
            Infinity can see what's on your screen and help you with it
          </p>
          <button
            onClick={start}
            className="mt-2 px-4 py-2 text-xs font-mono rounded-lg bg-primary hover:bg-primary/80 text-primary-foreground transition-colors flex items-center gap-1.5"
          >
            <Monitor className="w-3.5 h-3.5" />
            Share Screen
          </button>
        </div>
      )}
    </div>
  );
}
