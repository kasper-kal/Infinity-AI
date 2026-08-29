/**
 * LivePreview Component
 *
 * Sandbox iframe with React 18 + Tailwind + shadcn/ui preloaded.
 * Features: HMR, console/error overlay, responsive viewport controls, code/preview split view.
 * Phase 18: CommentOverlay integration for element-level commenting.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui';
import { Select, SelectItem, SelectTrigger, SelectContent, SelectValue } from '@/components/ui/select';
import { Tabs } from '@/components/ui/Tabs';
import { Separator, Badge } from '@/components/ui';
import { Loader2, X, Maximize2, Minimize2, Bug, Terminal, Smartphone, Tablet, Monitor, RefreshCw, Copy, Download, MousePointer, Code, ChevronUp, ChevronDown, Users, UserPlus, UserMinus, Grip, PanelLeft, PanelRight, Maximize } from 'lucide-react';
import { CommentOverlay, type Comment, type CommentElementData } from './CommentOverlay';
import { DeviceFrame, type DeviceKind } from './DeviceFrame';

interface LivePreviewProps {
  /** Generated components to preview */
  components: Array<{
    name: string;
    code: string;
    imports?: string[];
  }>;
  /** Framework for the preview */
  framework?: 'nextjs' | 'vite' | 'astro' | 'remix';
  /** Initial viewport size */
  initialViewport?: 'mobile' | 'tablet' | 'desktop';
  /** Callback when preview updates */
  onUpdate?: (html: string) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
  /** Class name for container */
  className?: string;
  /** Ref to the iframe element */
  ref?: React.Ref<HTMLIFrameElement>;
  /** Phase 18: Comment overlay props */
  shareToken?: string;
  comments?: Comment[];
  selectedCommentId?: string;
  onSelectComment?: (commentId: string) => void;
  onAddComment?: (selector: string, elementData: CommentElementData, content: string, mentions?: string[]) => Promise<void>;
  onReply?: (parentId: string, content: string, mentions?: string[]) => Promise<void>;
  onResolve?: (commentId: string, resolved: boolean) => Promise<void>;
  onReact?: (commentId: string, emoji: string) => Promise<void>;
  onDelete?: (commentId: string) => Promise<void>;
  currentUser?: { name: string; email: string; avatar?: string };
  commentOverlayEnabled?: boolean;
  /** Phase 18: Presence cursor props */
  presenceEnabled?: boolean;
  onCursorUpdate?: (x: number, y: number, selector?: string, elementData?: { tagName: string; className?: string }) => Promise<void>;
  onSelectionUpdate?: (selector: string, elementData?: { tagName: string; className?: string; bounds?: DOMRect }) => Promise<void>;
  presenceUsers?: PresenceUser[];
}

// Phase 18: Presence cursor types
export interface PresenceUser {
  email: string;
  name: string;
  avatar?: string;
  cursor?: { x: number; y: number; selector?: string };
  selection?: { selector: string; elementData?: { tagName: string; className?: string; bounds?: DOMRect } };
  lastActive: Date;
  isCurrentUser?: boolean;
}

// Device Preview Modes
const DEVICE_MODES = {
  'iphone-16-pro': {
    width: 393,
    height: 852,
    label: 'iPhone 16 Pro',
    icon: Smartphone,
    kind: 'iphone-16-pro' as DeviceKind,
    showChrome: true,
  },
  desktop: {
    width: 1440,
    height: 900,
    label: 'Desktop',
    icon: Monitor,
    kind: 'desktop' as DeviceKind,
    showChrome: true,
  },
  freeform: {
    width: 393,
    height: 852,
    label: 'Freeform',
    icon: Maximize,
    kind: 'bare' as DeviceKind,
    showChrome: false,
  },
} as const;

type DeviceModeKey = keyof typeof DEVICE_MODES;

const TAILWIND_CDN = `
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            border: 'hsl(var(--border))',
            input: 'hsl(var(--input))',
            ring: 'hsl(var(--ring))',
            background: 'hsl(var(--background))',
            foreground: 'hsl(var(--foreground))',
            primary: {
              DEFAULT: 'hsl(var(--primary))',
              foreground: 'hsl(var(--primary-foreground))',
            },
            secondary: {
              DEFAULT: 'hsl(var(--secondary))',
              foreground: 'hsl(var(--secondary-foreground))',
            },
            destructive: {
              DEFAULT: 'hsl(var(--destructive))',
              foreground: 'hsl(var(--destructive-foreground))',
            },
            muted: {
              DEFAULT: 'hsl(var(--muted))',
              foreground: 'hsl(var(--muted-foreground))',
            },
            accent: {
              DEFAULT: 'hsl(var(--accent))',
              foreground: 'hsl(var(--accent-foreground))',
            },
            popover: {
              DEFAULT: 'hsl(var(--popover))',
              foreground: 'hsl(var(--popover-foreground))',
            },
            card: {
              DEFAULT: 'hsl(var(--card))',
              foreground: 'hsl(var(--card-foreground))',
            },
          },
          borderRadius: {
            lg: 'var(--radius)',
            md: 'calc(var(--radius) - 2px)',
            sm: 'calc(var(--radius) - 4px)',
          },
          fontFamily: {
            sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
          },
        },
      },
    };
  </script>
`;

const REACT_CDN = `
  <script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
`;

const SHADCN_UTILS = `
  const cn = (...classes) => classes.filter(Boolean).join(' ');
`;

