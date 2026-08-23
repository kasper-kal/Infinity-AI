"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
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
  ChevronDown,
  ChevronUp,
  Scissors,
  Trash2,
  Copy,
  SlidersHorizontal,
  Music,
  Mic,
  Layers,
  ZoomIn,
  ZoomOut,
  Minus,
  Plus,
  Flag,
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
  // Timeline-specific fields
  id?: string;
  startTime?: number;
  endTime?: number;
  volume?: number; // 0-1 for audio tracks
}

interface VolumeKeyframe {
  time: number; // seconds from clip start
  volume: number; // 0-1
}

interface TimelineTrack {
  id: string;
  name: string;
  type: 'video' | 'asmr' | 'music' | 'text' | 'effects';
  color: string;
  clips: TimelineClip[];
  visible: boolean;
  muted: boolean;
  volume: number; // 0-1
  height: number;
}

interface TimelineClip {
  id: string;
  trackId: string;
  startTime: number; // seconds
  endTime: number; // seconds
  label: string;
  color: string;
  data?: any; // Original step data for text clips
  // Audio-specific
  volume?: number; // 0-1
  fadeIn?: number; // seconds
  fadeOut?: number; // seconds
  // Advanced volume envelope
  volumeEnvelope?: VolumeKeyframe[]; // keyframes for volume automation
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

