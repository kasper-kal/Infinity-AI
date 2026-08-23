import React, { useState, useMemo } from 'react';
import { useI18n } from '@/lib/i18n';
import {
  ClockWidget,
  WeatherWidget,
  TimerWidget,
  AlarmWidget,
  CalendarWidget,
  CalculatorWidget,
  DefineWidget,
  UnitConverterWidget,
  CurrencyWidget,
  MapWidget,
  MapsWidget,
  RandomWidget,
  MusicWidget,
  ImageResultsWidget,
  DateWidget,
  BrowserWidget,
  PromoWidget,
  DeepResearchWidget,
} from '@/components/widgets';
import type { Widget } from '@/types/widget';
import { Button, ButtonGroup } from '@/components/ui/Button';
import { Card } from '@/components/ui';
import { ScrollArea } from '@/components/ui/scroll-area';

/**
 * Widget Showcase Page — Demonstrates all widget types (widget-1, widget-2, etc.)
 * This page shows all the widget components in a gallery view.
 */

const WIDGET_DEMOS: { name: string; widget: Widget; description: string }[] = [
  {
    name: 'Widget 1: Clock',
    widget: {
      type: 'clock',
      timezones: [
        { label: 'San Francisco', tz: 'America/Los_Angeles' },
        { label: 'New York', tz: 'America/New_York' },
        { label: 'London', tz: 'Europe/London' },
        { label: 'Tokyo', tz: 'Asia/Tokyo' },
        { label: 'Sydney', tz: 'Australia/Sydney' },
      ],
    },
    description: 'Multi-timezone clock with automatic DST handling',
  },
  {
    name: 'Widget 2: Weather',
    widget: {
      type: 'weather',
      location: 'San Francisco, CA',
      temp_c: 18,
      temp_f: 64,
      feelsLike_c: 17,
      condition: 'Partly Cloudy',
      conditionCode: 1003,
      humidity: 65,
      windSpeed_kmh: 12,
      windDir: 'W',
      isDay: true,
      forecast: [
        { date: '2026-08-20', maxTemp_c: 20, minTemp_c: 14, condition: 'Partly Cloudy', conditionCode: 1003 },
        { date: '2026-08-21', maxTemp_c: 22, minTemp_c: 15, condition: 'Sunny', conditionCode: 1000 },
        { date: '2026-08-22', maxTemp_c: 19, minTemp_c: 13, condition: 'Light Rain', conditionCode: 1063 },
        { date: '2026-08-23', maxTemp_c: 21, minTemp_c: 14, condition: 'Cloudy', conditionCode: 1006 },
        { date: '2026-08-24', maxTemp_c: 23, minTemp_c: 16, condition: 'Sunny', conditionCode: 1000 },
      ],
    },
    description: 'Current weather + 5-day forecast with details',
  },
  {
    name: 'Widget 3: Timer',
    widget: {
      type: 'timer',
      durationSeconds: 1500,
      label: 'Focus Session',
    },
    description: 'Countdown timer with progress ring and controls',
  },
  {
    name: 'Widget 4: Alarm',
    widget: {
      type: 'alarm',
      time: '07:30',
      label: 'Morning Standup',
    },
    description: 'Alarm display with time and label',
  },
  {
    name: 'Widget 5: Calendar',
    widget: {
      type: 'calendar',
      events: [
        { id: 'evt-1', title: 'Team Sync', start: new Date(Date.now() + 1000 * 60 * 60).toISOString(), end: new Date(Date.now() + 1000 * 60 * 60 * 1.5).toISOString(), allDay: false, calendarName: 'Work' },
        { id: 'evt-2', title: 'Design Review', start: new Date(Date.now() + 1000 * 60 * 60 * 3).toISOString(), end: new Date(Date.now() + 1000 * 60 * 60 * 4).toISOString(), allDay: false, calendarName: 'Work' },
        { id: 'evt-3', title: 'Sprint Planning', start: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(), end: new Date(Date.now() + 1000 * 60 * 60 * 25).toISOString(), allDay: false, calendarName: 'Work' },
        { id: 'evt-4', title: '1:1 with Manager', start: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString(), end: new Date(Date.now() + 1000 * 60 * 60 * 49).toISOString(), allDay: false, calendarName: 'Personal' },
      ],
      weekStart: '1',
    },
    description: 'Weekly calendar view with event blocks',
  },
  {
    name: 'Widget 6: Calculator',
    widget: {
      type: 'calculator',
      expression: '(25 * 4) + (100 / 2) - 10',
      result: '140',
    },
    description: 'Expression evaluation with result display',
  },
  {
    name: 'Widget 7: Define',
    widget: {
      type: 'define',
      word: 'serendipity',
      phonetic: '/ˌser.ənˈdɪp.ə.ti/',
      meanings: [
        { partOfSpeech: 'noun', definition: 'The occurrence and development of events by chance in a happy or beneficial way.', example: 'It was pure serendipity that we met again.' },
        { partOfSpeech: 'noun', definition: 'A fortunate accident or pleasant surprise.', example: 'Finding the book was pure serendipity.' },
      ],
    },
    description: 'Dictionary definition with phonetics and examples',
  },
  {
    name: 'Widget 8: Unit Converter',
    widget: {
      type: 'unit',
      value: 100,
      fromUnit: 'km',
      toUnit: 'mi',
      category: 'distance',
      label: 'Distance Conversion',
    },
    description: 'Unit conversion across multiple categories',
  },
  {
    name: 'Widget 9: Currency',
    widget: {
      type: 'currency',
      from: 'USD',
      to: 'EUR',
      amount: 100,
      rate: 0.92,
      updated: new Date().toISOString(),
    },
    description: 'Real-time currency conversion with rate',
  },
  {
    name: 'Widget 10: Map (Single Location)',
    widget: {
      type: 'map',
      query: 'Golden Gate Bridge',
      lat: 37.8199,
      lon: -122.4783,
      displayName: 'Golden Gate Bridge, San Francisco',
    },
    description: 'Single location map with marker',
  },
  {
    name: 'Widget 11: Maps (Places Search)',
    widget: {
      type: 'maps',
      center: { lat: 37.7749, lon: -122.4194 },
      displayName: 'San Francisco',
      radius: 2000,
      categories: ['food', 'coffee', 'bar'],
      query: 'coffee shops near me',
      useUserLocation: false,
    },
    description: 'Interactive map with place search and clustering',
  },
  {
    name: 'Widget 12: Random',
    widget: {
      type: 'random',
      kind: 'number',
      value: 42,
      label: 'Lucky Number',
    },
    description: 'Random number/color/uuid/password generator',
  },
  {
    name: 'Widget 13: Music',
    widget: {
      type: 'music',
      composition: {
        title: 'Demo Composition',
        mood: 'happy',
        tempo: 120,
        root: 'C',
        scale: [0, 2, 4, 5, 7, 9, 11],
        chords: ['C', 'G', 'Am', 'F'],
        bass: ['C', 'G', 'A', 'F'],
        melody: [
          { note: 'C4', dur: 0.5, time: 0 },
          { note: 'E4', dur: 0.5, time: 0.5 },
          { note: 'G4', dur: 0.5, time: 1 },
          { note: 'C5', dur: 0.5, time: 1.5 },
        ],
        drumPattern: [1, 0, 1, 0, 1, 0, 1, 0],
      },
    },
    description: 'Music composition with multi-track playback',
  },
  {
    name: 'Widget 14: Image Results',
    widget: {
      type: 'images',
      query: 'sunset over mountains',
      results: [
        { url: 'https://picsum.photos/seed/sunset1/400/300', thumbnail: 'https://picsum.photos/seed/sunset1/200/150', title: 'Sunset 1', source: 'picsum.photos', creator: 'Demo', license: 'CC0', width: 400, height: 300 },
        { url: 'https://picsum.photos/seed/sunset2/400/300', thumbnail: 'https://picsum.photos/seed/sunset2/200/150', title: 'Sunset 2', source: 'picsum.photos', creator: 'Demo', license: 'CC0', width: 400, height: 300 },
        { url: 'https://picsum.photos/seed/sunset3/400/300', thumbnail: 'https://picsum.photos/seed/sunset3/200/150', title: 'Sunset 3', source: 'picsum.photos', creator: 'Demo', license: 'CC0', width: 400, height: 300 },
        { url: 'https://picsum.photos/seed/sunset4/400/300', thumbnail: 'https://picsum.photos/seed/sunset4/200/150', title: 'Sunset 4', source: 'picsum.photos', creator: 'Demo', license: 'CC0', width: 400, height: 300 },
      ],
    },
    description: 'Image search results grid',
  },
  {
    name: 'Widget 15: Date',
    widget: { type: 'date' },
    description: 'Current date with formatting options',
  },
  {
    name: 'Widget 16: Browser Agent',
    widget: {
      type: 'browser_agent',
      goal: 'Navigate to github.com and find the most starred React repository',
    },
    description: 'Live browser automation with screenshot streaming',
  },
  {
    name: 'Widget 17: Promo Maker',
    widget: {
      type: 'promo',
      jobId: 'promo-demo-123',
      status: 'completed',
      progress: 100,
      videoUrl: 'https://example.com/promo.mp4',
      thumbnailUrl: 'https://picsum.photos/seed/promo/640/360',
    },
    description: 'AI-generated promotional video with timeline',
  },
  {
    name: 'Widget 18: Deep Research',
    widget: {
      type: 'deep_research',
      jobId: 'research-demo-456',
      topic: 'Latest developments in LLM architectures',
      phase: 'completed',
      progress: 100,
      sourcesFound: 25,
      pagesRead: 12,
      report: {
        executiveSummary: 'Recent advances in LLM architectures include transformer variants, mixture-of-experts, and retrieval-augmented generation.',
        sections: [
          { heading: 'Transformer Variants', content: 'New attention mechanisms improve efficiency...', citations: [1, 2] },
          { heading: 'Mixture of Experts', content: 'MoE models scale parameters efficiently...', citations: [3, 4] },
        ],
        gapsAndLimitations: 'Long-context evaluation remains challenging.',
        confidenceScore: 0.87,
        sourceCount: 25,
      },
    },
    description: 'Deep research report with citations and sources',
  },
];

