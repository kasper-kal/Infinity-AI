/**
 * Debug Panel — Phase 30: Advanced Agent Capabilities
 * UI for debugging sessions, breakpoints, variables, test runs, and auto-fix
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { apiRequest } from "@/lib/api";
import { Button, Input, Textarea, Tabs, TabsList, TabsTrigger, TabsContent, Card, CardHeader, CardTitle, CardContent, CardFooter, Badge, ScrollArea, Separator, Checkbox, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, Alert, AlertTitle, AlertDescription, Table, TableHeader, TableBody, TableRow, TableCell, TableHead } from "@/components/ui";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "../../lib/i18n";

interface DebugSession {
  id: string;
  type: "node" | "browser" | "test";
  status: "initializing" | "running" | "paused" | "stopped" | "error";
  config: any;
  createdAt: string;
  currentFrame?: string;
}

interface Breakpoint {
  id: string;
  file: string;
  line: number;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
  verified: boolean;
}

interface Variable {
  name: string;
  value: string;
  type: string;
  evaluateName?: string;
}

interface TestRun {
  id: string;
  status: "running" | "passed" | "failed" | "cancelled";
  framework: string;
  command: string;
  startedAt: string;
  completedAt?: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    duration: number;
  };
  results: Array<{
    file: string;
    name: string;
    status: "passed" | "failed" | "skipped";
    duration: number;
    error?: string;
    stack?: string;
  }>;
}

interface AutoFixResult {
  fixed: boolean;
  attempts: number;
  changes: Array<{
    file: string;
    diff: string;
    explanation: string;
  }>;
  remainingFailures: number;
}

export function DebugPanel({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const { toast } = useToast();

  // State
  const [activeTab, setActiveTab] = useState<"sessions" | "breakpoints" | "variables" | "tests" | "autoFix">("sessions");
  const [sessions, setSessions] = useState<DebugSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<DebugSession | null>(null);
  const [breakpoints, setBreakpoints] = useState<Breakpoint[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [selectedTestRun, setSelectedTestRun] = useState<TestRun | null>(null);
  const [autoFixResult, setAutoFixResult] = useState<AutoFixResult | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [isAutoFixing, setIsAutoFixing] = useState(false);
  const [newBreakpoint, setNewBreakpoint] = useState({ file: "", line: 1, condition: "" });
  const [debugConfig, setDebugConfig] = useState({
    type: "node" as "node" | "browser" | "test",
    program: "",
    args: "",
    testCommand: "npm test",
    testFramework: "jest" as "jest" | "vitest" | "playwright" | "cypress" | "mocha",
  });

  const variablesRefreshInterval = useRef<NodeJS.Timeout | null>(null);

  // Fetch sessions on mount
  useEffect(() => {
    fetchSessions();
    fetchTestRuns();
  }, [projectId]);

  // Refresh variables when session is paused
  useEffect(() => {
    if (selectedSession?.status === "paused") {
      fetchVariables();
      variablesRefreshInterval.current = setInterval(fetchVariables, 2000);
    }
    return () => {
      if (variablesRefreshInterval.current) {
        clearInterval(variablesRefreshInterval.current);
      }
    };
  }, [selectedSession?.id, selectedSession?.status]);

  const fetchSessions = async () => {
    try {
      const response = await apiRequest(`/api/infinity/advanced-agent/debug/sessions?projectId=${projectId}`);
      if (response.success) {
        setSessions(response.data);
      }
    } catch (error) {
      console.error("Failed to fetch sessions:", error);
    }
  };

  const fetchBreakpoints = async (sessionId: string) => {
    try {
      // Breakpoints are fetched with session
      const session = sessions.find(s => s.id === sessionId);
      if (session) {
        // TODO: Add breakpoint fetch endpoint
      }
    } catch (error) {
      console.error("Failed to fetch breakpoints:", error);
    }
  };

  const fetchVariables = async () => {
    if (!selectedSession) return;
    try {
      const response = await apiRequest(
        `/api/infinity/advanced-agent/debug/variables/${selectedSession.id}?projectId=${projectId}`
      );
      if (response.success) {
        setVariables(response.data);
      }
    } catch (error) {
      console.error("Failed to fetch variables:", error);
    }
  };

  const fetchTestRuns = async () => {
    try {
      // TODO: Add test runs list endpoint
    } catch (error) {
      console.error("Failed to fetch test runs:", error);
    }
  };

  const createSession = async () => {
    setIsCreatingSession(true);
    try {
      const config: any = {};
      if (debugConfig.type === "node") {
        config.program = debugConfig.program;
        config.args = debugConfig.args.split(" ").filter(Boolean);
      } else if (debugConfig.type === "test") {
        config.testCommand = debugConfig.testCommand;
        config.testFramework = debugConfig.testFramework;
      }

      const response = await apiRequest("/api/infinity/advanced-agent/debug/session", {
        method: "POST",
        body: JSON.stringify({ projectId, type: debugConfig.type, config }),
      });

      if (response.success) {
        const session = response.data;
        setSessions(prev => [session, ...prev]);
        setSelectedSession(session);
        setActiveTab("sessions");
        toast({ title: t("debug.sessionCreated"), description: session.id });
      } else {
        toast({ title: t("debug.createFailed"), description: response.error, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: t("debug.createFailed"), description: String(error), variant: "destructive" });
    } finally {
      setIsCreatingSession(false);
    }
  };

  const sendDebugAction = async (action: "continue" | "pause" | "stepOver" | "stepInto" | "stepOut" | "restart" | "stop") => {
    if (!selectedSession) return;
    try {
      const response = await apiRequest("/api/infinity/advanced-agent/debug/action", {
        method: "POST",
        body: JSON.stringify({ projectId, sessionId: selectedSession.id, action }),
      });
      if (response.success) {
        // Update session status
        setSessions(prev => prev.map(s =>
          s.id === selectedSession.id ? { ...s, status: action === "stop" ? "stopped" : action === "pause" ? "paused" : "running" } : s
        ));
        setSelectedSession(prev => prev ? { ...prev, status: action === "stop" ? "stopped" : action === "pause" ? "paused" : "running" } : null);
        fetchVariables();
      }
    } catch (error) {
      toast({ title: t("debug.actionFailed"), description: String(error), variant: "destructive" });
    }
  };

  const setBreakpoint = async () => {
    if (!selectedSession || !newBreakpoint.file || !newBreakpoint.line) return;
    try {
      const response = await apiRequest("/api/infinity/advanced-agent/debug/breakpoint", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          sessionId: selectedSession.id,
          file: newBreakpoint.file,
          line: newBreakpoint.line,
          condition: newBreakpoint.condition || undefined,
        }),
      });
      if (response.success) {
        setBreakpoints(prev => [...prev, response.data]);
        setNewBreakpoint({ file: "", line: 1, condition: "" });
        toast({ title: t("debug.breakpointSet"), description: `${newBreakpoint.file}:${newBreakpoint.line}` });
      }
    } catch (error) {
      toast({ title: t("debug.breakpointFailed"), description: String(error), variant: "destructive" });
    }
  };

  const removeBreakpoint = async (breakpointId: string) => {
    if (!selectedSession) return;
    try {
      await apiRequest(`/api/infinity/advanced-agent/debug/breakpoint/${breakpointId}`, {
        method: "DELETE",
        body: JSON.stringify({ projectId, sessionId: selectedSession.id }),
      });
      setBreakpoints(prev => prev.filter(b => b.id !== breakpointId));
      toast({ title: t("debug.breakpointRemoved") });
    } catch (error) {
      toast({ title: t("debug.breakpointRemoveFailed"), description: String(error), variant: "destructive" });
    }
  };

  const runTests = async () => {
    setIsRunningTests(true);
    try {
      const response = await apiRequest("/api/infinity/advanced-agent/debug/test", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          testCommand: debugConfig.testCommand,
          testFramework: debugConfig.testFramework,
        }),
      });
      if (response.success) {
        const run = response.data;
        setTestRuns(prev => [run, ...prev]);
        setSelectedTestRun(run);
        setActiveTab("tests");
        toast({ title: t("debug.testsStarted"), description: run.id });
      } else {
        toast({ title: t("debug.testsFailed"), description: response.error, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: t("debug.testsFailed"), description: String(error), variant: "destructive" });
    } finally {
      setIsRunningTests(false);
    }
  };

  const runAutoFix = async (testRunId: string) => {
    setIsAutoFixing(true);
    try {
      const response = await apiRequest("/api/infinity/advanced-agent/debug/auto-fix", {
        method: "POST",
        body: JSON.stringify({ projectId, testRunId, maxAttempts: 3 }),
      });
      if (response.success) {
        setAutoFixResult(response.data);
        setActiveTab("autoFix");
        toast({ title: response.data.fixed ? t("debug.fixed") : t("debug.partialFix"), description: response.summary });
      } else {
        toast({ title: t("debug.autoFixFailed"), description: response.error, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: t("debug.autoFixFailed"), description: String(error), variant: "destructive" });
    } finally {
      setIsAutoFixing(false);
    }
  };

  const statusColors: Record<string, "default" | "secondary" | "success" | "destructive" | "outline"> = {
    initializing: "secondary",
    running: "success",
    paused: "default",
    stopped: "outline",
    error: "destructive",
  };

  const testStatusColors: Record<string, "default" | "secondary" | "success" | "destructive" | "outline"> = {
    running: "secondary",
    passed: "success",
    failed: "destructive",
    cancelled: "outline",
  };

  return (
    <div className="h-full flex flex-col">
      {/* Session Creation Bar */}
      <Card className="mb-4">
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <Label>{t("debug.sessionType")}</Label>
              <Select value={debugConfig.type} onValueChange={v => setDebugConfig(prev => ({ ...prev, type: v as any }))} className="mt-1 w-full">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="node">{t("debug.typeNode")}</SelectItem>
                  <SelectItem value="browser">{t("debug.typeBrowser")}</SelectItem>
                  <SelectItem value="test">{t("debug.typeTest")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {debugConfig.type === "node" && (
              <div className="flex-1 min-w-[200px]">
                <Label>{t("debug.program")}</Label>
                <Input
                  value={debugConfig.program}
                  onChange={e => setDebugConfig(prev => ({ ...prev, program: e.target.value }))}
                  placeholder="index.js"
                  className="mt-1"
                />
              </div>
            )}

            {debugConfig.type === "test" && (
              <>
                <div className="flex-1 min-w-[200px]">
                  <Label>{t("debug.testCommand")}</Label>
                  <Input
                    value={debugConfig.testCommand}
                    onChange={e => setDebugConfig(prev => ({ ...prev, testCommand: e.target.value }))}
                    className="mt-1"
                  />
                </div>
                <div className="min-w-[180px]">
                  <Label>{t("debug.framework")}</Label>
                  <Select value={debugConfig.testFramework} onValueChange={v => setDebugConfig(prev => ({ ...prev, testFramework: v as any }))} className="mt-1 w-full">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="jest">Jest</SelectItem>
                      <SelectItem value="vitest">Vitest</SelectItem>
                      <SelectItem value="playwright">Playwright</SelectItem>
                      <SelectItem value="cypress">Cypress</SelectItem>
                      <SelectItem value="mocha">Mocha</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <Button onClick={createSession} disabled={isCreatingSession} size="sm">
              {isCreatingSession ? t("debug.creating") : t("debug.createSession")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="mb-4">
          <TabsTrigger value="sessions">{t("debug.sessions")} <Badge variant="secondary">{sessions.length}</Badge></TabsTrigger>
          <TabsTrigger value="breakpoints">{t("debug.breakpoints")} <Badge variant="secondary">{breakpoints.length}</Badge></TabsTrigger>
          <TabsTrigger value="variables">{t("debug.variables")} <Badge variant="secondary">{variables.length}</Badge></TabsTrigger>
          <TabsTrigger value="tests">{t("debug.testRuns")} <Badge variant="secondary">{testRuns.length}</Badge></TabsTrigger>
          <TabsTrigger value="autoFix">{t("debug.autoFix")}</TabsTrigger>
        </TabsList>

        {/* Sessions Tab */}
        <TabsContent value="sessions" className="flex-1 overflow-auto space-y-3 p-2">
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <svg className="w-12 h-12 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              <p>{t("debug.noSessions")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map(session => (
                <Card
                  key={session.id}
                  className={selectedSession?.id === session.id ? "ring-2 ring-primary" : ""}
                  onClick={() => setSelectedSession(selectedSession?.id === session.id ? null : session)}
                >
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <Badge variant={statusColors[session.status]} className="text-sm w-24">
                          {session.status}
                        </Badge>
                        <div>
                          <p className="font-medium text-sm">{session.type}</p>
                          <p className="text-xs text-muted-foreground">{session.id}</p>
                        </div>
                        {session.config.program && (
                          <span className="text-sm text-muted-foreground font-mono">{session.config.program}</span>
                        )}
                        {session.config.testCommand && (
                          <span className="text-sm text-muted-foreground font-mono">{session.config.testCommand}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {session.status === "running" || session.status === "paused" ? (
                          <>
                            {session.status === "running" && (
                              <Button size="sm" variant="outline" onClick={e => { e.stopPropagation(); sendDebugAction("pause"); }}>
                                {t("debug.pause")}
                              </Button>
                            )}
                            {session.status === "paused" && (
                              <>
                                <Button size="sm" onClick={e => { e.stopPropagation(); sendDebugAction("continue"); }}>
                                  {t("debug.continue")}
                                </Button>
                                <Button size="sm" variant="outline" onClick={e => { e.stopPropagation(); sendDebugAction("stepOver"); }}>
                                  {t("debug.stepOver")}
                                </Button>
                                <Button size="sm" variant="outline" onClick={e => { e.stopPropagation(); sendDebugAction("stepInto"); }}>
                                  {t("debug.stepInto")}
                                </Button>
                                <Button size="sm" variant="outline" onClick={e => { e.stopPropagation(); sendDebugAction("stepOut"); }}>
                                  {t("debug.stepOut")}
                                </Button>
                              </>
                            )}
                            <Button size="sm" variant="destructive" onClick={e => { e.stopPropagation(); sendDebugAction("stop"); }}>
                              {t("debug.stop")}
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" variant="outline" onClick={e => { e.stopPropagation(); sendDebugAction("restart"); }}>
                            {t("debug.restart")}
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Breakpoints Tab */}
        <TabsContent value="breakpoints" className="flex-1 overflow-auto space-y-3 p-2">
          {breakpoints.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <svg className="w-12 h-12 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p>{t("debug.noBreakpoints")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {breakpoints.map(bp => (
                <Card key={bp.id}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4 flex-1">
                        <Badge variant={bp.verified ? "success" : "outline"} className="text-sm">
                          {bp.verified ? t("debug.verified") : t("debug.pending")}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{bp.file}</p>
                          <p className="text-xs text-muted-foreground">{t("debug.line")} {bp.line} {bp.condition ? `• ${t("debug.condition")}: ${bp.condition}` : ""}</p>
                        </div>
                      </div>
                      <Button size="sm" variant="destructive" onClick={() => removeBreakpoint(bp.id)}>
                        {t("debug.remove")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="text-base">{t("debug.addBreakpoint")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-3">
                <Input
                  value={newBreakpoint.file}
                  onChange={e => setNewBreakpoint(prev => ({ ...prev, file: e.target.value }))}
                  placeholder={t("debug.filePlaceholder")}
                />
                <Input
                  type="number"
                  value={newBreakpoint.line}
                  onChange={e => setNewBreakpoint(prev => ({ ...prev, line: parseInt(e.target.value) || 1 }))}
                  placeholder={t("debug.linePlaceholder")}
                  min={1}
                  className="w-32"
                />
                <Input
                  value={newBreakpoint.condition}
                  onChange={e => setNewBreakpoint(prev => ({ ...prev, condition: e.target.value }))}
                  placeholder={t("debug.conditionPlaceholder")}
                />
              </div>
              <Button onClick={setBreakpoint} disabled={!newBreakpoint.file || !newBreakpoint.line} className="w-full md:w-auto">
                {t("debug.add")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Variables Tab */}
        <TabsContent value="variables" className="flex-1 overflow-auto p-2">
          {variables.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <svg className="w-12 h-12 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p>{selectedSession?.status === "paused" ? t("debug.noVariables") : t("debug.sessionNotPaused")}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("debug.name")}</TableHead>
                  <TableHead>{t("debug.value")}</TableHead>
                  <TableHead>{t("debug.type")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variables.map((v, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-sm">{v.name}</TableCell>
                    <TableCell className="font-mono text-sm max-w-xs truncate">{v.value}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{v.type}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        {/* Tests Tab */}
        <TabsContent value="tests" className="flex-1 overflow-auto space-y-3 p-2">
          <div className="flex items-center justify-between mb-4">
            <div className="flex-1 min-w-[200px]">
              <Label className="mr-2">{t("debug.testCommand")}</Label>
              <Input
                value={debugConfig.testCommand}
                onChange={e => setDebugConfig(prev => ({ ...prev, testCommand: e.target.value }))}
                className="w-full md:w-64 inline-block"
              />
            </div>
            <div className="min-w-[180px]">
              <Label className="mr-2">{t("debug.framework")}</Label>
              <Select value={debugConfig.testFramework} onValueChange={v => setDebugConfig(prev => ({ ...prev, testFramework: v as any }))} className="w-full inline-block">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="jest">Jest</SelectItem>
                  <SelectItem value="vitest">Vitest</SelectItem>
                  <SelectItem value="playwright">Playwright</SelectItem>
                  <SelectItem value="cypress">Cypress</SelectItem>
                  <SelectItem value="mocha">Mocha</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={runTests} disabled={isRunningTests} size="sm">
              {isRunningTests ? t("debug.running") : t("debug.runTests")}
            </Button>
          </div>

          {testRuns.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <svg className="w-12 h-12 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p>{t("debug.noTestRuns")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {testRuns.map(run => (
                <Card
                  key={run.id}
                  className={selectedTestRun?.id === run.id ? "ring-2 ring-primary" : ""}
                  onClick={() => setSelectedTestRun(selectedTestRun?.id === run.id ? null : run)}
                >
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <Badge variant={testStatusColors[run.status]} className="text-sm w-24">
                          {run.status}
                        </Badge>
                        <div>
                          <p className="font-medium text-sm">{run.framework}</p>
                          <p className="text-xs text-muted-foreground font-mono">{run.command}</p>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{t("debug.passed")}: {run.summary.passed}</span>
                          <span>{t("debug.failed")}: {run.summary.failed}</span>
                          <span>{t("debug.skipped")}: {run.summary.skipped}</span>
                          <span>{t("debug.duration")}: {run.summary.duration}ms</span>
                        </div>
                      </div>
                      {run.status === "failed" && (
                        <Button size="sm" onClick={e => { e.stopPropagation(); runAutoFix(run.id); }} disabled={isAutoFixing}>
                          {isAutoFixing ? t("debug.fixing") : t("debug.autoFix")}
                        </Button>
                      )}
                    </div>

                    {selectedTestRun?.id === run.id && (
                      <div className="mt-4 space-y-2">
                        <ScrollArea className="max-h-96">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>{t("debug.testFile")}</TableHead>
                                <TableHead>{t("debug.testName")}</TableHead>
                                <TableHead className="w-24">{t("debug.status")}</TableHead>
                                <TableHead className="w-24">{t("debug.duration")}</TableHead>
                                <TableHead>{t("debug.error")}</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {run.results.map((result, i) => (
                                <TableRow key={i}>
                                  <TableCell className="font-mono text-sm">{result.file}</TableCell>
                                  <TableCell className="font-mono text-sm">{result.name}</TableCell>
                                  <TableCell>
                                    <Badge variant={result.status === "passed" ? "success" : result.status === "failed" ? "destructive" : "outline"}>
                                      {result.status}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-xs">{result.duration}ms</TableCell>
                                  <TableCell className="text-xs text-muted-foreground max-w-md truncate font-mono">
                                    {result.error || ""}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </ScrollArea>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Auto-Fix Tab */}
        <TabsContent value="autoFix" className="flex-1 overflow-auto p-2">
          {autoFixResult ? (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>{t("debug.autoFixResult")}</CardTitle>
                    <Badge variant={autoFixResult.fixed ? "success" : "destructive"}>
                      {autoFixResult.fixed ? t("debug.fixed") : t("debug.partialFix")}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-4 md:grid-cols-3 text-sm">
                    <div><strong>{t("debug.attempts")}:</strong> {autoFixResult.attempts}</div>
                    <div><strong>{t("debug.changesMade")}:</strong> {autoFixResult.changes.length}</div>
                    <div><strong>{t("debug.remainingFailures")}:</strong> {autoFixResult.remainingFailures}</div>
                  </div>

                  {autoFixResult.changes.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-2">{t("debug.changes")}</h4>
                      <div className="space-y-2 max-h-96 overflow-auto">
                        {autoFixResult.changes.map((change, i) => (
                          <Card key={i}>
                            <CardHeader className="pb-2">
                              <CardTitle className="text-sm font-mono">{change.file}</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <p className="text-sm text-muted-foreground mb-2">{change.explanation}</p>
                              <pre className="bg-muted p-2 rounded text-xs font-mono overflow-x-auto max-h-40">{change.diff}</pre>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <svg className="w-12 h-12 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <p>{t("debug.noAutoFixResult")}</p>
              <p className="text-sm">Run tests and click "Auto Fix" on a failed run</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}