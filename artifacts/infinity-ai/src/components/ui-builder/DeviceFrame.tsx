/**
 * DeviceFrame Component
 *
 * Official device frames for the Build Preview tab.
 * - iPhone 16 Pro: real titanium frame, thin bezels, centered Dynamic Island, side buttons
 * - Desktop: clean browser window frame
 *
 * The iframe is rendered by the parent (forwardRef) so the existing inspect /
 * console / presence postMessage bridge keeps working.
 */

import React, { forwardRef, useCallback } from 'react';
import { cn } from '@/lib/utils';

export type DeviceKind = 'iphone-16-pro' | 'desktop' | 'bare';

export interface DeviceFrameProps {
  kind: DeviceKind;
  /** Screen content width in CSS px (before scale) */
  width: number;
  /** Screen content height in CSS px (before scale) */
  height: number;
  /** Uniform scale applied to the whole device (default 1) */
  scale?: number;
  /** iframe srcDoc (generated preview HTML) */
  srcDoc?: string;
  /** iframe src (live URL) */
  src?: string;
  /** Show the Dynamic Island / notch chrome (default true for iphone-16-pro) */
  showChrome?: boolean;
  className?: string;
}

/* ── iPhone 16 Pro official geometry ───────────────────────────────
 * Display: 6.3" Super Retina XDR, 1206 × 2622 @ 3×  →  402 × 874 CSS px
 * Titanium band ~13px, black bezel ~10px, screen corner r=40px
 * Dynamic Island: 122 × 36, r=18, 11px from top, horizontally centered
 */
const IPHONE = {
  bezel: 10,
  band: 13,
  screenRadius: 40,
  outerRadius: 66,
  islandW: 122,
  islandH: 36,
  islandTop: 11,
  islandRadius: 18,
};

function IPhone16ProFrame({
  width,
  height,
  scale = 1,
  srcDoc,
  src,
  showChrome = true,
  className,
}: DeviceFrameProps) {
  const outerW = width + (IPHONE.bezel + IPHONE.band) * 2;
  const outerH = height + (IPHONE.bezel + IPHONE.band) * 2;

  const titanium = {
    background:
      'linear-gradient(135deg,#b8b3ad 0%,#d9d4cd 18%,#8f8a84 38%,#cfcac3 55%,#9a958f 72%,#e2ddd6 88%,#a8a39d 100%)',
    boxShadow:
      '0 1px 1px rgba(255,255,255,0.55) inset, 0 -1px 2px rgba(0,0,0,0.25) inset, 0 24px 60px -18px rgba(0,0,0,0.55), 0 6px 18px -6px rgba(0,0,0,0.4)',
  } as React.CSSProperties;

  return (
    <div
      className={cn('relative shrink-0', className)}
      style={{
        width: outerW * scale,
        height: outerH * scale,
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
      }}
    >
      {/* Titanium band */}
      <div
        className="absolute inset-0"
        style={{
          ...titanium,
          borderRadius: IPHONE.outerRadius,
        }}
      />
      {/* matte inner edge */}
      <div
        className="absolute"
        style={{
          inset: 2,
          borderRadius: IPHONE.outerRadius - 2,
          background:
            'linear-gradient(135deg,#6f6a64,#cbc6bf 50%,#7c776f)',
          opacity: 0.35,
        }}
      />
      {/* Black bezel */}
      <div
        className="absolute bg-black"
        style={{
          inset: IPHONE.band,
          borderRadius: IPHONE.outerRadius - IPHONE.band,
        }}
      />
      {/* Screen */}
      <div
        className="absolute overflow-hidden bg-white"
        style={{
          inset: IPHONE.band + IPHONE.bezel,
          borderRadius: IPHONE.screenRadius,
        }}
      >
        <DeviceFrameIframe
          width={width}
          height={height}
          srcDoc={srcDoc}
          src={src}
        />
        {/* Dynamic Island */}
        {showChrome && (
          <div
            className="absolute left-1/2 -translate-x-1/2 bg-black z-20 pointer-events-none"
            style={{
              top: IPHONE.islandTop,
              width: IPHONE.islandW,
              height: IPHONE.islandH,
              borderRadius: IPHONE.islandRadius,
            }}
          />
        )}
      </div>

      {/* Side buttons */}
      {/* Action button + volume (left) */}
      <div
        className="absolute bg-[#9b968f] rounded-sm"
        style={{ left: -2, top: height * 0.16, width: 3, height: 26 }}
      />
      <div
        className="absolute bg-[#9b968f] rounded-sm"
        style={{ left: -2, top: height * 0.22, width: 3, height: 44 }}
      />
      <div
        className="absolute bg-[#9b968f] rounded-sm"
        style={{ left: -2, top: height * 0.30, width: 3, height: 44 }}
      />
      {/* Power button (right) */}
      <div
        className="absolute bg-[#9b968f] rounded-sm"
        style={{ right: -2, top: height * 0.24, width: 3, height: 64 }}
      />
    </div>
  );
}

