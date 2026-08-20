import React, { useState, useCallback, useMemo } from 'react';
import { ChatView } from '@/components/views/ChatView';
import { useI18n } from '@/lib/i18n';
import type { ChatMessage } from '@/components/conversation-feed';
import type { Widget } from '@/types/widget';

/**
 * Chat Demo Page — Shows the chat view with side menu and multiple widget states.
 * This demonstrates the Phase 14 Responsive UI Redesign with:
 * - Side menu navigation (desktop sidebar + mobile drawer)
 * - Chat view with multiple widget states (widget-1, widget-2, etc.)
 * - Liquid Glass design system
 * - Mobile/desktop responsive behavior
 */

// Sample conversations for the sidebar
const SAMPLE_CONVERSATIONS = [
  { id: 'conv-1', title: 'Project planning with widgets', updatedAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(), snippet: 'Discussing the new feature roadmap...' },
  { id: 'conv-2', title: 'Weather widget integration', updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), snippet: 'Added weather widget with multiple locations...' },
  { id: 'conv-3', title: 'Deep research on AI trends', updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), snippet: 'Research report on LLM developments...' },
  { id: 'conv-4', title: 'Promo video creation', updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), snippet: 'Created promo for the new launch...' },
  { id: 'conv-5', title: 'Maps widget for location search', updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(), snippet: 'Finding coffee shops nearby...' },
];

// Sample widgets to demonstrate widget-1, widget-2, etc.
// Using the correct types from '@/types/widget'
const SAMPLE_WIDGETS: Widget[] = [
  // Widget 1: Clock with multiple timezones
  {
    type: 'clock',
    timezones: [
      { label: 'San Francisco', tz: 'America/Los_Angeles' },
      { label: 'New York', tz: 'America/New_York' },
      { label: 'London', tz: 'Europe/London' },
      { label: 'Tokyo', tz: 'Asia/Tokyo' },
    ],
  },
  // Widget 2: Weather
  {
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
    ],
  },
  // Widget 3: Timer
  {
    type: 'timer',
    durationSeconds: 1500,
    label: 'Focus Session',
  },
  // Widget 4: Alarm
  {
    type: 'alarm',
    time: '07:30',
    label: 'Morning Standup',
  },
  // Widget 5: Calendar
  {
    type: 'calendar',
    events: [
      { id: 'evt-1', title: 'Team Sync', start: new Date(Date.now() + 1000 * 60 * 60).toISOString(), end: new Date(Date.now() + 1000 * 60 * 60 * 1.5).toISOString(), allDay: false, calendarName: 'Work' },
      { id: 'evt-2', title: 'Design Review', start: new Date(Date.now() + 1000 * 60 * 60 * 3).toISOString(), end: new Date(Date.now() + 1000 * 60 * 60 * 4).toISOString(), allDay: false, calendarName: 'Work' },
      { id: 'evt-3', title: 'Sprint Planning', start: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(), end: new Date(Date.now() + 1000 * 60 * 60 * 25).toISOString(), allDay: false, calendarName: 'Work' },
    ],
    weekStart: '1',
  },
  // Widget 6: Calculator
  {
    type: 'calculator',
    expression: '25 * 4 + 100 / 2',
    result: '150',
  },
  // Widget 7: Unit Converter
  {
    type: 'unit',
    value: 100,
    fromUnit: 'km',
    toUnit: 'mi',
    category: 'distance',
    label: 'Distance Conversion',
  },
  // Widget 8: Currency
  {
    type: 'currency',
    from: 'USD',
    to: 'EUR',
    amount: 100,
    rate: 0.92,
    updated: new Date().toISOString(),
  },
  // Widget 9: Maps
  {
    type: 'maps',
    center: { lat: 37.7749, lon: -122.4194 },
    displayName: 'San Francisco',
    radius: 2000,
    categories: ['food', 'coffee'],
    query: 'coffee shops near me',
    useUserLocation: false,
  },
  // Widget 10: Random
  {
    type: 'random',
    kind: 'number',
    value: 42,
    label: 'Lucky Number',
  },
];