  // Timeline state
  const [showTimeline, setShowTimeline] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1); // pixels per second
  const [timelineScroll, setTimelineScroll] = useState(0);
  const [tracks, setTracks] = useState<TimelineTrack[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [draggingClip, setDraggingClip] = useState<{ clipId: string; startX: number; startTime: number } | null>(null);
  const [resizingClip, setResizingClip] = useState<{ clipId: string; edge: 'left' | 'right'; startX: number; startTime: number; startDuration: number } | null>(null);
  const [playheadDragging, setPlayheadDragging] = useState(false);

  // Volume envelope editor state
  const [volumeEnvelopeEditor, setVolumeEnvelopeEditor] = useState<{ clip: TimelineClip; track: TimelineTrack } | null>(null);

  const handleEditVolumeEnvelope = (clip: TimelineClip) => {
    const track = tracks.find(t => t.id === clip.trackId);
    if (track) setVolumeEnvelopeEditor({ clip, track });
  };

  const handleCloseVolumeEnvelope = () => setVolumeEnvelopeEditor(null);

  const handleSaveVolumeEnvelope = (envelope: VolumeKeyframe[]) => {
    if (volumeEnvelopeEditor) {
      setTracks(t => t.map(tr => ({
        ...tr,
        clips: tr.clips.map(c =>
          c.id === volumeEnvelopeEditor.clip.id ? { ...c, volumeEnvelope: envelope } : c
        ),
      })));
      handleCloseVolumeEnvelope();
    }
  };

  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const [latestStatus, setLatestStatus] = useState(status);
  const [latestProgress, setLatestProgress] = useState(progress);
  const [latestVideoUrl, setLatestVideoUrl] = useState(videoUrl);
  const [latestError, setLatestError] = useState(error);

  // Fetch script steps if not provided
  useEffect(() => {
    if (scriptSteps.length === 0 && jobId) {
      fetch(`/api/infinity/promo/status/${jobId}`)
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
        const res = await fetch(`/api/infinity/promo/status/${jobId}`);
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

  // Initialize timeline tracks when video is ready
  useEffect(() => {
    if (latestVideoUrl && duration > 0 && tracks.length === 0) {
      const videoTrack: TimelineTrack = {
        id: 'video',
        name: 'Video',
        type: 'video',
        color: '#3b82f6',
        clips: [{
          id: 'main-video',
          trackId: 'video',
          startTime: 0,
          endTime: duration,
          label: 'Main Recording',
          color: '#3b82f6',
        }],
        visible: true,
        muted: false,
        volume: 1,
        height: 80,
      };

      const asmrTrack: TimelineTrack = {
        id: 'asmr',
        name: 'ASMR Audio',
        type: 'asmr',
        color: '#f97316',
        clips: scriptSteps
          .filter(s => s.description)
          .map((step, i) => {
            const stepDur = step.duration || estimateStepDuration(step);
            let cumulativeTime = 0;
            for (let j = 0; j < i; j++) {
              cumulativeTime += scriptSteps[j].duration || estimateStepDuration(scriptSteps[j]);
            }
            return {
              id: `asmr-${i}`,
              trackId: 'asmr',
              startTime: cumulativeTime,
              endTime: cumulativeTime + stepDur,
              label: step.description.slice(0, 30),
              color: '#f97316',
              data: step,
              volume: 0.9,
              fadeIn: 0.1,
              fadeOut: 0.1,
            };
          }),
        visible: true,
        muted: false,
        volume: 0.9,
        height: 60,
      };

      const musicTrack: TimelineTrack = {
        id: 'music',
        name: 'Background Music',
        type: 'music',
        color: '#8b5cf6',
        clips: [{
          id: 'bg-music',
          trackId: 'music',
          startTime: 0,
          endTime: duration,
          label: 'AI-Generated Music',
          color: '#8b5cf6',
          volume: 0.25,
          fadeIn: 2,
          fadeOut: 2,
        }],
        visible: true,
        muted: false,
        volume: 0.25,
        height: 60,
      };

      const textTrack: TimelineTrack = {
        id: 'text',
        name: 'Text Overlays',
        type: 'text',
        color: '#ec4899',
        clips: scriptSteps
          .filter(s => s.description)
          .map((step, i) => {
            const stepDur = step.duration || estimateStepDuration(step);
            let cumulativeTime = 0;
            for (let j = 0; j < i; j++) {
              cumulativeTime += scriptSteps[j].duration || estimateStepDuration(scriptSteps[j]);
            }
            return {
              id: `text-${i}`,
              trackId: 'text',
              startTime: cumulativeTime,
              endTime: cumulativeTime + stepDur,
              label: step.description.slice(0, 25),
              color: step.section === 'hook' ? '#f43f5e' : step.section === 'demo' ? '#0ea5e9' : '#22c55e',
              data: step,
            };
          }),
        visible: true,
        muted: false,
        volume: 1,
        height: 50,
      };

      setTracks([videoTrack, asmrTrack, musicTrack, textTrack]);
    }
  }, [latestVideoUrl, duration, scriptSteps]);

  // Sync playhead with video time
  useEffect(() => {
    if (playheadDragging) return;
    // Video time updates currentTime via timeupdate event
  }, [currentTime, playheadDragging]);

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

  const handleSeekTime = (time: number) => {
    const video = videoRef.current;
    if (!video) return;
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
      const res = await fetch(`/api/infinity/promo/download/${jobId}`);
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

      {/* Timeline Editor */}
      {latestVideoUrl && duration > 0 && (
    <div className="border-t border-border/30 bg-muted/20">
      <div className="flex items-center justify-between p-3 border-b border-border/30 bg-muted/30">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          <span className="font-mono text-sm font-medium text-foreground">Timeline Editor</span>
          <button
            onClick={() => setShowTimeline(!showTimeline)}
            className="ml-2 p-1.5 rounded hover:bg-muted/50 transition-colors text-[10px] font-mono text-muted-foreground hover:text-foreground"
          >
            {showTimeline ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTimelineZoom(z => Math.min(5, z + 0.5))}
            className="p-1.5 rounded hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => setTimelineZoom(z => Math.max(0.2, z - 0.5))}
            className="p-1.5 rounded hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-[10px] font-mono text-muted-foreground px-2">
            {Math.round(timelineZoom * 100)}%
          </span>
          <button
            onClick={() => {
              const timelineData = {
                duration,
                tracks: tracks.map(tr => ({
                  id: tr.id,
                  name: tr.name,
                  type: tr.type,
                  volume: tr.volume,
                  muted: tr.muted,
                  clips: tr.clips.map(c => ({
                    id: c.id,
                    startTime: c.startTime,
                    endTime: c.endTime,
                    label: c.label,
                    volume: c.volume,
                    fadeIn: c.fadeIn,
                    fadeOut: c.fadeOut,
                    volumeEnvelope: c.volumeEnvelope,
                  })),
                })),
              };
              const blob = new Blob([JSON.stringify(timelineData, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `timeline-${jobId.slice(0, 8)}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="p-1.5 rounded hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
            title="Export timeline as JSON"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

          {showTimeline && (
            <div className="p-3">
              <TimelineEditor
                tracks={tracks}
                duration={duration}
                currentTime={currentTime}
                zoom={timelineZoom}
                scroll={timelineScroll}
                onScroll={setTimelineScroll}
                onSeek={handleSeekTime}
                onPlayPause={handlePlayPause}
                isPlaying={isPlaying}
                selectedClipId={selectedClipId}
                onSelectClip={setSelectedClipId}
                draggingClip={draggingClip}
                onDragClip={setDraggingClip}
                resizingClip={resizingClip}
                onResizeClip={setResizingClip}
                onTrackVolumeChange={(trackId, volume) => {
                  setTracks(t => t.map(tr => tr.id === trackId ? { ...tr, volume } : tr));
                }}
                onTrackMuteChange={(trackId, muted, visible) => {
                  setTracks(t => t.map(tr => tr.id === trackId ? { ...tr, muted, visible: visible ?? tr.visible } : tr));
                }}
                onUpdateClip={(clipId, startTime, endTime) => {
                  setTracks(t => t.map(tr => ({
                    ...tr,
                    clips: tr.clips.map(clip =>
                      clip.id === clipId
                        ? { ...clip, startTime, endTime: endTime ?? startTime + (clip.endTime - clip.startTime) }
                        : clip
                    ),
                  })));
                }}
                formatTime={formatTime}
                onSplitClip={(clipId, splitTime) => {
                  setTracks(t => t.map(tr => ({
                    ...tr,
                    clips: tr.clips.flatMap(clip => {
                      if (clip.id !== clipId) return clip;
                      const clipDuration = clip.endTime - clip.startTime;
                      const relSplit = splitTime - clip.startTime;
                      if (relSplit <= 0.1 || relSplit >= clipDuration - 0.1) return clip; // Too close to edge
                      return [
                        { ...clip, id: `${clip.id}-a`, endTime: splitTime, label: `${clip.label} (1/2)` },
                        { ...clip, id: `${clip.id}-b`, startTime: splitTime, label: `${clip.label} (2/2)` },
                      ];
                    }),
                  })));
                }}
                onCopyClip={(clipId) => {
                  setTracks(t => t.map(tr => ({
                    ...tr,
                    clips: tr.clips.flatMap(clip => {
                      if (clip.id !== clipId) return clip;
                      const clipDuration = clip.endTime - clip.startTime;
                      const newStart = clip.endTime;
                      const newEnd = Math.min(duration, newStart + clipDuration);
                      if (newStart >= duration) return clip;
                      return [
                        clip,
                        { ...clip, id: `${clip.id}-copy-${Date.now()}`, startTime: newStart, endTime: newEnd, label: `${clip.label} (copy)` },
                      ];
                    }),
                  })));
                }}
                onDeleteClip={(clipId) => {
                  setTracks(t => t.map(tr => ({
                    ...tr,
                    clips: tr.clips.filter(clip => clip.id !== clipId),
                  })));
                }}
                onUpdateVolumeEnvelope={(clipId, envelope) => {
                  setTracks(t => t.map(tr => ({
                    ...tr,
                    clips: tr.clips.map(clip =>
                      clip.id === clipId ? { ...clip, volumeEnvelope: envelope } : clip
                    ),
                  })));
                }}
                onExportTimeline={() => {
                  const timelineData = {
                    duration,
                    tracks: tracks.map(tr => ({
                      id: tr.id,
                      name: tr.name,
                      type: tr.type,
                      volume: tr.volume,
                      muted: tr.muted,
                      clips: tr.clips.map(c => ({
                        id: c.id,
                        startTime: c.startTime,
                        endTime: c.endTime,
                        label: c.label,
                        volume: c.volume,
                        fadeIn: c.fadeIn,
                        fadeOut: c.fadeOut,
                        volumeEnvelope: c.volumeEnvelope,
                      })),
                    })),
                  };
                  const blob = new Blob([JSON.stringify(timelineData, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `timeline-${jobId.slice(0, 8)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              />
            </div>
          )}
        </div>
      )}

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

      {/* Volume Envelope Editor Modal */}
      {volumeEnvelopeEditor && (
        <VolumeEnvelopeEditor
          clip={volumeEnvelopeEditor.clip}
          track={volumeEnvelopeEditor.track}
          onClose={handleCloseVolumeEnvelope}
          onSave={handleSaveVolumeEnvelope}
          formatTime={formatTime}
        />
      )}
    </div>
  );
}

/* Timeline Editor Component */
interface TimelineEditorProps {
  tracks: TimelineTrack[];
  duration: number;
  currentTime: number;
  zoom: number;
  scroll: number;
  onScroll: (scroll: number) => void;
  onSeek: (time: number) => void;
  onPlayPause: () => void;
  isPlaying: boolean;
  selectedClipId: string | null;
  onSelectClip: (id: string | null) => void;
  draggingClip: { clipId: string; startX: number; startTime: number } | null;
  onDragClip: (drag: { clipId: string; startX: number; startTime: number } | null) => void;
  resizingClip: { clipId: string; edge: 'left' | 'right'; startX: number; startTime: number; startDuration: number } | null;
  onResizeClip: (resize: { clipId: string; edge: 'left' | 'right'; startX: number; startTime: number; startDuration: number } | null) => void;
  onTrackVolumeChange: (trackId: string, volume: number) => void;
  onTrackMuteChange: (trackId: string, muted: boolean, visible?: boolean) => void;
  onUpdateClip: (clipId: string, startTime: number, endTime?: number) => void;
  formatTime: (seconds: number) => string;
  onSplitClip: (clipId: string, splitTime: number) => void;
  onCopyClip: (clipId: string) => void;
  onDeleteClip: (clipId: string) => void;
  onUpdateVolumeEnvelope: (clipId: string, envelope: VolumeKeyframe[]) => void;
  onExportTimeline: () => void;
}

function TimelineEditor({
  tracks,
  duration,
  currentTime,
  zoom,
  scroll,
  onScroll,
  onSeek,
  onPlayPause,
  isPlaying,
  selectedClipId,
  onSelectClip,
  draggingClip,
  onDragClip,
  resizingClip,
  onResizeClip,
  onTrackVolumeChange,
  onTrackMuteChange,
  onUpdateClip,
  formatTime,
  onSplitClip,
  onCopyClip,
  onDeleteClip,
  onUpdateVolumeEnvelope,
  onExportTimeline,
}: TimelineEditorProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const tracksContainerRef = useRef<HTMLDivElement>(null);
  const [playheadDragging, setPlayheadDragging] = useState(false);

  const pixelsPerSecond = 100 * zoom;
  const totalWidth = duration * pixelsPerSecond;
  const visibleStartTime = scroll / pixelsPerSecond;
  const visibleEndTime = (scroll + (tracksContainerRef.current?.clientWidth || 800)) / pixelsPerSecond;

  // Handle horizontal scroll
  const handleWheel = (e: React.WheelEvent) => {
    if (e.shiftKey || e.ctrlKey) {
      e.preventDefault();
      onScroll(scroll + e.deltaY);
    }
  };

  // Handle playhead drag
  const handlePlayheadMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setPlayheadDragging(true);
    const rect = rulerRef.current?.getBoundingClientRect();
    if (rect) {
      const time = (e.clientX - rect.left + scroll) / pixelsPerSecond;
      onSeek(Math.max(0, Math.min(duration, time)));
    }
  };

  // Handle ruler click for seeking
  const handleRulerClick = (e: React.MouseEvent) => {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (rect) {
      const time = (e.clientX - rect.left + scroll) / pixelsPerSecond;
      onSeek(Math.max(0, Math.min(duration, time)));
    }
  };

  // Mouse move for playhead drag
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (playheadDragging && rulerRef.current) {
        const rect = rulerRef.current.getBoundingClientRect();
        const time = (e.clientX - rect.left + scroll) / pixelsPerSecond;
        onSeek(Math.max(0, Math.min(duration, time)));
      }
    };
    const handleMouseUp = () => setPlayheadDragging(false);
    if (playheadDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [playheadDragging, scroll, pixelsPerSecond, duration, onSeek]);

  // Get clip at position
  const getClipAtPosition = (trackId: string, clientX: number) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return null;
    const rect = tracksContainerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const time = (clientX - rect.left + scroll) / pixelsPerSecond;
    return track.clips.find(c => time >= c.startTime && time <= c.endTime) || null;
  };

  // Handle clip mouse down (for dragging)
  const handleClipMouseDown = (e: React.MouseEvent, clip: TimelineClip, trackId: string) => {
    e.stopPropagation();
    e.preventDefault();
    onSelectClip(clip.id);
    const rect = tracksContainerRef.current?.getBoundingClientRect();
    if (rect) {
      onDragClip({
        clipId: clip.id,
        startX: e.clientX,
        startTime: clip.startTime,
      });
    }
  };

  // Handle clip resize
  const handleResizeMouseDown = (e: React.MouseEvent, clip: TimelineClip, edge: 'left' | 'right') => {
    e.stopPropagation();
    e.preventDefault();
    onSelectClip(clip.id);
    onResizeClip({
      clipId: clip.id,
      edge,
      startX: e.clientX,
      startTime: clip.startTime,
      startDuration: clip.endTime - clip.startTime,
    });
  };

  // Global mouse move for drag/resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (draggingClip && tracksContainerRef.current) {
        const rect = tracksContainerRef.current.getBoundingClientRect();
        const deltaTime = (e.clientX - draggingClip.startX) / pixelsPerSecond;
        const clip = getClipById(draggingClip.clipId);
        const clipDuration = clip ? clip.endTime - clip.startTime : 0;
        const newStartTime = Math.max(0, Math.min(duration - clipDuration, draggingClip.startTime + deltaTime));
        updateClipPosition(draggingClip.clipId, newStartTime);
      }
      if (resizingClip && tracksContainerRef.current) {
        const rect = tracksContainerRef.current.getBoundingClientRect();
        const deltaTime = (e.clientX - resizingClip.startX) / pixelsPerSecond;
        if (resizingClip.edge === 'left') {
          const newStartTime = Math.max(0, resizingClip.startTime + deltaTime);
          const newEndTime = newStartTime + resizingClip.startDuration;
          if (newEndTime <= duration) {
            updateClipPosition(resizingClip.clipId, newStartTime, newEndTime);
          }
        } else {
          const newEndTime = Math.min(duration, resizingClip.startTime + resizingClip.startDuration + deltaTime);
          if (newEndTime > resizingClip.startTime) {
            updateClipPosition(resizingClip.clipId, resizingClip.startTime, newEndTime);
          }
        }
      }
    };
    const handleMouseUp = () => {
      onDragClip(null);
      onResizeClip(null);
    };
    if (draggingClip || resizingClip) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingClip, resizingClip, pixelsPerSecond, duration, tracks, onDragClip, onResizeClip]);

  const getClipById = (id: string) => {
    for (const track of tracks) {
      const clip = track.clips.find(c => c.id === id);
      if (clip) return clip;
    }
    return null;
  };

  const updateClipPosition = (clipId: string, startTime: number, endTime?: number) => {
    onUpdateClip(clipId, startTime, endTime);
  };

  // Format time for ruler
  const getTimeMarkers = () => {
    const markers: { time: number; label: string; major: boolean }[] = [];
    const interval = Math.max(1, Math.ceil(10 / zoom)); // Show marker every 1-10 seconds depending on zoom
    for (let t = 0; t <= duration; t += interval) {
      markers.push({ time: t, label: formatTime(t), major: t % (interval * 5) === 0 || t === 0 || t === duration });
    }
    return markers;
  };

  return (
    <div ref={timelineRef} className="bg-muted/50 rounded-lg border border-border/30 overflow-hidden" onWheel={handleWheel}>
      {/* Time Ruler */}
      <div
        ref={rulerRef}
        className="h-12 bg-muted border-b border-border/30 flex items-end px-2 relative cursor-pointer"
        onClick={handleRulerClick}
        onMouseDown={handlePlayheadMouseDown}
        style={{ width: totalWidth + 60 }}
      >
        {/* Time markers */}
        <div className="absolute top-0 left-0 right-0 bottom-0 pointer-events-none" style={{ width: totalWidth }}>
          {getTimeMarkers().map((marker, i) => (
            <div
              key={i}
              className="absolute bottom-0 w-px h-4 bg-border/50"
              style={{
                left: marker.time * pixelsPerSecond,
                height: marker.major ? '8px' : '4px',
                opacity: marker.major ? 1 : 0.5,
              }}
            >
              {marker.major && (
                <span className="absolute -top-5 left-0 text-[9px] font-mono text-muted-foreground white-space-nowrap transform -translate-x-1/2">
                  {marker.label}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-px bg-primary pointer-events-none z-10 transition-all duration-50"
          style={{
            left: currentTime * pixelsPerSecond - scroll,
            height: '100%',
            boxShadow: '0 0 8px var(--primary)',
          }}
        >
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-primary border-2 border-background" />
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-primary border-2 border-background" />
        </div>
      </div>

      {/* Tracks Container */}
      <div
        ref={tracksContainerRef}
        className="relative overflow-x-auto overflow-y-hidden"
        style={{ maxWidth: '100%' }}
      >
        <div style={{ width: totalWidth + 60, minHeight: tracks.length * 70 }}>
          {/* Track Lanes */}
          {tracks.map((track, trackIndex) => (
            <div
              key={track.id}
              className="relative border-b border-border/20 bg-background/50"
              style={{ height: track.height, minHeight: track.height }}
            >
              {/* Track Header */}
              <div className="absolute left-0 top-0 bottom-0 flex items-center justify-between px-2 bg-muted/30 border-r border-border/30 z-10" style={{ width: 120 }}>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!track.muted}
                    onChange={(e) => onTrackMuteChange(track.id, !e.target.checked)}
                    className="w-3 h-3 accent-primary"
                    title={track.muted ? 'Unmute' : 'Mute'}
                  />
                  <input
                    type="checkbox"
                    checked={track.visible}
                    onChange={(e) => onTrackMuteChange(track.id, !track.muted, e.target.checked)}
                    className="w-3 h-3 accent-primary"
                    title={track.visible ? 'Hide' : 'Show'}
                  />
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: track.color }} />
                  <span className="text-[10px] font-mono text-foreground font-medium">{track.name}</span>
                  {track.type === 'asmr' && <Mic className="w-3 h-3 text-muted-foreground" />}
                  {track.type === 'music' && <Music className="w-3 h-3 text-muted-foreground" />}
                  {track.type === 'text' && <Flag className="w-3 h-3 text-muted-foreground" />}
                  {track.type === 'video' && <Film className="w-3 h-3 text-muted-foreground" />}
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={track.volume}
                    onChange={(e) => onTrackVolumeChange(track.id, parseFloat(e.target.value))}
                    className="w-16 h-1 appearance-none bg-primary/20 rounded-full cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
                    title={`Volume: ${Math.round(track.volume * 100)}%`}
                  />
                </div>
              </div>

              {/* Clips Area */}
              <div
                className="absolute left-0 top-0 right-0 bottom-0 pl-[120px] relative"
                style={{ height: track.height }}
              >
                {track.clips.map(clip => (
                  <TimelineClipComponent
                    key={clip.id}
                    clip={clip}
                    track={track}
                    pixelsPerSecond={pixelsPerSecond}
                    scroll={scroll}
                    selected={selectedClipId === clip.id}
                    dragging={draggingClip?.clipId === clip.id}
                    resizing={resizingClip?.clipId === clip.id}
                    onClick={() => onSelectClip(clip.id)}
                    onMouseDown={(e) => handleClipMouseDown(e, clip, track.id)}
                    onResizeMouseDown={(e, edge) => handleResizeMouseDown(e, clip, edge)}
                    formatTime={formatTime}
                    onSplit={onSplitClip}
                    onCopy={onCopyClip}
                    onDelete={onDeleteClip}
                    onEditVolumeEnvelope={onUpdateVolumeEnvelope ? (c => onUpdateVolumeEnvelope(c.id, c.volumeEnvelope || [])) : undefined}
                  />
                ))}

                {/* Drop zone for adding clips */}
                <div className="absolute inset-0 pl-[120px] border-2 border-dashed border-border/20 rounded-lg pointer-events-none" />
              </div>
            </div>
          ))}

          {/* Empty state */}
          {tracks.length === 0 && (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              No tracks available. Generate a promo video to see timeline.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* Individual Clip Component */
interface TimelineClipComponentProps {
  clip: TimelineClip;
  track: TimelineTrack;
  pixelsPerSecond: number;
  scroll: number;
  selected: boolean;
  dragging: boolean;
  resizing: boolean;
  onClick: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onResizeMouseDown: (e: React.MouseEvent, edge: 'left' | 'right') => void;
  formatTime: (seconds: number) => string;
  onSplit?: (clipId: string, splitTime: number) => void;
  onCopy?: (clipId: string) => void;
  onDelete?: (clipId: string) => void;
  onEditVolumeEnvelope?: (clip: TimelineClip) => void;
}

function TimelineClipComponent({
  clip,
  track,
  pixelsPerSecond,
  scroll,
  selected,
  dragging,
  resizing,
  onClick,
  onMouseDown,
  onResizeMouseDown,
  formatTime,
  onSplit,
  onCopy,
  onDelete,
  onEditVolumeEnvelope,
}: TimelineClipComponentProps) {
  const left = clip.startTime * pixelsPerSecond - scroll;
  const width = Math.max(20, (clip.endTime - clip.startTime) * pixelsPerSecond);
  const clipDuration = clip.endTime - clip.startTime;

  // Volume envelope visualization for audio clips
  const showVolumeEnvelope = track.type === 'asmr' || track.type === 'music';
  const fadeInWidth = Math.min(width * 0.3, (clip.fadeIn || 0) * pixelsPerSecond);
  const fadeOutWidth = Math.min(width * 0.3, (clip.fadeOut || 0) * pixelsPerSecond);

  return (
    <div
      className={cn(
        "absolute top-1 bottom-1 rounded cursor-pointer transition-all select-none",
        "border-2",
        selected ? "border-primary shadow-[0_0_0_1px_var(--primary)]" : "border-transparent",
        dragging && "opacity-80 shadow-lg z-20",
        resizing && "z-20",
        !track.visible && "opacity-30",
      )}
      style={{
        left: Math.max(0, left),
        width,
        backgroundColor: clip.color + (track.muted ? '80' : 'CC'),
        opacity: track.muted ? 0.5 : 1,
        zIndex: dragging || resizing ? 20 : selected ? 10 : 1,
      }}
      onClick={onClick}
      onMouseDown={onMouseDown}
      title={`${clip.label} (${formatTime(clip.startTime)} - ${formatTime(clip.endTime)})`}
    >
      {/* Left resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:w-3 hover:bg-primary/30 rounded-l transition-all"
        onMouseDown={(e) => onResizeMouseDown(e, 'left')}
      />

      {/* Right resize handle */}
      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:w-3 hover:bg-primary/30 rounded-r transition-all"
        onMouseDown={(e) => onResizeMouseDown(e, 'right')}
      />

      {/* Volume envelope - fade in */}
      {showVolumeEnvelope && clip.fadeIn && clip.fadeIn > 0 && (
        <div
          className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-transparent to-white/20 pointer-events-none"
          style={{ width: fadeInWidth }}
        />
      )}

      {/* Volume envelope - fade out */}
      {showVolumeEnvelope && clip.fadeOut && clip.fadeOut > 0 && (
        <div
          className="absolute right-0 top-0 bottom-0 bg-gradient-to-l from-transparent to-white/20 pointer-events-none"
          style={{ width: fadeOutWidth }}
        />
      )}

      {/* Clip label */}
      <div className="absolute left-2 right-2 top-1/2 -translate-y-1/2 truncate text-[9px] font-mono text-white/90 pointer-events-none">
        {clip.label}
      </div>

      {/* Clip duration badge */}
      {width > 80 && (
        <div className="absolute right-2 top-1 text-[8px] font-mono text-white/70 bg-black/30 px-1 rounded pointer-events-none">
          {formatTime(clipDuration)}
        </div>
      )}

      {/* Selected clip actions */}
      {selected && width > 120 && (
        <div className="absolute top-1 right-1 flex gap-0.5 pointer-events-none">
          <button
            className="p-1 rounded bg-white/10 hover:bg-white/20 text-white/80 text-[8px]"
            onClick={(e) => { e.stopPropagation(); onSplit?.(clip.id, clip.startTime + clipDuration / 2); }}
            title="Split clip at center"
          >
            <Scissors className="w-3 h-3" />
          </button>
          <button
            className="p-1 rounded bg-white/10 hover:bg-white/20 text-white/80 text-[8px]"
            onClick={(e) => { e.stopPropagation(); onCopy?.(clip.id); }}
            title="Copy clip"
          >
            <Copy className="w-3 h-3" />
          </button>
          <button
            className="p-1 rounded bg-white/10 hover:bg-red-500/30 text-white/80 text-[8px]"
            onClick={(e) => { e.stopPropagation(); onDelete?.(clip.id); }}
            title="Delete clip"
          >
            <Trash2 className="w-3 h-3" />
          </button>
          {(track.type === 'asmr' || track.type === 'music') && onEditVolumeEnvelope && (
            <button
              className="p-1 rounded bg-white/10 hover:bg-white/20 text-white/80 text-[8px]"
              onClick={(e) => { e.stopPropagation(); onEditVolumeEnvelope(clip); }}
              title="Edit volume envelope"
            >
              <SlidersHorizontal className="w-3 h-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* Volume Envelope Editor Modal */
interface VolumeEnvelopeEditorProps {
  clip: TimelineClip;
  track: TimelineTrack;
  onClose: () => void;
  onSave: (envelope: VolumeKeyframe[]) => void;
  formatTime: (seconds: number) => string;
}

function VolumeEnvelopeEditor({ clip, track, onClose, onSave, formatTime }: VolumeEnvelopeEditorProps) {
  const [envelope, setEnvelope] = useState<VolumeKeyframe[]>(
    clip.volumeEnvelope && clip.volumeEnvelope.length > 0
      ? [...clip.volumeEnvelope]
      : [
          { time: 0, volume: clip.volume ?? 1 },
          { time: clip.endTime - clip.startTime, volume: clip.volume ?? 1 },
        ]
  );
  const [selectedKeyframeIndex, setSelectedKeyframeIndex] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const clipDuration = clip.endTime - clip.startTime;

  // Draw envelope on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (height / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    for (let i = 0; i <= 10; i++) {
      const x = (width / 10) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Draw envelope line
    ctx.strokeStyle = track.color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    const sortedEnvelope = [...envelope].sort((a, b) => a.time - b.time);

    sortedEnvelope.forEach((kf, i) => {
      const x = (kf.time / clipDuration) * width;
      const y = height - kf.volume * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Draw keyframes
    sortedEnvelope.forEach((kf, i) => {
      const x = (kf.time / clipDuration) * width;
      const y = height - kf.volume * height;
      ctx.fillStyle = i === selectedKeyframeIndex ? '#fff' : track.color;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, i === selectedKeyframeIndex ? 7 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }, [envelope, clipDuration, track.color, selectedKeyframeIndex]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const time = (x / rect.width) * clipDuration;
    const volume = 1 - y / rect.height;

    // Check if clicking near existing keyframe
    let closestIndex: number | null = null;
    let closestDist = Infinity;
    envelope.forEach((kf, i) => {
      const kfX = (kf.time / clipDuration) * rect.width;
      const kfY = (1 - kf.volume) * rect.height;
      const dist = Math.hypot(x - kfX, y - kfY);
      if (dist < closestDist && dist < 15) {
        closestDist = dist;
        closestIndex = i;
      }
    });

    if (closestIndex !== null) {
      setSelectedKeyframeIndex(closestIndex);
    } else {
      // Add new keyframe
      const newEnvelope = [...envelope, { time: Math.max(0, Math.min(clipDuration, time)), volume: Math.max(0, Math.min(1, volume)) }]
        .sort((a, b) => a.time - b.time);
      setEnvelope(newEnvelope);
      // Select the new keyframe
      const newIndex = newEnvelope.findIndex(kf => Math.abs(kf.time - time) < 0.01 && Math.abs(kf.volume - volume) < 0.01);
      setSelectedKeyframeIndex(newIndex);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (selectedKeyframeIndex === null) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const time = Math.max(0, Math.min(clipDuration, (x / rect.width) * clipDuration));
    const volume = Math.max(0, Math.min(1, 1 - y / rect.height));

    setEnvelope(prev => {
      const next = [...prev];
      // Prevent moving past adjacent keyframes
      if (selectedKeyframeIndex > 0 && time <= next[selectedKeyframeIndex - 1].time) return prev;
      if (selectedKeyframeIndex < next.length - 1 && time >= next[selectedKeyframeIndex + 1].time) return prev;
      next[selectedKeyframeIndex] = { time, volume };
      return next;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (selectedKeyframeIndex === null) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // Don't delete first or last keyframe
      if (envelope.length > 2 && selectedKeyframeIndex > 0 && selectedKeyframeIndex < envelope.length - 1) {
        setEnvelope(prev => prev.filter((_, i) => i !== selectedKeyframeIndex));
        setSelectedKeyframeIndex(null);
      }
    }
    if (e.key === 'Escape') setSelectedKeyframeIndex(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl p-6 w-full max-w-3xl max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-mono text-lg font-medium">Volume Envelope: {clip.label}</h3>
          <button onClick={onClose} className="p-2 rounded hover:bg-muted transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4">
          <label className="text-[10px] font-mono text-muted-foreground mb-2 block">Click to add keyframes, drag to move, Delete to remove (except first/last)</label>
          <canvas
            ref={canvasRef}
            width={600}
            height={200}
            className="w-full max-w-[600px] bg-muted/50 rounded border border-border/30 cursor-crosshair"
            onClick={handleCanvasClick}
            onMouseMove={handleCanvasMouseMove}
            onMouseLeave={() => setSelectedKeyframeIndex(null)}
            onMouseUp={() => setSelectedKeyframeIndex(null)}
            onKeyDown={handleKeyDown}
            tabIndex={0}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="text-[10px] font-mono text-muted-foreground block mb-1">Duration: {formatTime(clipDuration)}</label>
            <div className="text-sm font-mono text-foreground">{clipDuration.toFixed(2)}s</div>
          </div>
          <div>
            <label className="text-[10px] font-mono text-muted-foreground block mb-1">Keyframes</label>
            <div className="text-sm font-mono text-foreground">{envelope.length}</div>
          </div>
          <div>
            <label className="text-[10px] font-mono text-muted-foreground block mb-1">Track</label>
            <div className="text-sm font-mono text-foreground">{track.name} ({track.type})</div>
          </div>
        </div>

        {/* Keyframe list */}
        <div className="max-h-40 overflow-auto mb-4 border border-border/30 rounded p-2 bg-muted/30">
          <div className="grid grid-cols-4 gap-2 text-[10px] font-mono text-muted-foreground mb-1">
            <span>#</span>
            <span>Time</span>
            <span>Volume</span>
            <span></span>
          </div>
          {envelope.map((kf, i) => (
            <div key={i} className={cn(
              "grid grid-cols-4 gap-2 items-center p-1 rounded",
              i === selectedKeyframeIndex && "bg-primary/10 border border-primary/30"
            )}>
              <span className="text-[10px] font-mono">{i + 1}</span>
              <input
                type="number"
                step="0.01"
                min={i > 0 ? envelope[i - 1].time + 0.01 : 0}
                max={i < envelope.length - 1 ? envelope[i + 1].time - 0.01 : clipDuration}
                value={kf.time}
                onChange={e => setEnvelope(prev => {
                  const next = [...prev];
                  next[i] = { ...next[i], time: parseFloat(e.target.value) };
                  return next;
                })}
                className="bg-background border border-border/30 rounded px-1 py-0.5 text-[10px] font-mono w-full focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <input
                type="number"
                step="0.01"
                min={0}
                max={1}
                value={kf.volume}
                onChange={e => setEnvelope(prev => {
                  const next = [...prev];
                  next[i] = { ...next[i], volume: parseFloat(e.target.value) };
                  return next;
                })}
                className="bg-background border border-border/30 rounded px-1 py-0.5 text-[10px] font-mono w-full focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {envelope.length > 2 && i > 0 && i < envelope.length - 1 && (
                <button
                  onClick={() => {
                    setEnvelope(prev => prev.filter((_, idx) => idx !== i));
                    setSelectedKeyframeIndex(null);
                  }}
                  className="text-red-400 hover:text-red-300 text-[10px]"
                  title="Delete keyframe"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border/30 text-sm font-mono hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(envelope)}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-mono hover:bg-primary/90 transition-colors"
          >
            Save Envelope
          </button>
        </div>
      </div>
    </div>
  );
}