function DesktopFrame({
  width,
  height,
  scale = 1,
  srcDoc,
  src,
  className,
}: DeviceFrameProps) {
  const outerW = width + 2;
  const outerH = height + 38;
  return (
    <div
      className={cn('relative shrink-0', className)}
      style={{
        width: outerW * scale,
        height: outerH * scale,
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
      }}
    >
      <div
        className="absolute inset-0 overflow-hidden bg-[#1c1c1e]"
        style={{ borderRadius: 12, boxShadow: '0 24px 60px -18px rgba(0,0,0,0.5)' }}
      >
        {/* Title bar */}
        <div
          className="absolute top-0 left-0 right-0 h-[38px] flex items-center gap-2 px-3 bg-[#2a2a2c] border-b border-black/40"
          style={{ borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
        >
          <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <span className="w-3 h-3 rounded-full bg-[#28c840]" />
          <span className="ml-3 text-[11px] text-white/50 font-mono truncate">
            localhost preview
          </span>
        </div>
        <div
          className="absolute left-0 right-0 bg-white dark:bg-[#0b0b0d]"
          style={{ top: 38, bottom: 0 }}
        >
          <DeviceFrameIframe width={width} height={height} srcDoc={srcDoc} src={src} />
        </div>
      </div>
    </div>
  );
}

function DeviceFrameIframe({
  width,
  height,
  srcDoc,
  src,
  innerRef,
}: {
  width: number;
  height: number;
  srcDoc?: string;
  src?: string;
  innerRef?: React.Ref<HTMLIFrameElement>;
}) {
  return (
    <iframe
      ref={innerRef}
      srcDoc={srcDoc}
      src={src}
      title="Device Preview"
      className="w-full h-full border-0 bg-white"
      sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
    />
  );
}

/**
 * DeviceFrame — picks the right shell. Forwards the iframe ref to the parent
 * so LivePreview's inspect/console/presence bridge keeps working.
 */
export const DeviceFrame = forwardRef<HTMLIFrameElement, DeviceFrameProps>(
  (props, ref) => {
    if (props.kind === 'iphone-16-pro') {
      return (
        <IPhone16ProFrame {...props}>
          {/* children ignored; iframe rendered internally */}
          <DeviceFrameIframeInner ref={ref} {...props} />
        </IPhone16ProFrame>
      );
    }
    if (props.kind === 'desktop') {
      return (
        <DesktopFrame {...props}>
          <DeviceFrameIframeInner ref={ref} {...props} />
        </DesktopFrame>
      );
    }
    // bare
    return <DeviceFrameIframeInner ref={ref} {...props} />;
  }
);

/* Internal iframe that accepts the forwarded ref */
const DeviceFrameIframeInner = forwardRef<HTMLIFrameElement, DeviceFrameProps>(
  ({ width, height, srcDoc, src }, ref) => (
    <iframe
      ref={ref}
      srcDoc={srcDoc}
      src={src}
      title="Device Preview"
      className="w-full h-full border-0 bg-white"
      sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
    />
  )
);
DeviceFrameIframeInner.displayName = 'DeviceFrameIframeInner';