// Sample messages with various widgets to demonstrate widget states
const SAMPLE_MESSAGES: ChatMessage[] = [
  {
    id: 'msg-1',
    role: 'user',
    content: 'Show me the current time in multiple timezones',
    timestamp: Date.now() - 1000 * 60 * 10,
  },
  {
    id: 'msg-2',
    role: 'assistant',
    content: 'Here\'s the current time across major timezones:',
    widget: SAMPLE_WIDGETS[0], // Clock widget
    timestamp: Date.now() - 1000 * 60 * 9,
  },
  {
    id: 'msg-3',
    role: 'user',
    content: 'What\'s the weather like in San Francisco?',
    timestamp: Date.now() - 1000 * 60 * 8,
  },
  {
    id: 'msg-4',
    role: 'assistant',
    content: 'Current weather in San Francisco:',
    widget: SAMPLE_WIDGETS[1], // Weather widget
    timestamp: Date.now() - 1000 * 60 * 7,
  },
  {
    id: 'msg-5',
    role: 'user',
    content: 'Set a timer for 25 minutes for a focus session',
    timestamp: Date.now() - 1000 * 60 * 6,
  },
  {
    id: 'msg-6',
    role: 'assistant',
    content: 'Timer set for 25 minutes:',
    widget: SAMPLE_WIDGETS[2], // Timer widget
    timestamp: Date.now() - 1000 * 60 * 5,
  },
  {
    id: 'msg-7',
    role: 'user',
    content: 'Calculate 25 * 4 + 100 / 2',
    timestamp: Date.now() - 1000 * 60 * 4,
  },
  {
    id: 'msg-8',
    role: 'assistant',
    content: 'The result is:',
    widget: SAMPLE_WIDGETS[5], // Calculator widget
    timestamp: Date.now() - 1000 * 60 * 3,
  },
  {
    id: 'msg-9',
    role: 'user',
    content: 'Convert 100 kilometers to miles',
    timestamp: Date.now() - 1000 * 60 * 2,
  },
  {
    id: 'msg-10',
    role: 'assistant',
    content: '100 kilometers equals:',
    widget: SAMPLE_WIDGETS[6], // Unit converter widget
    timestamp: Date.now() - 1000 * 60 * 1,
  },
  {
    id: 'msg-11',
    role: 'user',
    content: 'Find coffee shops near me in San Francisco',
    timestamp: Date.now(),
  },
  {
    id: 'msg-12',
    role: 'assistant',
    content: 'Here are coffee shops near San Francisco:',
    widget: SAMPLE_WIDGETS[8], // Maps widget
    timestamp: Date.now() + 1000,
  },
];

export function ChatDemoPage() {
  const { t } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>(SAMPLE_MESSAGES);
  const [activeConversationId, setActiveConversationId] = useState<string | null>('conv-1');
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [status, setStatus] = useState<'idle' | 'thinking' | 'transcribing' | 'recording' | 'wake' | 'speaking'>('idle');
  const [suggestions, setSuggestions] = useState<string[]>([
    'Show me the weather in Tokyo',
    'Set a timer for 10 minutes',
    'Calculate 15% tip on $87',
    'Find restaurants nearby',
    'Start deep research on AI',
  ]);

  const handleSend = useCallback((text: string) => {
    setIsBusy(true);
    setStatus('thinking');

    // Add user message
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);

    // Simulate assistant response with a widget
    setTimeout(() => {
      const widgetIndex = messages.length % SAMPLE_WIDGETS.length;
      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now() + 1}`,
        role: 'assistant',
        content: `Here's the result for: "${text}"`,
        widget: SAMPLE_WIDGETS[widgetIndex],
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, assistantMsg]);
      setIsBusy(false);
      setStatus('idle');
    }, 1000);
  }, [messages.length]);

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setActiveConversationId(null);
    setSuggestions([
      'Show me the weather in Tokyo',
      'Set a timer for 10 minutes',
      'Calculate 15% tip on $87',
      'Find restaurants nearby',
      'Start deep research on AI',
    ]);
  }, []);

  const handleSelectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
    // In a real app, this would load the conversation from the server
    setMessages(SAMPLE_MESSAGES);
  }, []);

  const handleToggleThinking = useCallback(() => {
    setThinkingEnabled(prev => !prev);
  }, []);

  const handleToggleWebSearch = useCallback(() => {
    setWebSearchEnabled(prev => !prev);
  }, []);

  const handleSuggestionClick = useCallback((text: string) => {
    handleSend(text);
  }, [handleSend]);

  const handleDeepResearchExpert = useCallback((conversationId: string) => {
    console.log('Create expert for conversation:', conversationId);
  }, []);

  return (
    <div className="h-dvh flex flex-col">
      <ChatView
        messages={messages}
        onSend={handleSend}
        onNewChat={handleNewChat}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        isBusy={isBusy}
        thinkingEnabled={thinkingEnabled}
        webSearchEnabled={webSearchEnabled}
        onToggleThinking={handleToggleThinking}
        onToggleWebSearch={handleToggleWebSearch}
        suggestions={suggestions}
        onSuggestionClick={handleSuggestionClick}
        onDeepResearchExpert={handleDeepResearchExpert}
        status={status}
      />
    </div>
  );
}

export default ChatDemoPage;