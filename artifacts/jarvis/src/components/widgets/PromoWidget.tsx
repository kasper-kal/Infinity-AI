"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Play,
  Pause,
  Download,
  Share2,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Film,
  Clock,
  Settings,
  Zap,
  Volume2,
  MessageSquare,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { haptics } from "@/lib/haptics";

interface PromoScriptStep {
  action: string;
  description: string;
  duration?: number;
  section?: string;
  textStyle?: string;
  textPosition?: string;
  text?: string;
}

interface PromoWidgetProps {
  jobId: string;
  status: 'planning' | 'recording' | 'audio' | 'encoding' | 'optimizing' | 'completed' | 'failed';
  progress: number;
  videoUrl?: string;
  thumbnailUrl?: string;
  error?: string;
  onClose?: () => void;
  onRetry?: () => void;
  scriptSteps?: PromoScriptStep[];
}

const STAGES = [
  { key: 'planning', label: 'Planning Script', icon: '📋' },
  { key: 'recording', label: 'Recording Browser', icon: '🎬' },
  { key: 'audio', label: 'Generating ASMR Audio', icon: '🔊' },
  { key: 'encoding', label: 'Encoding Video', icon: '⚙️' },
  { key: 'optimizing', label: 'AI Speed Optimization', icon: '🚀' },
  { key: 'completed', label: 'Complete', icon: '✅' },
] as const;

const STAGE_ORDER = ['planning', 'recording', 'audio', 'encoding', 'optimizing', 'completed', 'failed'] as const;