const CSS_VARIABLES = `
  <style>
    :root {
      --background: 0 0% 100%;
      --foreground: 222.2 84% 4.9%;
      --card: 0 0% 100%;
      --card-foreground: 222.2 84% 4.9%;
      --popover: 0 0% 100%;
      --popover-foreground: 222.2 84% 4.9%;
      --primary: 221.2 83.2% 53.3%;
      --primary-foreground: 210 40% 98%;
      --secondary: 210 40% 96.1%;
      --secondary-foreground: 222.2 47.4% 11.2%;
      --muted: 210 40% 96.1%;
      --muted-foreground: 215.4 16.3% 46.9%;
      --accent: 210 40% 96.1%;
      --accent-foreground: 222.2 47.4% 11.2%;
      --destructive: 0 84.2% 60.2%;
      --destructive-foreground: 210 40% 98%;
      --border: 214.3 31.8% 91.4%;
      --input: 214.3 31.8% 91.4%;
      --ring: 221.2 83.2% 53.3%;
      --radius: 0.5rem;
      --font-sans: 'Inter', system-ui, sans-serif;
    }
    .dark {
      --background: 222.2 84% 4.9%;
      --foreground: 210 40% 98%;
      --card: 222.2 84% 4.9%;
      --card-foreground: 210 40% 98%;
      --popover: 222.2 84% 4.9%;
      --popover-foreground: 210 40% 98%;
      --primary: 217.2 91.2% 59.8%;
      --primary-foreground: 222.2 47.4% 11.2%;
      --secondary: 217.2 32.6% 17.5%;
      --secondary-foreground: 210 40% 98%;
      --muted: 217.2 32.6% 17.5%;
      --muted-foreground: 215 20.2% 65.1%;
      --accent: 217.2 32.6% 17.5%;
      --accent-foreground: 210 40% 98%;
      --destructive: 0 62.8% 30.6%;
      --destructive-foreground: 210 40% 98%;
      --border: 217.2 32.6% 17.5%;
      --input: 217.2 32.6% 17.5%;
      --ring: 224.3 76.3% 48%;
    }
    * { border-color: hsl(var(--border)); }
    body { @apply bg-background text-foreground; font-family: var(--font-sans); }
  </style>
`;

