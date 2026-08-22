import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { Router, Route } from 'wouter';
import { LanguageProvider } from '@/lib/i18n';
import { AppShellRouter } from '@/components/layout/AppShellRouter';
import ErrorBoundary from '@/components/ErrorBoundary';
import ChatDemoPage from '@/pages/ChatDemo';
import WidgetShowcasePage from '@/pages/WidgetShowcase';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <ErrorBoundary>
          <Router base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            {/* New responsive UI as default entry point */}
            <Route path="/*">
              <AppShellRouter base="" />
            </Route>
            {/* Demo pages for Phase 14 Responsive UI */}
            <Route path="/demo/chat">
              <ChatDemoPage />
            </Route>
            <Route path="/demo/widgets">
              <WidgetShowcasePage />
            </Route>
          </Router>
          <Toaster />
        </ErrorBoundary>
      </LanguageProvider>
    </QueryClientProvider>
  );
}

export default App;