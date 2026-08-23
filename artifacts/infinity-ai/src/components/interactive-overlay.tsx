import { useRef, useCallback, useEffect, useState } from 'react';
import type { DetectionResult } from '@/hooks/use-object-detection';

interface HighlightState {
  class: string;
  centerX: number;
  centerY: number;
  radius: number;
  color: string;
  opacity: number;
}

interface InteractiveOverlayProps {
  /** CSS class name */
  className?: string;
  /** Current detections from object detection */
  detections: DetectionResult[];
  /** Width of the overlay in px */
  width: number;
  /** Height of the overlay in px */
  height: number;
  /** Voice command to control highlighting */
  voiceCommand?: string | null;
  /** Fired when a voice command is understood */
  onCommandFeedback?: (msg: string) => void;
}

const HIGHLIGHT_COLORS = [
  '#00ff88', '#ff6600', '#ff3388', '#ffcc00',
  '#33ccff', '#aa66ff', '#ff4444', '#44ff44',
];

/**
 * Canvas overlay for interactive live mode.
 * Draws animated circles around detected objects.
 * Supports voice-controlled highlighting.
 */
export function InteractiveOverlay({
  className = '',
  detections,
  width,
  height,
  voiceCommand,
  onCommandFeedback,
}: InteractiveOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const [highlights, setHighlights] = useState<HighlightState[]>([]);
  const highlightsRef = useRef<HighlightState[]>([]);
  const colorIndexRef = useRef(0);
  const nextColorRef = useRef(0);

  // Process voice commands
  useEffect(() => {
    if (!voiceCommand) return;
    const cmd = voiceCommand.toLowerCase().trim();

    // "highlight [object]" or "circle [object]"
    const highlightMatch = cmd.match(/^(highlight|circle|find|show)\s+(.+)/i);
    if (highlightMatch) {
      const target = highlightMatch[2].trim();
      const matched = detections.filter(
        (d) => d.class.toLowerCase().includes(target) || target.includes(d.class.toLowerCase())
      );

      if (matched.length === 0) {
        onCommandFeedback?.(`Could not find "${target}" in view`);
        return;
      }

      const newHighlights: HighlightState[] = matched.map((m) => ({
        class: m.class,
        centerX: m.centerX,
        centerY: m.centerY,
        radius: Math.max(m.bbox[2], m.bbox[3]) / 2 + 15,
        color: HIGHLIGHT_COLORS[nextColorRef.current++ % HIGHLIGHT_COLORS.length],
        opacity: 0.9,
      }));

      highlightsRef.current = [...highlightsRef.current, ...newHighlights];
      setHighlights(highlightsRef.current);
      onCommandFeedback?.(`Highlighting ${matched.length} ${target}${matched.length > 1 ? 's' : ''}`);
      return;
    }

    // "bigger" / "increase" / "larger"
    if (/^(bigger|larger|increase|grow)\b/.test(cmd)) {
      highlightsRef.current = highlightsRef.current.map((h) => ({
        ...h,
        radius: h.radius * 1.3,
      }));
      onCommandFeedback?.('Highlights enlarged');
      return;
    }

    // "smaller" / "shrink" / "decrease"
    if (/^(smaller|shrink|decrease|reduce)\b/.test(cmd)) {
      highlightsRef.current = highlightsRef.current.map((h) => ({
        ...h,
        radius: Math.max(10, h.radius * 0.7),
      }));
      onCommandFeedback?.('Highlights shrunk');
      return;
    }

    // "clear" / "reset"
    if (/^(clear|reset|remove all|clean)\b/.test(cmd)) {
      highlightsRef.current = [];
      setHighlights([]);
      onCommandFeedback?.('Highlights cleared');
      return;
    }
  }, [voiceCommand, detections, onCommandFeedback]);

  // Animate the overlay
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.clearRect(0, 0, width, height);

    const time = Date.now() / 1000;

    for (const highlight of highlightsRef.current) {
      const pulse = Math.sin(time * 2.5) * 0.2 + 0.8;

      // Outer glow ring
      ctx.beginPath();
      ctx.arc(highlight.centerX, highlight.centerY, highlight.radius * pulse, 0, Math.PI * 2);
      ctx.strokeStyle = highlight.color;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = highlight.color;
      ctx.shadowBlur = 20;
      ctx.stroke();

      // Inner ring (pulsing)
      ctx.beginPath();
      ctx.arc(highlight.centerX, highlight.centerY, highlight.radius * 0.6 * pulse, 0, Math.PI * 2);
      ctx.strokeStyle = highlight.color + '55';
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 10;
      ctx.stroke();

      // Center dot
      ctx.beginPath();
      ctx.arc(highlight.centerX, highlight.centerY, 3, 0, Math.PI * 2);
      ctx.fillStyle = highlight.color;
      ctx.shadowBlur = 0;
      ctx.fill();

      // Label
      ctx.fillStyle = highlight.color;
      ctx.font = 'bold 13px "Space Mono", monospace';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 4;
      ctx.fillText(highlight.class, highlight.centerX + highlight.radius + 8, highlight.centerY + 4);
      ctx.shadowBlur = 0;
    }

    animFrameRef.current = requestAnimationFrame(drawFrame);
  }, [width, height]);

  // Start/stop animation loop
  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(drawFrame);
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [drawFrame]);

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{ width, height }}
    />
  );
}
