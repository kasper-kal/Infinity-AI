import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { Router, Route } from 'wouter';
import { LanguageProvider } from '@/lib/i18n';
import Home from '@/pages/home';
import { AppShellRouter } from '@/components/layout/AppShellRouter';
import ErrorBoundary from '@/components/ErrorBoundary';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <ErrorBoundary>
          <Router base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Route path="/">
              <Home />
            </Route>
            <Route path="/app/*">
              <AppShellRouter base="/app" />
            </Route>
          </Router>
          <Toaster />
        </ErrorBoundary>
      </LanguageProvider>
    </QueryClientProvider>
  );
}

export default App;