export const LivePreview = React.forwardRef<HTMLIFrameElement, LivePreviewProps>(({
  components,
  framework = 'nextjs',
  initialViewport = 'desktop',
  onUpdate,
  onError,
  className,
  // Phase 18: Comment overlay props
  shareToken,
  comments = [],
  selectedCommentId,
  onSelectComment,
  onAddComment,
  onReply,
  onResolve,
  onReact,
  onDelete,
  currentUser,
  commentOverlayEnabled = true,
  // Phase 18: Presence cursor props
  presenceEnabled = false,
  onCursorUpdate,
  onSelectionUpdate,
  presenceUsers = [],
}, forwardedRef) => {
  const [deviceMode, setDeviceMode] = useState<DeviceModeKey>(initialViewport as DeviceModeKey);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState<Array<{ type: 'log' | 'error' | 'warn'; message: string; timestamp: Date }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [activeTab, setActiveTabState] = useState<'preview' | 'console'>('preview');
const setActiveTab = (tabId: string) => {
  if (tabId === 'preview' || tabId === 'console') {
    setActiveTabState(tabId);
  }
};
  const [freeformScale, setFreeformScale] = useState(0.5);
  const [freeformPosition, setFreeformPosition] = useState({ x: 0, y: 0 });
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewKey = useRef(0);

  // Visual Inspector State
  const [isInspecting, setIsInspecting] = useState(false);
  const [hoveredElement, setHoveredElement] = useState<SelectedElement | null>(null);
  const [selectedElements, setSelectedElements] = useState<SelectedElement[]>([]);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Phase 18: Presence SSE State
  const presenceEventSource = useRef<EventSource | null>(null);
  const commentEventSource = useRef<EventSource | null>(null);
  const [remoteCursors, setRemoteCursors] = useState<Map<string, PresenceUser>>(new Map());
  const cursorThrottleRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const deviceConfig = DEVICE_MODES[deviceMode];

  // Forward ref to iframe
  React.useImperativeHandle(forwardedRef, () => iframeRef.current as HTMLIFrameElement, []);

  // Generate preview HTML
  const generatePreviewHTML = useCallback(() => {
    if (!components.length) return '';

    const componentCode = components.map(c => c.code).join('\n\n');
    const imports = components.flatMap(c => c.imports || []).filter((v, i, a) => a.indexOf(v) === i);

    // Transform imports for browser preview (remove external imports)
    const transformedImports = imports
      .filter(imp => !imp.startsWith('@/') && !imp.startsWith('./') && !imp.startsWith('../'))
      .map(imp => `import ${imp.split('/').pop()} from '${imp}';`)
      .join('\n');

    const componentDefinitions = components.map(c => {
      // Remove import statements
      const codeWithoutImports = c.code
        .split('\n')
        .filter(line => !line.trim().startsWith('import '))
        .join('\n');
      return codeWithoutImports;
    }).join('\n\n');

    const renderCode = components.map(c => `<${c.name} key="${c.name}" />`).join('\n        ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UI Preview - ${components.map(c => c.name).join(', ')}</title>
  ${TAILWIND_CDN}
  ${REACT_CDN}
  ${CSS_VARIABLES}
  <style>
    * { font-family: 'Inter', system-ui, sans-serif; box-sizing: border-box; }
    body { margin: 0; padding: 1.5rem; min-height: 100vh; background: hsl(var(--background)); color: hsl(var(--foreground)); }
    #root { width: 100%; }
    .preview-container { max-width: 100%; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="react,typescript">
    ${SHADCN_UTILS}
    ${transformedImports}

    ${componentDefinitions}

    const App = () => (
      <div className="preview-container space-y-8">
        ${renderCode}
      </div>
    );

    // Override console for capture
    const originalConsole = { ...console };
    ['log', 'error', 'warn'].forEach(method => {
      console[method] = (...args) => {
        originalConsole[method](...args);
        window.parent.postMessage({
          type: 'console',
          payload: { type: method, message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') }
        }, '*');
      };
    });

    // Handle errors
    window.addEventListener('error', (event) => {
      window.parent.postMessage({
        type: 'error',
        payload: { message: event.message, filename: event.filename, lineno: event.lineno, colno: event.colno }
      }, '*');
    });

    window.addEventListener('unhandledrejection', (event) => {
      window.parent.postMessage({
        type: 'error',
        payload: { message: event.reason?.message || String(event.reason) }
      }, '*');
    });

    try {
      const root = ReactDOM.createRoot(document.getElementById('root'));
      root.render(<App />);
      window.parent.postMessage({ type: 'ready' }, '*');
    } catch (e) {
      window.parent.postMessage({ type: 'error', payload: { message: e.message } }, '*');
    }
  </script>
</body></html>`;
  }, [components]);

  // Handle messages from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;

      const { type, payload } = event.data;

      switch (type) {
        case 'ready':
          setIsLoading(false);
          setPreviewError(null);
          // Inject inspection scripts on DOM ready
          injectInspectionScripts();
          break;

        case 'console':
          setConsoleLogs(prev => [...prev, {
            type: payload.type as 'log' | 'error' | 'warn',
            message: payload.message,
            timestamp: new Date(),
          }].slice(-100));
          break;

        case 'error':
          setPreviewError(payload.message);
          setConsoleLogs(prev => [...prev, {
            type: 'error' as const,
            message: payload.message,
            timestamp: new Date(),
          }].slice(-100));
          onError?.(new Error(payload.message));
          break;

        // Visual Inspector messages
        case 'element-hover':
          if (payload) {
            clearTimeout(hoverTimeoutRef.current!);
            hoverTimeoutRef.current = setTimeout(() => {
              setHoveredElement(payload);
              // Send cursor position to backend for presence
              if (presenceEnabled && payload.bounds) {
                sendCursorUpdate(payload.bounds.x + payload.bounds.width / 2, payload.bounds.y + payload.bounds.height / 2, payload.selector, {
                  tagName: payload.tagName,
                  className: payload.className,
                });
              }
            }, 50);
          }
          break;

        case 'element-unhover':
          clearTimeout(hoverTimeoutRef.current!);
          setHoveredElement(null);
          break;

        case 'element-click':
          if (payload) {
            setSelectedElements(prev => [...prev, payload]);
          }
          break;

        case 'element-selected':
          if (payload && iframeRef.current?.contentWindow) {
            iframeRef.current.contentWindow.postMessage({
              type: 'highlight-element',
              payload: { selector: payload.selector, action: 'select' },
            }, '*');
            // Send selection to backend for presence
            sendSelectionUpdate(payload.selector, {
              tagName: payload.tagName,
              className: payload.className,
              bounds: payload.bounds,
            });
          }
          break;

        case 'element-unselected':
          if (iframeRef.current?.contentWindow) {
            iframeRef.current.contentWindow.postMessage({
              type: 'highlight-element',
              payload: { selector: payload?.selector, action: 'unselect' },
            }, '*');
          }
          break;

        case 'dom-ready':
          injectInspectionScripts();
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      clearTimeout(hoverTimeoutRef.current!);
    };
  }, [onError]);

  // Update iframe src when components change
  useEffect(() => {
    setIsLoading(true);
    setPreviewError(null);
    previewKey.current += 1;
    onUpdate?.(generatePreviewHTML());
  }, [components, framework, generatePreviewHTML, onUpdate]);

  // Handle fullscreen
  useEffect(() => {
    if (isFullscreen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isFullscreen]);

  // Phase 18: Presence SSE Connection
  useEffect(() => {
    if (!presenceEnabled || !shareToken || !currentUser) return;

    const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    const presenceUrl = `${baseUrl}/api/infinity/ui-collab/shares/${shareToken}/presence/stream?email=${encodeURIComponent(currentUser.email)}&name=${encodeURIComponent(currentUser.name)}&avatar=${encodeURIComponent(currentUser.avatar || '')}`;
    const commentUrl = `${baseUrl}/api/infinity/ui-collab/shares/${shareToken}/comments/stream?email=${encodeURIComponent(currentUser.email)}&name=${encodeURIComponent(currentUser.name)}&avatar=${encodeURIComponent(currentUser.avatar || '')}`;

    // Presence SSE for cursors and selections
    const presenceSource = new EventSource(presenceUrl);
    presenceEventSource.current = presenceSource;

    presenceSource.addEventListener('connected', () => {
      console.log('Presence SSE connected');
    });

    presenceSource.addEventListener('presence:join', (event) => {
      const data = JSON.parse(event.data);
      setRemoteCursors(prev => {
        const next = new Map(prev);
        next.set(data.userEmail, {
          email: data.userEmail,
          name: data.userName,
          avatar: data.userAvatar,
          lastActive: new Date(data.timestamp),
          isCurrentUser: data.userEmail === currentUser.email,
        });
        return next;
      });
    });

    presenceSource.addEventListener('presence:leave', (event) => {
      const data = JSON.parse(event.data);
      setRemoteCursors(prev => {
        const next = new Map(prev);
        next.delete(data.userEmail);
        return next;
      });
    });

    presenceSource.addEventListener('presence:cursor', (event) => {
      const data = JSON.parse(event.data);
      if (data.userEmail === currentUser.email) return; // Don't show own cursor

      setRemoteCursors(prev => {
        const next = new Map(prev);
        const existing = next.get(data.userEmail);
        next.set(data.userEmail, {
          ...existing,
          email: data.userEmail,
          name: data.userName,
          avatar: data.userAvatar,
          cursor: { x: data.x, y: data.y, selector: data.selector },
          lastActive: new Date(data.timestamp),
          isCurrentUser: false,
        });
        return next;
      });
    });

    presenceSource.addEventListener('presence:selection', (event) => {
      const data = JSON.parse(event.data);
      if (data.userEmail === currentUser.email) return;

      setRemoteCursors(prev => {
        const next = new Map(prev);
        const existing = next.get(data.userEmail);
        next.set(data.userEmail, {
          ...existing,
          email: data.userEmail,
          name: data.userName,
          avatar: data.userAvatar,
          selection: { selector: data.selector, elementData: data.elementData },
          lastActive: new Date(data.timestamp),
          isCurrentUser: false,
        });
        return next;
      });
    });

    presenceSource.onerror = () => {
      console.warn('Presence SSE error, will reconnect...');
    };

    // Comment SSE for real-time comment updates
    const commentSource = new EventSource(commentUrl);
    commentEventSource.current = commentSource;

    commentSource.addEventListener('comment:created', (event) => {
      const data = JSON.parse(event.data);
      // Comments are fetched via parent component - could trigger refetch here
      console.log('New comment:', data.comment);
    });

    commentSource.addEventListener('comment:updated', (event) => {
      const data = JSON.parse(event.data);
      console.log('Comment updated:', data.comment);
    });

    commentSource.addEventListener('comment:deleted', (event) => {
      const data = JSON.parse(event.data);
      console.log('Comment deleted:', data.commentId);
    });

    commentSource.addEventListener('comment:resolved', (event) => {
      const data = JSON.parse(event.data);
      console.log('Comment resolved:', data.comment);
    });

    commentSource.addEventListener('comment:reaction', (event) => {
      const data = JSON.parse(event.data);
      console.log('Comment reaction:', data);
    });

    commentSource.onerror = () => {
      console.warn('Comment SSE error, will reconnect...');
    };

    return () => {
      presenceSource.close();
      commentSource.close();
    };
  }, [presenceEnabled, shareToken, currentUser]);

  // Phase 18: Send cursor position to backend (throttled)
  const sendCursorUpdate = useCallback(async (x: number, y: number, selector?: string, elementData?: { tagName: string; className?: string }) => {
    if (!presenceEnabled || !shareToken || !currentUser) return;

    const key = currentUser.email;
    const existingTimeout = cursorThrottleRef.current.get(key);
    if (existingTimeout) clearTimeout(existingTimeout);

    const timeout = setTimeout(async () => {
      try {
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
        await fetch(`${baseUrl}/api/infinity/ui-collab/shares/${shareToken}/presence/cursor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userEmail: currentUser.email,
            userName: currentUser.name,
            userAvatar: currentUser.avatar,
            x,
            y,
            selector,
            elementData,
          }),
        });
      } catch (error) {
        console.warn('Failed to send cursor update:', error);
      }
      cursorThrottleRef.current.delete(key);
    }, 50); // 50ms throttle

    cursorThrottleRef.current.set(key, timeout);
  }, [presenceEnabled, shareToken, currentUser]);

  // Phase 18: Send selection update to backend
  const sendSelectionUpdate = useCallback(async (selector: string, elementData?: { tagName: string; className?: string; bounds?: DOMRect }) => {
    if (!presenceEnabled || !shareToken || !currentUser) return;

    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
      await fetch(`${baseUrl}/api/infinity/ui-collab/shares/${shareToken}/presence/selection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userEmail: currentUser.email,
          userName: currentUser.name,
          userAvatar: currentUser.avatar,
          selector,
          elementData,
        }),
      });
    } catch (error) {
      console.warn('Failed to send selection update:', error);
    }
  }, [presenceEnabled, shareToken, currentUser]);

  // Handle mouse move in iframe for cursor tracking
  useEffect(() => {
    if (!presenceEnabled || !iframeRef.current) return;
    const iframe = iframeRef.current;

    const handleMouseMove = (e: MouseEvent) => {
      if (e.target === iframe) {
        const rect = iframe.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        sendCursorUpdate(x, y);
      }
    };

    iframe.addEventListener('mousemove', handleMouseMove);
    return () => iframe.removeEventListener('mousemove', handleMouseMove);
  }, [presenceEnabled, sendCursorUpdate]);

  const handleRefresh = useCallback(() => {
    previewKey.current += 1;
    setIsLoading(true);
    setPreviewError(null);
  }, []);

  const handleCopyHTML = useCallback(() => {
    navigator.clipboard.writeText(generatePreviewHTML());
  }, [generatePreviewHTML]);

  const handleDownloadHTML = useCallback(() => {
    const blob = new Blob([generatePreviewHTML()], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `preview-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [generatePreviewHTML]);

  // Visual Inspector Types (local to avoid circular deps)
interface SelectedElement {
  id?: string;
  selector: string;
  tagName: string;
  className: string;
  props: Record<string, any>;
  children: number;
  depth: number;
  xpath: string;
  bounds?: DOMRect;
}

const SELECTOR_PRIORITY = [
  'data-preview-id',
  'data-testid',
  'id',
  'className',
  'tagName',
];

const ConsoleIcons = ({
    type,
  }: {
    type: 'log' | 'error' | 'warn';
  }) => {
    switch (type) {
      case 'log':
        return <Terminal className="w-3 h-3 text-muted-foreground" />;
      case 'error':
        return <Bug className="w-3 h-3 text-destructive" />;
      case 'warn':
        return <Bug className="w-3 h-3 text-yellow-500" />;
    }
  };

  // Visual Inspector: Inject inspection scripts into iframe
  const injectInspectionScripts = useCallback(() => {
    if (!iframeRef.current?.contentWindow) return;

    const script = `
      (function() {
        if (window.__infinityInspectorInjected) return;
        window.__infinityInspectorInjected = true;

        let currentHovered = null;
        let isInspecting = false;

        function getSelector(element) {
          if (element.dataset.previewId) return '[data-preview-id="' + element.dataset.previewId + '"]';
          if (element.dataset.testid) return '[data-testid="' + element.dataset.testid + '"]';
          if (element.id) return '#' + element.id;
          if (element.className && typeof element.className === 'string') {
            const classes = element.className.trim().split(/\\s+/).filter(c => c);
            if (classes.length > 0) return '.' + classes.join('.');
          }
          return element.tagName.toLowerCase();
        }

        function getXPath(element) {
          if (!element) return '';
          if (element.id) return '//*[@id="' + element.id + '"]';
          if (element === document.body) return '/html/body';

          let ix = 0;
          const siblings = element.parentNode ? Array.from(element.parentNode.children) : [];
          for (let i = 0; i < siblings.length; i++) {
            const sibling = siblings[i];
            if (sibling === element) {
              return getXPath(element.parentNode) + '/' + element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
            }
            if (sibling.tagName === element.tagName) ix++;
          }
          return '';
        }

        function getElementInfo(element) {
          const rect = element.getBoundingClientRect();
          return {
            selector: getSelector(element),
            tagName: element.tagName.toLowerCase(),
            className: element.className || '',
            id: element.id || '',
            props: Array.from(element.attributes).reduce((acc, attr) => {
              acc[attr.name] = attr.value;
              return acc;
            }, {}),
            children: element.children.length,
            depth: getDepth(element),
            xpath: getXPath(element),
            bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          };
        }

        function getDepth(element) {
          let depth = 0;
          let current = element.parentElement;
          while (current && current !== document.body) {
            depth++;
            current = current.parentElement;
          }
          return depth;
        }

        let highlightOverlay = null;
        let hoverOverlay = null;

        function createOverlay(className) {
          const div = document.createElement('div');
          div.className = className;
          div.style.cssText = \`
            position: fixed;
            pointer-events: none;
            z-index: 2147483647;
            border: 2px solid #3b82f6;
            background: rgba(59, 130, 246, 0.1);
            box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.3);
            border-radius: 4px;
            transition: all 50ms ease-out;
            display: none;
          \`;
          document.body.appendChild(div);
          return div;
        }

        function updateOverlay(overlay, info) {
          if (!overlay || !info) return;
          overlay.style.display = 'block';
          overlay.style.left = info.bounds.x + 'px';
          overlay.style.top = info.bounds.y + 'px';
          overlay.style.width = info.bounds.width + 'px';
          overlay.style.height = info.bounds.height + 'px';
        }

        function removeOverlay(overlay) {
          if (overlay) overlay.style.display = 'none';
        }

        function onMouseOver(e) {
          if (!isInspecting) return;
          e.stopPropagation();
          const target = e.target;
          if (target === highlightOverlay || target === hoverOverlay) return;

          const info = getElementInfo(target);
          if (!hoverOverlay) hoverOverlay = createOverlay('infinity-hover-overlay');
          updateOverlay(hoverOverlay, info);
          showTooltip(target, info);

          window.parent.postMessage({ type: 'element-hover', payload: info }, '*');
        }

        function onMouseOut(e) {
          if (!isInspecting) return;
          e.stopPropagation();
          const target = e.target;
          if (!target.contains(e.relatedTarget as Node)) {
            removeOverlay(hoverOverlay);
            hideTooltip();
            window.parent.postMessage({ type: 'element-unhover', payload: null }, '*');
          }
        }

        function onClick(e) {
          if (!isInspecting) return;
          e.preventDefault();
          e.stopPropagation();
          const target = e.target;
          const info = getElementInfo(target);
          window.parent.postMessage({ type: 'element-click', payload: info }, '*');
          stopInspecting();
        }

        let tooltip = null;
        function showTooltip(element, info) {
          if (tooltip) tooltip.remove();
          tooltip = document.createElement('div');
          tooltip.style.cssText = \`
            position: fixed;
            z-index: 2147483647;
            background: #1e1e1e;
            color: #fff;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-family: monospace;
            white-space: nowrap;
            pointer-events: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          \`;
          tooltip.textContent = info.selector + ' (' + info.tagName + ')';
          document.body.appendChild(tooltip);
          const rect = element.getBoundingClientRect();
          tooltip.style.left = rect.right + 8 + 'px';
          tooltip.style.top = rect.top + 'px';
        }

        function hideTooltip() {
          if (tooltip) { tooltip.remove(); tooltip = null; }
        }

        function startInspecting() {
          isInspecting = true;
          document.addEventListener('mouseover', onMouseOver, true);
          document.addEventListener('mouseout', onMouseOut, true);
          document.addEventListener('click', onClick, true);
          document.body.style.cursor = 'crosshair';
        }

        function stopInspecting() {
          isInspecting = false;
          document.removeEventListener('mouseover', onMouseOver, true);
          document.removeEventListener('mouseout', onMouseOut, true);
          document.removeEventListener('click', onClick, true);
          document.body.style.cursor = '';
          removeOverlay(highlightOverlay);
          removeOverlay(hoverOverlay);
          hideTooltip();
        }

        window.addEventListener('message', (event) => {
          if (event.data.type === 'highlight-element') {
            const { selector, action } = event.data.payload;
            const element = document.querySelector(selector);
            if (element) {
              const info = getElementInfo(element);
              if (action === 'select') {
                if (!highlightOverlay) highlightOverlay = createOverlay('infinity-select-overlay');
                highlightOverlay.style.borderColor = '#22c55e';
                highlightOverlay.style.background = 'rgba(34, 197, 94, 0.15)';
                updateOverlay(highlightOverlay, info);
              } else if (action === 'unselect') {
                removeOverlay(highlightOverlay);
              }
            }
          } else if (event.data.type === 'start-inspect') {
            startInspecting();
          } else if (event.data.type === 'stop-inspect') {
            stopInspecting();
          }
        });

        window.parent.postMessage({ type: 'dom-ready', payload: null }, '*');
      })();
    `;

    iframeRef.current.contentWindow.postMessage({
      type: 'inject-script',
      payload: script,
    }, '*');
  }, [iframeRef]);

  const startInspecting = useCallback(() => {
    setIsInspecting(true);
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'start-inspect' }, '*');
    }
  }, [iframeRef]);

  const stopInspecting = useCallback(() => {
    setIsInspecting(false);
    setHoveredElement(null);
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({ type: 'stop-inspect' }, '*');
    }
  }, [iframeRef]);

  const handleNavigateStack = useCallback((direction: 'up' | 'down') => {
    if (selectedElements.length === 0) return;
    let index = selectedElements.length - 1;
    if (direction === 'up' && index > 0) index--;
    else if (direction === 'down' && index < selectedElements.length - 1) index++;
    const element = selectedElements[index];
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        type: 'highlight-element',
        payload: { selector: element.selector, action: 'select' },
      }, '*');
    }
  }, [selectedElements, iframeRef]);

  const handleClearSelection = useCallback(() => {
    setSelectedElements([]);
    stopInspecting();
  }, [stopInspecting]);

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-border">
        <div className="flex items-center gap-1">
          <Tabs
            tabs={[
              { id: 'preview', label: 'Preview', content: null },
              { id: 'console', label: consoleLogs.filter(l => l.type === 'error').length > 0 ? (
                <>Console <Badge variant="destructive" className="ml-1 h-4 px-1.5 text-xs">{consoleLogs.filter(l => l.type === 'error').length}</Badge></>
              ) : 'Console', content: null },
            ]}
            controlledTab={activeTab}
            onChange={setActiveTab}
            variant="line"
            className="hidden sm:flex"
          />

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* Device Mode Selector */}
          <Select value={deviceMode} onValueChange={setDeviceMode as (v: DeviceModeKey) => void}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Select device" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DEVICE_MODES).map(([key, config]) => (
                <SelectItem key={key} value={key as DeviceModeKey} className="flex items-center gap-2">
                  <config.icon className="w-4 h-4" />
                  <span>{config.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* Freeform scale control */}
          {deviceMode === 'freeform' && (
            <>
              <div className="flex items-center gap-2 px-2">
                <span className="text-xs text-muted-foreground">Scale:</span>
                <input
                  type="range"
                  min="0.25"
                  max="1.5"
                  step="0.05"
                  value={freeformScale}
                  onChange={(e) => setFreeformScale(parseFloat(e.target.value))}
                  className="w-32 h-1"
                />
                <span className="text-xs text-muted-foreground w-10 text-right">
                  {Math.round(freeformScale * 100)}%
                </span>
              </div>
              <Separator orientation="vertical" className="h-6 mx-1" />
            </>
          )}

          {/* Dark mode toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => iframeRef.current?.contentWindow?.postMessage({ type: 'toggle-dark' }, '*')}
            title="Toggle dark mode"
          >
            <span className="w-4 h-4">🌙</span>
          </Button>

          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* Visual Inspector Toolbar */}
          <div className="flex items-center gap-1">
            <Button
              variant={isInspecting ? 'default' : 'outline'}
              size="sm"
              onClick={isInspecting ? stopInspecting : startInspecting}
              className="flex items-center gap-1"
            >
              {isInspecting ? (
                <>
                  <MousePointer className="w-3.5 h-3.5 mr-1 animate-pulse" />
                  Inspecting...
                </>
              ) : (
                <>
                  <MousePointer className="w-3.5 h-3.5 mr-1" />
                  Inspect
                </>
              )}
            </Button>

            {isInspecting && (
              <Button variant="ghost" size="icon" onClick={stopInspecting} title="Stop inspecting (Esc)">
                <X className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>

          <div className="flex-1" />

          {/* Actions */}
          <Button variant="ghost" size="icon" onClick={handleRefresh} title="Refresh" disabled={isLoading}>
            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleCopyHTML} title="Copy HTML">
            <Copy className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleDownloadHTML} title="Download HTML">
            <Download className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setIsFullscreen(!isFullscreen)} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Preview Area */}
      <div className="flex-1 relative overflow-hidden">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}

        <div
          className={cn(
            'relative w-full h-full transition-all duration-300',
            isFullscreen ? 'fixed inset-0 z-50 rounded-none' : '',
            deviceMode === 'freeform' && 'p-4'
          )}
          style={{
            width: isFullscreen ? '100vw' : '100%',
            height: isFullscreen ? '100vh' : '100%',
            maxWidth: isFullscreen ? 'none' : '100%',
          }}
        >
          {deviceMode === 'freeform' ? (
            // Freeform mode: draggable, resizable frames
            <div
              className="relative w-full h-full"
              style={{
                transform: `scale(${freeformScale})`,
                transformOrigin: 'top left',
              }}
            >
              <FreeformFrames
                iframeRef={iframeRef}
                previewKey={previewKey.current}
                generatePreviewHTML={generatePreviewHTML}
                onDrag={setFreeformPosition}
                position={freeformPosition}
                commentOverlayEnabled={commentOverlayEnabled}
                shareToken={shareToken}
                comments={comments}
                selectedCommentId={selectedCommentId}
                onSelectComment={onSelectComment!}
                onAddComment={onAddComment!}
                onReply={onReply!}
                onResolve={onResolve!}
                onReact={onReact!}
                onDelete={onDelete!}
                currentUser={currentUser}
                presenceEnabled={presenceEnabled}
                remoteCursors={remoteCursors}
                previewError={previewError}
                handleRefresh={handleRefresh}
              />
            </div>
          ) : (
            // Single device frame mode
            <div className="flex items-center justify-center min-h-[calc(100%-2rem)]">
              <DeviceFrame
                ref={iframeRef}
                kind={DEVICE_MODES[deviceMode].kind}
                width={DEVICE_MODES[deviceMode].width}
                height={DEVICE_MODES[deviceMode].height}
                scale={isFullscreen ? Math.min(window.innerWidth / (DEVICE_MODES[deviceMode].width + 46), window.innerHeight / (DEVICE_MODES[deviceMode].height + 76)) : 1}
                srcDoc={generatePreviewHTML()}
                showChrome={DEVICE_MODES[deviceMode].showChrome}
                key={previewKey.current}
              />
            </div>
          )}

          {previewError && !isLoading && deviceMode !== 'freeform' && (
            <div className="absolute inset-0 flex items-center justify-center p-4 bg-destructive/10 border border-destructive/20 rounded-lg z-10">
              <div className="text-center max-w-md">
                <Bug className="w-12 h-12 text-destructive mx-auto mb-3" />
                <h3 className="text-lg font-semibold text-destructive mb-2">Preview Error</h3>
                <p className="text-sm text-muted-foreground mb-4">{previewError}</p>
                <Button onClick={handleRefresh} size="sm">Try Again</Button>
              </div>
            </div>
          )}
        </div>

        {/* Viewport label when not fullscreen and not freeform */}
        {!isFullscreen && deviceMode !== 'freeform' && (
          <div className="absolute bottom-2 right-2 bg-background/90 backdrop-blur px-2 py-1 rounded text-xs text-muted-foreground">
            {DEVICE_MODES[deviceMode].width} × {DEVICE_MODES[deviceMode].height}
          </div>
        )}
      </div>

      {/* Visual Inspector Panel */}
      {(selectedElements.length > 0 || hoveredElement || isInspecting) && (
        <div className="border-t border-border bg-background/95 backdrop-blur p-3 max-h-96 overflow-y-auto">
          {/* Element Stack / Breadcrumb */}
          {(selectedElements.length > 0 || hoveredElement) && (
            <div className="mb-2">
              <div className="flex items-center gap-1 text-xs mb-1">
                <Code className="w-3 h-3 text-muted-foreground" />
                <span className="text-muted-foreground">Element Path</span>
                {selectedElements.length > 1 && (
                  <div className="flex items-center gap-1 ml-auto">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() => handleNavigateStack('up')}
                      disabled={selectedElements.length <= 1}
                      title="Parent element"
                    >
                      <ChevronUp className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() => handleNavigateStack('down')}
                      disabled={selectedElements.length <= 1}
                      title="Child element"
                    >
                      <ChevronDown className="w-3 h-3" />
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-1">
                {selectedElements.map((el, i) => (
                  <Badge
                    key={i}
                    variant={i === selectedElements.length - 1 ? 'default' : 'outline'}
                    className="text-xs font-mono px-2 py-0.5 cursor-pointer hover:bg-muted"
                    onClick={() => handleNavigateStack(i === selectedElements.length - 1 ? 'up' : 'down')}
                  >
                    {el.tagName}
                    {el.className && <span className="ml-1 opacity-70">.{el.className.split(' ')[0]}</span>}
                    {el.id && <span className="ml-1 opacity-70">#{el.id}</span>}
                  </Badge>
                ))}
                {hoveredElement && selectedElements.length === 0 && (
                  <Badge variant="secondary" className="text-xs font-mono px-2 py-0.5 opacity-60">
                    {hoveredElement.tagName}
                    {hoveredElement.className && <span className="ml-1">.{hoveredElement.className.split(' ')[0]}</span>}
                    <span className="ml-1 opacity-50">(hover)</span>
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Selected Element Details */}
          {selectedElements.length > 0 && (
            <div className="space-y-2">
              <Separator />

              {selectedElements.map((el, i) => (
                <div key={i} className={cn('p-2 rounded border border-border bg-muted/30', i === selectedElements.length - 1 && 'ring-1 ring-primary')}>
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-sm font-mono text-foreground">{el.tagName}</code>
                    {el.className && (
                      <Badge variant="secondary" className="text-xs font-mono">
                        .{el.className.split(' ').join(' .')}
                      </Badge>
                    )}
                    {el.id && (
                      <Badge variant="outline" className="text-xs font-mono">
                        #{el.id}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">
                      Depth: {el.depth} | Children: {el.children}
                    </span>
                  </div>

                  <div className="text-xs text-muted-foreground font-mono truncate">
                    Selector: {el.selector}
                  </div>

                  <div className="text-xs text-muted-foreground font-mono truncate">
                    XPath: {el.xpath}
                  </div>

                  {el.bounds && (
                    <div className="text-xs text-muted-foreground">
                      Position: {Math.round(el.bounds.x)}, {Math.round(el.bounds.y)} | Size: {Math.round(el.bounds.width)}×{Math.round(el.bounds.height)}
                    </div>
                  )}
                </div>
              ))}

              <Button variant="outline" size="sm" className="w-full" onClick={handleClearSelection}>
                <X className="w-3.5 h-3.5 mr-1.5" />
                Clear Selection
              </Button>
            </div>
          )}

          {/* Keyboard hint */}
          {isInspecting && (
            <div className="mt-3 p-2 bg-primary/5 border border-primary/20 rounded text-xs text-primary">
              <kbd className="px-1.5 py-0.5 bg-background rounded border border-border mr-1">Esc</kbd> to stop |
              <kbd className="px-1.5 py-0.5 bg-background rounded border border-border mx-1">Click</kbd> to select |
              <kbd className="px-1.5 py-0.5 bg-background rounded border border-border mx-1">↑/↓</kbd> to navigate
            </div>
          )}
        </div>
      )}

      {/* Console Panel */}
      {activeTab === 'console' && (
        <div className="border-t border-border h-64 overflow-hidden flex flex-col bg-muted/50">
          <div className="flex items-center justify-between p-2 border-b border-border">
            <h4 className="text-sm font-medium">Console</h4>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => setConsoleLogs([])} title="Clear">
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 font-mono text-xs">
            {consoleLogs.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No console output yet</p>
            ) : (
              <div className="space-y-1">
                {consoleLogs.map((log, i) => (
                  <div
                    key={i}
                    className={cn(
                      'px-2 py-1 rounded font-mono text-xs whitespace-pre-wrap break-all',
                      log.type === 'error' && 'text-destructive bg-destructive/10',
                      log.type === 'warn' && 'text-yellow-500 bg-yellow-500/10',
                      log.type === 'log' && 'text-muted-foreground'
                    )}
                  >
                    <span className="text-muted-foreground mr-2">{log.timestamp.toLocaleTimeString()}</span>
                    <ConsoleIcons type={log.type} />
                    <span className="ml-1">{log.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Fullscreen exit hint */}
      {isFullscreen && (
        <div className="fixed top-4 right-4 z-50 bg-background/90 backdrop-blur px-3 py-1.5 rounded-lg shadow-lg border border-border text-sm text-muted-foreground">
          Press <kbd className="px-1.5 py-0.5 bg-muted rounded text-foreground">Esc</kbd> to exit fullscreen
        </div>
      )}
    </div>
  );
});

// Phase 18: Presence Cursors Component
interface PresenceCursorsProps {
  cursors: Map<string, PresenceUser>;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  viewportConfig: { width: number; height: number; label: string; icon: any };
  isFullscreen: boolean;
}

/* ──────────────────────────────────────────────────────────────────────────
 * FreeformFrames — draggable/resizable iPhone + Desktop frames side by side
 * ────────────────────────────────────────────────────────────────────────── */
interface FreeformFramesProps {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  previewKey: number;
  generatePreviewHTML: () => string;
  onDrag: (pos: { x: number; y: number }) => void;
  position: { x: number; y: number };
  commentOverlayEnabled: boolean;
  shareToken?: string;
  comments?: Comment[];
  selectedCommentId?: string;
  onSelectComment: (commentId: string) => void;
  onAddComment: (selector: string, elementData: CommentElementData, content: string, mentions?: string[]) => Promise<void>;
  onReply: (parentId: string, content: string, mentions?: string[]) => Promise<void>;
  onResolve: (commentId: string, resolved: boolean) => Promise<void>;
  onReact: (commentId: string, emoji: string) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
  currentUser?: { name: string; email: string; avatar?: string };
  presenceEnabled?: boolean;
  remoteCursors?: Map<string, PresenceUser>;
  previewError?: string | null;
  handleRefresh?: () => void;
}

const FreeformFrames: React.FC<FreeformFramesProps> = ({
  iframeRef,
  previewKey,
  generatePreviewHTML,
  onDrag,
  position,
  commentOverlayEnabled,
  shareToken,
  comments = [],
  selectedCommentId,
  onSelectComment,
  onAddComment,
  onReply,
  onResolve,
  onReact,
  onDelete,
  currentUser,
  presenceEnabled = false,
  remoteCursors = new Map(),
  previewError,
  handleRefresh,
}) => {
  // We need two iframes - one for iPhone, one for Desktop
  // Use separate refs for each
  const iphoneRef = useRef<HTMLIFrameElement>(null);
  const desktopRef = useRef<HTMLIFrameElement>(null);

  // For simplicity, render two DeviceFrames side by side
  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start justify-center">
      {/* iPhone 16 Pro Frame */}
      <div className="relative shrink-0">
        <DeviceFrame
          ref={iphoneRef}
          kind="iphone-16-pro"
          width={393}
          height={852}
          scale={1}
          srcDoc={generatePreviewHTML()}
          showChrome={true}
          key={previewKey}
        />
        {commentOverlayEnabled && shareToken && comments.length > 0 && onSelectComment && onAddComment && onReply && onResolve && onReact && onDelete && (
          <CommentOverlay
            shareToken={shareToken}
            comments={comments}
            selectedCommentId={selectedCommentId}
            onSelectComment={onSelectComment}
            onAddComment={onAddComment}
            onReply={onReply}
            onResolve={onResolve}
            onReact={onReact}
            onDelete={onDelete}
            currentUser={currentUser}
            iframeRef={iphoneRef as React.RefObject<HTMLIFrameElement>}
            enabled={commentOverlayEnabled}
          />
        )}
        {presenceEnabled && remoteCursors.size > 0 && (
          <PresenceCursors
            cursors={remoteCursors}
            iframeRef={iphoneRef as React.RefObject<HTMLIFrameElement>}
            viewportConfig={{ width: 393, height: 852, label: '', icon: null }}
            isFullscreen={false}
          />
        )}
      </div>

      {/* Desktop Frame */}
      <div className="relative shrink-0">
        <DeviceFrame
          ref={desktopRef}
          kind="desktop"
          width={1440}
          height={900}
          scale={0.5}
          srcDoc={generatePreviewHTML()}
          showChrome={true}
          key={previewKey + 1}
        />
        {commentOverlayEnabled && shareToken && comments.length > 0 && onSelectComment && onAddComment && onReply && onResolve && onReact && onDelete && (
          <CommentOverlay
            shareToken={shareToken}
            comments={comments}
            selectedCommentId={selectedCommentId}
            onSelectComment={onSelectComment}
            onAddComment={onAddComment}
            onReply={onReply}
            onResolve={onResolve}
            onReact={onReact}
            onDelete={onDelete}
            currentUser={currentUser}
            iframeRef={desktopRef as React.RefObject<HTMLIFrameElement>}
            enabled={commentOverlayEnabled}
          />
        )}
        {presenceEnabled && remoteCursors.size > 0 && (
          <PresenceCursors
            cursors={remoteCursors}
            iframeRef={desktopRef as React.RefObject<HTMLIFrameElement>}
            viewportConfig={{ width: 1440, height: 900, label: '', icon: null }}
            isFullscreen={false}
          />
        )}
      </div>

      {previewError && (
        <div className="absolute inset-0 flex items-center justify-center p-4 bg-destructive/10 border border-destructive/20 rounded-lg z-10">
          <div className="text-center max-w-md">
            <Bug className="w-12 h-12 text-destructive mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-destructive mb-2">Preview Error</h3>
            <p className="text-sm text-muted-foreground mb-4">{previewError}</p>
            <Button onClick={handleRefresh} size="sm">Try Again</Button>
          </div>
        </div>
      )}
    </div>
  );
};

const PresenceCursors: React.FC<PresenceCursorsProps> = ({ cursors, iframeRef, viewportConfig, isFullscreen }) => {
  const cursorColors = [
    'bg-blue-500',
    'bg-green-500',
    'bg-purple-500',
    'bg-orange-500',
    'bg-pink-500',
    'bg-cyan-500',
    'bg-amber-500',
    'bg-rose-500',
  ];

  const getColorForUser = (email: string) => {
    let hash = 0;
    for (let i = 0; i < email.length; i++) {
      hash = email.charCodeAt(i) + ((hash << 5) - hash);
    }
    return cursorColors[Math.abs(hash) % cursorColors.length];
  };

  return (
    <>
      {Array.from(cursors.values()).map((user) => {
        if (user.isCurrentUser) return null;
        if (!user.cursor && !user.selection) return null;

        const colorClass = getColorForUser(user.email);
        const iframeRect = iframeRef.current?.getBoundingClientRect();

        // Render cursor
        const cursorElements = user.cursor ? (
          <>
            <div
              className={`fixed z-40 pointer-events-none transition-all duration-75 ${colorClass}`}
              style={{
                left: iframeRect ? iframeRect.left + user.cursor!.x + window.scrollX : user.cursor!.x,
                top: iframeRect ? iframeRect.top + user.cursor!.y + window.scrollY : user.cursor!.y,
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                border: '2px solid white',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                transform: 'translate(-50%, -50%)',
              }}
            />
            {/* User label */}
            <div
              className="fixed z-40 pointer-events-none text-xs font-medium text-white"
              style={{
                left: iframeRect ? iframeRect.left + user.cursor!.x + 12 + window.scrollX : user.cursor!.x + 12,
                top: iframeRect ? iframeRect.top + user.cursor!.y - 20 + window.scrollY : user.cursor!.y - 20,
                backgroundColor: colorClass.replace('bg-', 'bg-').replace('500', '600'),
                padding: '2px 6px',
                borderRadius: '4px',
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
              }}
            >
              {user.name}
            </div>
          </>
        ) : null;

        // Render selection highlight
        const selectionElements = user.selection?.elementData?.bounds ? (
          <>
            <div
              className="fixed z-30 pointer-events-none"
              style={{
                left: iframeRect
                  ? iframeRect.left + user.selection!.elementData!.bounds!.x + window.scrollX
                  : user.selection!.elementData!.bounds!.x,
                top: iframeRect
                  ? iframeRect.top + user.selection!.elementData!.bounds!.y + window.scrollY
                  : user.selection!.elementData!.bounds!.y,
                width: user.selection!.elementData!.bounds!.width,
                height: user.selection!.elementData!.bounds!.height,
                border: `2px dashed ${colorClass.replace('bg-', '').replace('500', '500')}`,
                backgroundColor: colorClass.replace('bg-', 'bg-').replace('500', '100'),
                borderRadius: '4px',
                boxShadow: `0 0 0 9999px ${colorClass.replace('bg-', 'bg-').replace('500', '100')}`,
              }}
            />
          </>
        ) : null;

        return (
          <React.Fragment key={user.email}>
            {cursorElements}
            {selectionElements}
          </React.Fragment>
        );
      })}
    </>
  );
};

export default LivePreview;