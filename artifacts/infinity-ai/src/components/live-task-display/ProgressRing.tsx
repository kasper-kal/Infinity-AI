/**
 * Phase 35: Live Task Display — Progress Ring
 *
 * Circular progress indicator for the collapsed Live Task Display state.
 * Shows the primary task's progress with animated ring.
 */

import { useEffect, useRef } from "react";

interface ProgressRingProps {
  /** Progress value from 0 to 100 */
  progress: number;
  /** Ring size in pixels */
  size?: number;
  /** Stroke width in pixels */
  strokeWidth?: number;
  /** Color of the progress ring */
  color?: string;
  /** Background ring color */
  backgroundColor?: string;
  /** Whether to animate the progress change */
  animated?: boolean;
  /** Accessibility label */
  ariaLabel?: string;
}

export function ProgressRing({
  progress,
  size = 32,
  strokeWidth = 3,
  color = "var(--color-accent, #0066ff)",
  backgroundColor = "var(--color-border, #e0e0e0)",
  animated = true,
  ariaLabel = "Task progress",
}: ProgressRingProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const circleRef = useRef<SVGCircleElement>(null);
  const prevProgressRef = useRef(progress);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  useEffect(() => {
    if (!animated || !circleRef.current) return;

    const circle = circleRef.current;
    const startOffset = circumference - (prevProgressRef.current / 100) * circumference;
    const endOffset = offset;

    // Animate using CSS transition
    circle.style.transition = "stroke-dashoffset 0.5s ease-out";
    circle.style.strokeDashoffset = `${endOffset}`;

    prevProgressRef.current = progress;
  }, [progress, offset, circumference, animated]);

  // Initialize on mount
  useEffect(() => {
    if (circleRef.current) {
      circleRef.current.style.strokeDasharray = `${circumference}`;
      circleRef.current.style.strokeDashoffset = `${offset}`;
      prevProgressRef.current = progress;
    }
  }, []);

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={ariaLabel}
      style={{ transform: "rotate(-90deg)" }} // Start from top
    >
      {/* Background ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={backgroundColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      {/* Progress ring */}
      <circle
        ref={circleRef}
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: animated ? "stroke-dashoffset 0.5s ease-out" : "none" }}
      />
      {/* Center progress text */}
      <text
        x={size / 2}
        y={size / 2 + 4}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={size * 0.3}
        fontWeight="600"
        fill="var(--color-text, #1a1a1a)"
        style={{ pointerEvents: "none" }}
      >
        {Math.round(progress)}%
      </text>
    </svg>
  );
}