function WidgetCard({ name, widget, description }: { name: string; widget: Widget; description: string }) {
  return (
    <Card className="h-full flex flex-col">
      <div className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold text-foreground">{name}</h3>
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        </div>
        <div className="flex-1 min-h-[200px] border border-border/30 rounded-lg overflow-hidden">
          <InlineWidget widget={widget} />
        </div>
      </div>
    </Card>
  );
}

function InlineWidget({ widget }: { widget: Widget }) {
  switch (widget.type) {
    case 'clock':
      return <ClockWidget timezones={widget.timezones} />;
    case 'weather':
      return <WeatherWidget {...widget} />;
    case 'timer':
      return <TimerWidget durationSeconds={widget.durationSeconds} label={widget.label} />;
    case 'alarm':
      return <AlarmWidget time={widget.time} label={widget.label} />;
    case 'calendar':
      return <CalendarWidget events={widget.events} weekStart={widget.weekStart} />;
    case 'calculator':
      return <CalculatorWidget expression={widget.expression} result={widget.result} />;
    case 'define':
      return <DefineWidget word={widget.word} phonetic={widget.phonetic} meanings={widget.meanings} />;
    case 'unit':
      return <UnitConverterWidget value={widget.value} fromUnit={widget.fromUnit} toUnit={widget.toUnit} category={widget.category} label={widget.label} />;
    case 'currency':
      return <CurrencyWidget from={widget.from} to={widget.to} amount={widget.amount} rate={widget.rate} updated={widget.updated} />;
    case 'map':
      return <MapWidget query={widget.query} lat={widget.lat} lon={widget.lon} displayName={widget.displayName} />;
    case 'maps':
      return <MapsWidget
        center={widget.center}
        displayName={widget.displayName}
        radius={widget.radius}
        categories={widget.categories}
        query={widget.query}
        useUserLocation={widget.useUserLocation}
      />;
    case 'random':
      return <RandomWidget kind={widget.kind} value={widget.value} label={widget.label} />;
    case 'music':
      return <MusicWidget composition={widget.composition} />;
    case 'images':
      return <ImageResultsWidget query={widget.query} results={widget.results} />;
    case 'date':
      return <DateWidget />;
    case 'browser_agent':
      return <BrowserWidget goal={widget.goal} />;
    case 'promo':
      return <PromoWidget
        jobId={widget.jobId}
        status={widget.status}
        progress={widget.progress}
        videoUrl={widget.videoUrl}
        thumbnailUrl={widget.thumbnailUrl}
      />;
    case 'deep_research':
      return <DeepResearchWidget
        widget={widget}
        onClose={() => {}}
        onCreateExpert={() => {}}
      />;
    default:
      return <div className="flex items-center justify-center h-full text-muted-foreground">Unknown widget</div>;
  }
}

