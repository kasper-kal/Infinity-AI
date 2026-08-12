import { ArrowLeft } from 'lucide-react';
import { CameraFeed } from '@/components/camera-feed';
import { useI18n } from '@/lib/i18n';
import { haptics } from '@/lib/haptics';

interface CameraModeViewProps {
  onBack: () => void;
  onUploadPhoto: () => void;
}

/**
 * Camera mode, full-screen object detection. Back button returns to chat.
 */
export function CameraModeView({ onBack, onUploadPhoto }: CameraModeViewProps) {
  const { t } = useI18n();
  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      {/* Back to chat */}
      <button
        onClick={() => { haptics.light(); onBack(); }}
        className="absolute top-3 left-3 z-30 w-9 h-9 rounded-full bg-card/80 border border-border/50 backdrop-blur-xl text-foreground flex items-center justify-center shadow-sm hover:bg-secondary/80 active:scale-95 transition-all"
        aria-label={t('voice.backToChat')}
        title={t('voice.backToChat')}
      >
        <ArrowLeft className="w-[18px] h-[18px]" />
      </button>
      <div className="flex-1 min-h-0 p-4 sm:p-8 flex flex-col">
        <div className="liquid-glass-soft rounded-2xl overflow-hidden flex-1 min-h-0 relative">
          <CameraFeed
            className="h-full"
            enableDetection
            onUploadPhoto={onUploadPhoto}
          />
        </div>
        <p className="text-center text-xs text-muted-foreground mt-3">
          {t('camera.note')}
        </p>
      </div>
    </div>
  );
}
