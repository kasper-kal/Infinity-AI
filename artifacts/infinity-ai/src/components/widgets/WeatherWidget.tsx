import { useState } from 'react';
import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  Moon,
  Sun,
  Wind,
  Thermometer,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface ForecastDay { date: string; maxTemp_c: number; minTemp_c: number; condition: string; conditionCode: number }

export interface WeatherData {
  location: string;
  temp_c: number; temp_f: number; feelsLike_c: number;
  condition: string; conditionCode: number;
  humidity: number; windSpeed_kmh: number; windDir: string;
  isDay: boolean; forecast: ForecastDay[];
}

interface WeatherWidgetProps extends WeatherData {
  onClose?: () => void;
}

function weatherIcon(code: number, isDay = true): LucideIcon {
  if (code === 113) return isDay ? Sun : Moon;
  if (code === 116) return CloudSun;
  if (code === 119 || code === 122) return Cloud;
  if ([143, 248, 260].includes(code)) return CloudFog;
  if (code >= 176 && code <= 182) return CloudRain;
  if ([185, 281, 284].includes(code)) return CloudRain;
  if (code >= 200 && code <= 221) return CloudSnow;
  if (code >= 227 && code <= 260) return CloudSnow;
  if (code >= 263 && code <= 284) return CloudRain;
  if (code >= 293 && code <= 308) return CloudRain;
  if (code >= 311 && code <= 335) return CloudSnow;
  if (code >= 338 && code <= 350) return CloudSnow;
  if (code >= 353 && code <= 368) return CloudRain;
  if (code >= 371 && code <= 395) return CloudLightning;
  return Thermometer;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function WeatherWidget({ location, temp_c, temp_f, feelsLike_c, condition, conditionCode, humidity, windSpeed_kmh, windDir, isDay, forecast, onClose }: WeatherWidgetProps) {
  const [unit, setUnit] = useState<'C' | 'F'>('C');

  return (
    <div className="relative mt-3 rounded-2xl border border-border/40 bg-background/60 backdrop-blur-sm p-4 shadow-lg w-full max-w-sm">
      {onClose && (
        <button onClick={onClose} className="absolute top-3 right-3 p-1 rounded-full hover:bg-muted/50 text-muted-foreground/50 hover:text-foreground transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Header */}
      <div className="flex items-start gap-3">
         {(() => { const WeatherIcon = weatherIcon(conditionCode, isDay); return <WeatherIcon className="w-10 h-10 text-primary flex-shrink-0" strokeWidth={1.5} />; })()}
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-mono tracking-widest text-muted-foreground/50 uppercase truncate">{location}</p>
          <div className="flex items-baseline gap-1.5">
            <span className="text-4xl font-display font-bold text-foreground tabular-nums">
              {unit === 'C' ? Math.round(temp_c) : Math.round(temp_f)}°
            </span>
            <button
              onClick={() => setUnit(u => u === 'C' ? 'F' : 'C')}
              className="text-xs font-mono text-muted-foreground/50 hover:text-primary transition-colors px-1 py-0.5 rounded border border-border/30"
            >
              {unit}
            </button>
          </div>
          <p className="text-sm text-muted-foreground/70 font-sans">{condition}</p>
        </div>
      </div>

      {/* Stats row */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="flex flex-col items-center p-2 rounded-xl bg-card/40 border border-border/20">
          <Thermometer className="w-3.5 h-3.5 text-primary/70 mb-0.5" />
          <span className="text-[11px] font-mono text-foreground/80 tabular-nums">
            {unit === 'C' ? `${Math.round(feelsLike_c)}°C` : `${Math.round(feelsLike_c * 9/5 + 32)}°F`}
          </span>
          <span className="text-[9px] font-mono text-muted-foreground/40 tracking-wider">Feels like</span>
        </div>
        <div className="flex flex-col items-center p-2 rounded-xl bg-card/40 border border-border/20">
          <Droplets className="w-3.5 h-3.5 text-blue-400/70 mb-0.5" />
          <span className="text-[11px] font-mono text-foreground/80 tabular-nums">{humidity}%</span>
          <span className="text-[9px] font-mono text-muted-foreground/40 tracking-wider">Humidity</span>
        </div>
        <div className="flex flex-col items-center p-2 rounded-xl bg-card/40 border border-border/20">
          <Wind className="w-3.5 h-3.5 text-green-400/70 mb-0.5" />
          <span className="text-[11px] font-mono text-foreground/80 tabular-nums">{Math.round(windSpeed_kmh)}<span className="text-[9px]">km/h</span></span>
          <span className="text-[9px] font-mono text-muted-foreground/40 tracking-wider">{windDir}</span>
        </div>
      </div>

      {/* Forecast */}
      {forecast.length > 0 && (
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
          {forecast.slice(0, 5).map((f, i) => (
            <div key={i} className="flex-shrink-0 flex flex-col items-center p-2 rounded-xl bg-card/30 border border-border/20 min-w-[58px]">
              <span className="text-[9px] font-mono text-muted-foreground/50 tracking-wider truncate">{i === 0 ? 'Today' : formatDate(f.date)}</span>
               {(() => { const WeatherIcon = weatherIcon(f.conditionCode, true); return <WeatherIcon className="w-5 h-5 mt-0.5 text-primary" strokeWidth={1.5} />; })()}
              <span className="text-[11px] font-mono text-foreground/80 tabular-nums">{Math.round(unit === 'C' ? f.maxTemp_c : f.maxTemp_c * 9/5 + 32)}°</span>
              <span className="text-[10px] font-mono text-muted-foreground/40 tabular-nums">{Math.round(unit === 'C' ? f.minTemp_c : f.minTemp_c * 9/5 + 32)}°</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