export function WidgetShowcasePage() {
  const { t } = useI18n();
  const [filter, setFilter] = useState('all');

  const filteredWidgets = useMemo(() => {
    if (filter === 'all') return WIDGET_DEMOS;
    return WIDGET_DEMOS.filter(w => w.name.toLowerCase().includes(filter.toLowerCase()));
  }, [filter]);

  return (
    <div className="h-dvh flex flex-col bg-background">
      {/* Header */}
      <header className="border-b border-border/30 bg-background/80 backdrop-blur-xl sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-display font-bold tracking-tight">Widget Showcase</h1>
              <p className="text-sm text-muted-foreground mt-0.5">All widget types (widget-1 through widget-18) in the Infinity design system</p>
            </div>
            <div className="relative">
              <input
                type="text"
                placeholder={t('widgetShowcase.filterPlaceholder')}
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="w-64 bg-secondary/50 border border-transparent focus:border-border/60 text-foreground placeholder:text-muted-foreground/50 text-sm pl-9 pr-4 py-2 font-rounded rounded-full outline-none transition-all"
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
        </div>
      </header>

      {/* Widget Grid */}
      <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
        <ScrollArea className="h-full">
          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredWidgets.map((demo, index) => (
                <WidgetCard key={demo.name} name={demo.name} widget={demo.widget} description={demo.description} />
              ))}
            </div>
            {filteredWidgets.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <p>No widgets match "{filter}"</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </main>
    </div>
  );
}

export default WidgetShowcasePage;