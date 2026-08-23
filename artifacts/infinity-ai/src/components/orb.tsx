import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Square } from 'lucide-react';

export type AppState = 'idle' | 'wake' | 'recording' | 'transcribing' | 'thinking' | 'speaking';

interface OrbProps {
  status: AppState;
  onClick?: () => void;
  /** Audio amplitude 0-1 for reactive particles during speaking/recording */
  amplitude?: number;
}

// ── Animated rings for different states ──
function StatusRings({ status, amplitude = 0 }: { status: AppState; amplitude?: number }) {
  const isVoiceState = status === 'recording' || status === 'speaking';
  const response = isVoiceState ? amplitude : 0;

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      {isVoiceState && [1, 2, 3].map((i) => (
        <div
          key={`voice-ring-${i}`}
          className="absolute w-full h-full rounded-full border transition-[transform,opacity] duration-150 ease-out"
          style={{
            borderColor: status === 'recording'
              ? `rgba(255, 80, 80, ${response * 0.28})`
              : `rgba(80, 255, 180, ${response * 0.22})`,
            transform: `scale(${0.94 + response * (0.12 + i * 0.025)})`,
            opacity: response > 0.02 ? 0.35 - i * 0.07 : 0,
          }}
        />
      ))}
    </div>
  );
}

// ── Listening waveform bars ──
function Waveform({ amplitude = 0 }: { amplitude?: number }) {
  return (
    <div className="absolute bottom-[-28px] left-1/2 -translate-x-1/2 flex items-end gap-[3px] h-5">
      {Array.from({ length: 7 }).map((_, i) => (
        <motion.div
          key={i}
          className="w-[2.5px] rounded-full"
          style={{ background: 'rgba(0, 122, 255, 0.5)' }}
          animate={{
            height: [
              `${4 * (1 - amplitude * 0.3)}px`,
              `${(8 + Math.sin(i * 0.8) * 6 + 4) * (0.5 + amplitude * 0.5)}px`,
              `${4 * (1 - amplitude * 0.3)}px`,
            ],
          }}
          transition={{
            repeat: Infinity,
            duration: 0.5 + i * 0.03,
            delay: i * 0.05,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}

export function Orb({ status, onClick, amplitude = 0 }: OrbProps) {
  const isBusy = status === 'thinking' || status === 'transcribing';
  const isActive = status !== 'idle' && status !== 'wake';
  const voiceResponse = status === 'recording' || status === 'speaking' ? amplitude : 0;

  // Apple-blue base with state tinting
  const glowColor =
    status === 'recording' ? 'rgba(255, 80, 80, 0.6)' :
    status === 'speaking' ? 'rgba(80, 255, 180, 0.6)' :
    status === 'thinking' || status === 'transcribing' ? 'rgba(255, 200, 80, 0.4)' :
    'rgba(0, 122, 255, 0.5)';

  return (
    <div
      className="relative isolate z-[10000] flex items-center justify-center w-[260px] h-[260px] sm:w-[280px] sm:h-[280px] cursor-pointer group select-none"
      onPointerDown={onClick}
      style={{ touchAction: 'manipulation' }}
      aria-label={status}
      role="button"
    >
      {/* Masks only the page texture around the orb; the rest of the
          background keeps its original subtle dot texture. */}
      <div
        className="absolute -inset-4 rounded-full bg-background pointer-events-none"
        aria-hidden="true"
      />

      {/* Ambient glow backdrop, radial gradient instead of blur(80px): the
          filter was repainted every frame; a gradient fades on its own. */}
      <motion.div
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{ background: `radial-gradient(circle, ${glowColor} 0%, transparent 70%)` }}
        animate={{
            scale: 1 + voiceResponse * 0.28,
          opacity: status === 'idle' ? 0.12 : isActive ? 0.18 + voiceResponse * 0.28 : 0.2,
        }}
        transition={{
          type: 'spring',
          stiffness: 180,
          damping: 24,
          mass: 0.35,
        }}
      />

      {/* Status rings */}
      <StatusRings status={status} amplitude={amplitude} />

      {/* Core sphere, Apple-style glass with minimal border */}
      <motion.div
        className="relative z-10 w-[160px] h-[160px] sm:w-[180px] sm:h-[180px] rounded-full flex items-center justify-center overflow-hidden"
        style={{
          background: isActive
            ? `radial-gradient(circle at 35% 35%, rgba(255,255,255,0.15) 0%, hsl(var(--card)) 90%)`
            : `radial-gradient(circle at 35% 35%, rgba(255,255,255,0.08) 0%, hsl(var(--card)) 90%)`,
          boxShadow: isActive
            ? `0 0 0 1px ${glowColor.replace('0.6', '0.2')}, 0 8px 32px ${glowColor.replace('0.6', '0.08')}`
            : `0 0 0 1px hsl(var(--border)), 0 4px 16px hsl(0 0% 0% / 0.04)`,
        }}
        animate={{
          scale: status === 'recording' ? 0.975 + voiceResponse * 0.11
            : 1 + voiceResponse * 0.09,
        }}
        transition={{
          type: 'spring',
          stiffness: 190,
          damping: 22,
          mass: 0.4,
        }}
      >
        {/* Subtle inner highlight */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: 'radial-gradient(circle at 30% 25%, rgba(255,255,255,0.12) 0%, transparent 60%)',
          }}
        />

        {/* State-tinted inner glow */}
        <motion.div
          className="absolute inset-0 rounded-full"
          animate={{
            background:
              status === 'recording' ? 'radial-gradient(circle at 50% 50%, rgba(255,80,80,0.10) 0%, transparent 70%)' :
              status === 'speaking' ? 'radial-gradient(circle at 50% 50%, rgba(80,255,180,0.08) 0%, transparent 70%)' :
              isBusy ? 'radial-gradient(circle at 50% 50%, rgba(255,200,80,0.08) 0%, transparent 70%)' :
              'radial-gradient(circle at 50% 50%, rgba(0,122,255,0.04) 0%, transparent 70%)',
          }}
          transition={{ duration: 0.5 }}
        />

        {/* Static liquid-gleam highlight, avoids an always-on animation while paused. */}
        <div
          className="absolute inset-[-30%] opacity-20"
          style={{
            background: 'conic-gradient(from 0deg, transparent 0deg, rgba(255,255,255,0.25) 60deg, transparent 120deg, rgba(255,255,255,0.1) 180deg, transparent 240deg, rgba(255,255,255,0.2) 300deg, transparent 360deg)',
          }}
        />

        {/* Icon */}
        <AnimatePresence mode="wait">
          {status === 'recording' ? (
            <motion.div
              key="stop"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              className="relative z-20"
              style={{ color: 'rgba(255, 80, 80, 0.8)' }}
            >
              <Square className="w-7 h-7 fill-current" />
            </motion.div>
          ) : (
            <motion.div
              key="mic"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              className="relative z-20 transition-colors"
              style={{ color: isActive ? 'rgba(0, 122, 255, 0.7)' : 'hsl(var(--muted-foreground))' }}
            >
              <Mic className="w-7 h-7" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Waveform bars during speaking */}
      <AnimatePresence>
        {status === 'speaking' && (
          <motion.div
            key="waveform"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="absolute bottom-0"
          >
            <Waveform amplitude={amplitude} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