export function PromoWidget({
  jobId,
  status,
  progress,
  videoUrl,
  thumbnailUrl,
  error,
  onClose,
  onRetry,
  scriptSteps = [],
}: PromoWidgetProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [currentStep, setCurrentStep] = useState<PromoScriptStep | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const [latestStatus, setLatestStatus] = useState(status);
  const [latestProgress, setLatestProgress] = useState(progress);
  const [latestVideoUrl, setLatestVideoUrl] = useState(videoUrl);
  const [latestError, setLatestError] = useState(error);

  // Fetch script steps if not provided
  useEffect(() => {
    if (scriptSteps.length === 0 && jobId) {
      fetch(`/api/jarvis/promo/status/${jobId}`)
        .then(res => res.json())
        .then(data => {
          if (data.script?.steps) {
            // We can't set scriptSteps directly since it's a prop, but we can derive from data
            // Store in a ref or we'll just use the prop when provided
          }
        })
        .catch(console.error);
    }
  }, [jobId, scriptSteps]);

  // Poll for status updates when not completed/failed
  useEffect(() => {
    if (status === 'completed' || status === 'failed') return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/jarvis/promo/status/${jobId}`);
        if (res.ok) {
          const data = await res.json();
          setLatestStatus(data.status);
          setLatestProgress(data.progress);
          if (data.videoUrl) setLatestVideoUrl(data.videoUrl);
          if (data.error) setLatestError(data.error);
        }
      } catch (e) {
        console.error('Failed to poll promo status:', e);
      }
    };

    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobId, status]);

  // Sync props to state
  useEffect(() => {
    setLatestStatus(status);
    setLatestProgress(progress);
  }, [status, progress]);

  // Handle video progress and current step tracking
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateProgress = () => {
      const time = video.currentTime;
      setCurrentTime(time);

      // Determine current step based on script steps
      if (scriptSteps.length > 0) {
        let cumulativeTime = 0;
        for (const step of scriptSteps) {
          const stepDur = step.duration || estimateStepDuration(step);
          if (time >= cumulativeTime && time < cumulativeTime + stepDur) {
            setCurrentStep(step);
            break;
          }
          cumulativeTime += stepDur;
        }
      }
    };

    const onLoadedMetadata = () => {
      setDuration(video.duration);
    };

    video.addEventListener('timeupdate', updateProgress);
    video.addEventListener('loadedmetadata', onLoadedMetadata);

    return () => {
      video.removeEventListener('timeupdate', updateProgress);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [scriptSteps]);

  // Auto-play when video loads
  useEffect(() => {
    if (latestVideoUrl && videoRef.current) {
      videoRef.current.load();
    }
  }, [latestVideoUrl]);

  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video || !latestVideoUrl) return;
    haptics.light();
    if (isPlaying) {
      video.pause();
    } else {
      video.play().catch(console.error);
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const time = parseFloat(e.target.value);
    video.currentTime = time;
    setCurrentTime(time);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const vol = parseFloat(e.target.value);
    video.volume = vol;
    setVolume(vol);
    setIsMuted(vol === 0);
  };

  const handleMuteToggle = () => {
    const video = videoRef.current;
    if (!video) return;
    haptics.light();
    video.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleFullscreenToggle = () => {
    haptics.light();
    setShowFullscreen(!showFullscreen);
  };

  const handleDownload = async () => {
    if (!latestVideoUrl) return;
    haptics.light();
    try {
      const res = await fetch(`/api/jarvis/promo/download/${jobId}`);
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `promo-${jobId.slice(0, 8)}.mp4`;
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.error('Download failed:', e);
    }
  };

  const handleShare = async () => {
    if (!latestVideoUrl) return;
    haptics.light();
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Infinity Promo Video',
          text: 'Check out this promo video created with Infinity AI',
          url: window.location.origin + latestVideoUrl,
        });
      } else {
        navigator.clipboard.writeText(window.location.origin + latestVideoUrl);
        // Could show toast here
      }
    } catch (e) {
      console.error('Share failed:', e);
    }
  };

  const handleRetry = () => {
    haptics.light();
    onRetry?.();
  };

  const handleClose = () => {
    haptics.light();
    onClose?.();
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getCurrentStageIndex = () => {
    return STAGE_ORDER.indexOf(latestStatus);
  };

  // Estimate step duration (mirrors backend)
  function estimateStepDuration(step: PromoScriptStep): number {
    switch (step.action) {
      case "navigate": return 3;
      case "click": return 1;
      case "type": return step.text ? (step.text.length * 80) / 1000 : 1;
      case "scroll": return 1.5;
      case "wait": return 1;
      case "hover": return 0.8;
      case "zoom": return 2;
      case "pan": return 2;
      default: return 1;
    }
  }

  return (
    <div className={cn(
      "rounded-2xl border border-border/50 bg-card overflow-hidden",
      showFullscreen ? "fixed inset-0 z-50 w-full h-full max-w-none max-h-none rounded-none" : "max-w-2xl"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border/30 bg-muted/30">
        <div className="flex items-center gap-2">
          <Film className="w-5 h-5 text-primary" />
          <span className="font-mono text-sm font-medium text-foreground">Promo Video</span>
          {onClose && (
            <button
              onClick={handleClose}
              className="ml-1 p-1 rounded hover:bg-muted/50 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Status badge */}
        <div className="flex items-center gap-1.5">
          {latestStatus === 'completed' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-green-500/10 text-green-500 border border-green-500/20">
              <CheckCircle2 className="w-3 h-3" /> Complete
            </span>
          )}
          {latestStatus === 'failed' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-red-500/10 text-red-500 border border-red-500/20">
              <AlertCircle className="w-3 h-3" /> Failed
            </span>
          )}
          {['planning', 'recording', 'audio', 'encoding', 'optimizing'].includes(latestStatus) && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-primary/10 text-primary border border-primary/20">
              <Loader2 className="w-3 h-3 animate-spin" /> {latestProgress}%
            </span>
          )}
        </div>
      </div>

      {/* Progress stages indicator */}
      <div className="px-3 py-2 border-b border-border/30 bg-muted/20">
        <div className="flex items-center justify-between">
          {STAGES.map((stage, i) => {
            const stageIndex = STAGE_ORDER.indexOf(stage.key);
            const currentIndex = getCurrentStageIndex();
            const isComplete = stageIndex < currentIndex;
            const isCurrent = stageIndex === currentIndex && latestStatus !== 'completed' && latestStatus !== 'failed';

            return (
              <div key={stage.key} className="flex flex-col items-center gap-1 flex-1 relative">
                {/* Connector line */}
                {i < STAGES.length - 1 && (
                  <div
                    className="absolute top-[14px] left-1/2 w-full h-1 -translate-x-1/2 z-0"
                    style={{
                      background: isComplete ? 'var(--primary)' : 'var(--border)',
                      opacity: 0.5
                    }}
                  />
                )}
                <div className={cn(
                  "relative z-10 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all",
                  isComplete
                    ? "bg-primary text-primary-foreground"
                    : isCurrent
                    ? "bg-primary/20 text-primary border-2 border-primary animate-pulse"
                    : "bg-muted text-muted-foreground border border-border/30"
                )}>
                  {isComplete ? <CheckCircle2 className="w-3.5 h-3.5" /> : stage.icon}
                </div>
                <span className={cn(
                  "text-[9px] font-mono text-center max-w-[60px] transition-colors",
                  isComplete || isCurrent ? "text-foreground" : "text-muted-foreground/60"
                )}>
                  {stage.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Video player or loading state */}
      <div className="relative bg-black aspect-video">
        {latestVideoUrl ? (
          <>
            <video
              ref={videoRef}
              src={latestVideoUrl}
              className="w-full h-full object-contain"
              playsInline
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
            />

            {/* Current step text overlay (synchronized with video) */}
            {currentStep && (
              <div className="absolute bottom-28 left-1/2 -translate-x-1/2 w-full max-w-3xl px-4 pointer-events-none">
                <div className={cn(
                  "text-center px-4 py-2 rounded-xl backdrop-blur-sm border transition-all duration-300",
                  currentStep.section === "hook" && "bg-rose-500/20 border-rose-500/30 text-rose-100",
                  currentStep.section === "demo" && "bg-sky-500/20 border-sky-500/30 text-sky-100",
                  currentStep.section === "cta" && "bg-emerald-500/20 border-emerald-500/30 text-emerald-100",
                  currentStep.textStyle === "title" && "text-2xl font-bold",
                  currentStep.textStyle === "subtitle" && "text-lg font-medium",
                  currentStep.textStyle === "body" && "text-base",
                  currentStep.textStyle === "caption" && "text-sm opacity-80"
                )}>
                  {currentStep.description}
                </div>
                {currentStep.section && (
                  <div className="mt-1 flex items-center justify-center gap-2 text-[10px] font-mono opacity-60">
                    <span className="px-1.5 py-0.5 rounded bg-white/10">{currentStep.section.toUpperCase()}</span>
                    <span>{currentStep.action}</span>
                  </div>
                )}
              </div>
            )}

            {/* Video controls overlay */}
            <div className="absolute inset-0 flex flex-col justify-end p-3 bg-gradient-to-t from-black/80 via-transparent to-transparent">
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="range"
                  min={0}
                  max={duration || 100}
                  value={currentTime}
                  onChange={handleSeek}
                  className="flex-1 h-1 appearance-none bg-white/30 rounded-full cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary"
                />
                <span className="text-[10px] font-mono text-white/80 w-20 text-right">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button onClick={handlePlayPause} className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white" aria-label={isPlaying ? 'Pause' : 'Play'}>
                    {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                  </button>
                  <button onClick={handleMuteToggle} className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white" aria-label={isMuted ? 'Unmute' : 'Mute'}>
                    {isMuted ? <Volume2 className="w-5 h-5" strokeWidth={1.5} /> : <Volume2 className="w-5 h-5" />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={isMuted ? 0 : volume}
                    onChange={handleVolumeChange}
                    className="w-20 h-1 appearance-none bg-white/30 rounded-full cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={handleDownload} className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white" aria-label="Download" title="Download">
                    <Download className="w-5 h-5" />
                  </button>
                  <button onClick={handleShare} className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white" aria-label="Share" title="Share">
                    <Share2 className="w-5 h-5" />
                  </button>
                  <button onClick={handleFullscreenToggle} className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white" aria-label={showFullscreen ? 'Exit fullscreen' : 'Fullscreen'} title={showFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                    {showFullscreen ? (
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>
                    ) : (
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          // Loading/placeholder state
          <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-white/80">
            {thumbnailUrl && (
              <img
                src={thumbnailUrl}
                alt="Promo thumbnail"
                className="max-w-full max-h-[60%] object-contain rounded-lg opacity-60"
              />
            )}
            <div className="flex flex-col items-center gap-2">
              <div className="relative w-16 h-16">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                  <circle
                    cx="50"
                    cy="50"
                    r="45"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    className="text-white/20"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="45"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeDasharray={283}
                    strokeDashoffset={283 - (283 * latestProgress) / 100}
                    strokeLinecap="round"
                    className="text-primary transition-all duration-500"
                    style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xl font-bold font-mono text-white">{latestProgress}%</span>
                </div>
              </div>
              <p className="text-sm font-medium">{latestStatus.charAt(0).toUpperCase() + latestStatus.slice(1)}</p>
              {latestError && (
                <p className="text-[10px] font-mono text-red-400/80 text-center max-w-xs">{latestError}</p>
              )}
            </div>
          </div>
        )}

        {/* Fullscreen close hint */}
        {showFullscreen && (
          <div className="absolute top-4 right-4 flex items-center gap-1 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur text-white text-[10px] font-mono">
            <kbd className="px-1.5 py-0.5 bg-white/10 rounded">Esc</kbd> Exit fullscreen
          </div>
        )}
      </div>

      {/* Footer with actions */}
      <div className="flex items-center justify-between p-3 border-t border-border/30 bg-muted/20">
        <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
          <span>Job: {jobId.slice(0, 8)}...</span>
        </div>
        <div className="flex items-center gap-2">
          {latestStatus === 'failed' && onRetry && (
            <button
              onClick={handleRetry}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-500 text-[10px] font-mono hover:bg-red-500/20 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retry
            </button>
          )}
          {latestStatus === 'completed' && latestVideoUrl && (
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-primary/30 bg-primary/10 text-primary text-[10px] font-mono hover:bg-primary/20 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </button>
          )}
        </div>
      </div>

      {/* Fullscreen keyboard handler */}
      {showFullscreen && (
        <div
          onKeyDown={(e) => {
            if (e.key === 'Escape') setShowFullscreen(false);
            if (e.key === ' ') { e.preventDefault(); handlePlayPause(); }
            if (e.key === 'm') handleMuteToggle();
            if (e.key === 'f') handleFullscreenToggle();
          }}
          tabIndex={0}
          className="fixed inset-0 z-40"
          autoFocus
        />
      )}
    </div>
  );
}