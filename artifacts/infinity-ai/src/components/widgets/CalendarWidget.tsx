import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;    // ISO datetime or YYYY-MM-DD for allDay
  end?: string;
  allDay: boolean;
  calendarName?: string;
}

interface CalendarWidgetProps {
  events: CalendarEvent[];
  weekStart: string; // ISO YYYY-MM-DD (Monday)
  onClose?: () => void;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 17 }, (_, i) => i + 7); // 7am-11pm
const SLOT_H = 48; // px per hour

const EVENT_COLORS = [
  'bg-primary/20 border-primary/50 text-primary',
  'bg-blue-500/20 border-blue-500/50 text-blue-400',
  'bg-purple-500/20 border-purple-500/50 text-purple-400',
  'bg-green-500/20 border-green-500/50 text-green-400',
  'bg-orange-500/20 border-orange-500/50 text-orange-400',
];

function isoToDate(iso: string): Date {
  // Handle both "YYYY-MM-DD" (all-day) and full ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return new Date(iso + 'T00:00:00');
  return new Date(iso);
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

export function CalendarWidget({ events, weekStart, onClose }: CalendarWidgetProps) {
  const [currentWeekStart, setCurrentWeekStart] = useState(weekStart);

  const weekDays = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i)), [currentWeekStart]);

  const today = dateKey(new Date());
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // Assign colors per calendar name
  const calColors = useMemo(() => {
    const map = new Map<string, string>();
    let idx = 0;
    for (const e of events) {
      const key = e.calendarName ?? 'default';
      if (!map.has(key)) map.set(key, EVENT_COLORS[idx++ % EVENT_COLORS.length]);
    }
    return map;
  }, [events]);

  function eventColor(e: CalendarEvent): string {
    return calColors.get(e.calendarName ?? 'default') ?? EVENT_COLORS[0];
  }

  // Group all-day events by day
  const allDayByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const day of weekDays) map.set(day, []);
    for (const e of events) {
      if (!e.allDay) continue;
      const start = isoToDate(e.start);
      const end = e.end ? isoToDate(e.end) : start;
      for (const day of weekDays) {
        const dayDate = new Date(day + 'T00:00:00');
        if (dayDate >= start && dayDate < end || dateKey(start) === day) {
          map.get(day)?.push(e);
        }
      }
    }
    return map;
  }, [events, weekDays]);

  // Group timed events by day
  const timedByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const day of weekDays) map.set(day, []);
    for (const e of events) {
      if (e.allDay) continue;
      const dayKey = dateKey(isoToDate(e.start));
      if (map.has(dayKey)) map.get(dayKey)?.push(e);
    }
    return map;
  }, [events, weekDays]);

  function eventTop(e: CalendarEvent): number {
    const start = isoToDate(e.start);
    const mins = start.getHours() * 60 + start.getMinutes();
    return ((mins - 7 * 60) / 60) * SLOT_H;
  }

  function eventHeight(e: CalendarEvent): number {
    if (!e.end) return SLOT_H;
    const start = isoToDate(e.start);
    const end = isoToDate(e.end);
    const durationMins = (end.getTime() - start.getTime()) / 60000;
    return Math.max(SLOT_H / 4, (durationMins / 60) * SLOT_H);
  }

  function formatEventTime(e: CalendarEvent): string {
    const d = isoToDate(e.start);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  const totalH = HOURS.length * SLOT_H;

  return (
    <div className="relative mt-3 rounded-2xl border border-border/40 bg-background/70 backdrop-blur-sm shadow-lg w-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <button onClick={() => setCurrentWeekStart(addDays(currentWeekStart, -7))}
          className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-xs font-display tracking-widest text-muted-foreground/70 uppercase">
          {new Date(currentWeekStart + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => setCurrentWeekStart(addDays(currentWeekStart, 7))}
            className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
          {onClose && (
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted/50 text-muted-foreground/50 hover:text-foreground transition-colors ml-1">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Day headers */}
      <div className="grid border-b border-border/20" style={{ gridTemplateColumns: '36px repeat(7, 1fr)' }}>
        <div /> {/* time gutter */}
        {weekDays.map((day, i) => {
          const d = new Date(day + 'T00:00:00');
          const isToday = day === today;
          return (
            <div key={day} className="text-center py-2 px-1 border-l border-border/10 first:border-l-0">
              <p className="text-[9px] font-mono tracking-wider text-muted-foreground/50 uppercase">{DAYS[i]}</p>
              <div className={`mx-auto w-7 h-7 flex items-center justify-center rounded-full text-sm font-display font-bold mt-0.5 ${
                isToday ? 'bg-primary text-primary-foreground' : 'text-foreground/70'
              }`}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* All-day events row */}
      <div className="grid border-b border-border/20 min-h-[28px]" style={{ gridTemplateColumns: '36px repeat(7, 1fr)' }}>
        <div className="text-[8px] font-mono text-muted-foreground/30 px-1 py-1 leading-none text-right">all-day</div>
        {weekDays.map(day => (
          <div key={day} className="border-l border-border/10 first:border-l-0 p-0.5 space-y-0.5">
            {allDayByDay.get(day)?.map(e => (
              <div key={e.id} className={`text-[9px] font-mono px-1.5 py-0.5 rounded border truncate ${eventColor(e)}`}>
                {e.title}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Time grid */}
      <div className="overflow-y-auto" style={{ maxHeight: '360px' }}>
        <div className="grid relative" style={{ gridTemplateColumns: '36px repeat(7, 1fr)', height: `${totalH}px` }}>
          {/* Hour labels */}
          <div className="relative">
            {HOURS.map(h => (
              <div key={h} className="absolute w-full pr-1 text-right" style={{ top: `${(h - 7) * SLOT_H - 6}px` }}>
                <span className="text-[9px] font-mono text-muted-foreground/30">
                  {h % 12 || 12}{h < 12 || h === 0 ? 'a' : 'p'}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {weekDays.map(day => {
            const isToday = day === today;
            const dayEvents = timedByDay.get(day) ?? [];
            const todayNowTop = ((nowMinutes - 7 * 60) / 60) * SLOT_H;

            return (
              <div key={day} className="relative border-l border-border/10 first:border-l-0">
                {/* Hour lines */}
                {HOURS.map(h => (
                  <div key={h} className="absolute left-0 right-0 border-t border-border/10" style={{ top: `${(h - 7) * SLOT_H}px` }} />
                ))}

                {/* "Now" line */}
                {isToday && nowMinutes >= 7 * 60 && nowMinutes <= 23 * 60 && (
                  <div className="absolute left-0 right-0 z-20 flex items-center" style={{ top: `${todayNowTop}px` }}>
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 -ml-0.5 flex-shrink-0" />
                    <div className="flex-1 h-px bg-red-500/70" />
                  </div>
                )}

                {/* Events */}
                {dayEvents.map(e => {
                  const top = eventTop(e);
                  const height = eventHeight(e);
                  if (top < 0 || top > totalH) return null;
                  return (
                    <div key={e.id}
                      className={`absolute left-0.5 right-0.5 rounded-lg border px-1.5 py-0.5 overflow-hidden z-10 ${eventColor(e)}`}
                      style={{ top: `${top}px`, height: `${height}px` }}
                    >
                      <p className="text-[10px] font-mono font-bold leading-tight truncate">{e.title}</p>
                      {height > 28 && <p className="text-[9px] font-mono opacity-70 leading-tight">{formatEventTime(e)}</p>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
