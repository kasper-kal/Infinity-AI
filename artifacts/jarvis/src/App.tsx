import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { useToast } from '@/components/ui/Tooltip';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { LanguageProvider } from '@/lib/i18n';
import Home from '@/pages/home';
import { BuildView } from '@/components/views/BuildView';
import { ChatView } from '@/components/views/ChatView';
import { TerminalView } from '@/components/views/TerminalView';
import { SettingsView } from '@/components/views/SettingsView';
import { ProjectsView } from '@/components/views/ProjectsView';

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/build" component={BuildView} />
      <Route path="/chat" component={ChatView} />
      <Route path="/terminal" component={TerminalView} />
      <Route path="/settings" component={SettingsView} />
      <Route path="/projects" component={ProjectsView} />
      <Route>
        <div className="min-h-screen bg-background text-foreground flex items-center justify-center font-display text-2xl tracking-widest text-primary glow-text">
          SYSTEM FAULT: MODULE NOT FOUND
        </div>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </LanguageProvider>
    </QueryClientProvider>
  );
}

export default App;