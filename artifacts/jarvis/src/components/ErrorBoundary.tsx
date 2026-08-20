import { Component, ErrorInfo, ReactNode } from "react";
import { useBuildToasts } from "./build-toast";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ error, errorInfo });
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { error, errorInfo } = this.state;
      const errorMessage = error?.message || "Unknown error";
      const errorStack = errorInfo?.componentStack || "";

      // We can't use hooks here since this is a class component
      // We'll use a simple inline button that posts to the local-model endpoint

      return (
        <div
          style={{
            padding: "24px",
            borderRadius: "12px",
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text)",
            maxWidth: "800px",
            margin: "24px auto",
            fontFamily: "var(--font-sans)",
          }}
          role="alert"
        >
          <h2
            style={{
              margin: "0 0 12px",
              fontSize: "18px",
              fontWeight: 600,
              color: "var(--color-error)",
            }}
          >
            Something went wrong
          </h2>
          <p style={{ margin: "0 0 16px", color: "var(--color-text-muted)" }}>
            {errorMessage}
          </p>

          {errorStack && (
            <details
              style={{
                marginBottom: "16px",
                background: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
                padding: "12px",
                fontSize: "12px",
                fontFamily: "var(--font-mono)",
                overflow: "auto",
                maxHeight: "200px",
              }}
            >
              <summary style={{ cursor: "pointer", marginBottom: "8px", color: "var(--color-text-muted)" }}>
                Stack trace
              </summary>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{errorStack}</pre>
            </details>
          )}

          <button
            onClick={async () => {
              try {
                const response = await fetch("/api/jarvis/local-model/fix", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    error: errorStack || errorMessage,
                    context: "React component error caught by ErrorBoundary",
                  }),
                });
                const data = await response.json();
                if (data.fixes?.length > 0) {
                  alert(
                    `${data.fixes.length} fix(es) proposed by local AI.\n\n` +
                      data.fixes
                        .map((f: { file: string; explanation: string }) => `${f.file}: ${f.explanation}`)
                        .join("\n\n")
                  );
                } else {
                  alert("Local AI could not generate a fix. Check that Ollama is running.");
                }
              } catch (err) {
                console.error("[ErrorBoundary] Fix request failed:", err);
                alert("Failed to request fix from local AI.");
              }
            }}
            style={{
              padding: "10px 20px",
              borderRadius: "8px",
              background: "var(--color-primary)",
              color: "white",
              border: "none",
              fontWeight: 500,
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            Fix with Local AI
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Hook version for functional components that need to show error UI
export function useErrorHandler() {
  const { error: toastError } = useBuildToasts();

  return (error: Error, context?: string) => {
    console.error("[ErrorHandler]", error);

    toastError("Error", error.message, [
      {
        label: "Fix with Local AI",
        onClick: async () => {
          try {
            const response = await fetch("/api/jarvis/local-model/fix", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ error: error.message, context }),
            });
            const data = await response.json();
            if (data.fixes?.length > 0) {
              // In a real app, you'd show these in a debug panel
              alert(
                `${data.fixes.length} fix(es) proposed.\n\n` +
                  data.fixes
                    .map((f: { file: string; explanation: string }) => `${f.file}: ${f.explanation}`)
                    .join("\n\n")
              );
            } else {
              alert("Local AI could not generate a fix. Check that Ollama is running.");
            }
          } catch (err) {
            console.error("[ErrorHandler] Fix request failed:", err);
            alert("Failed to request fix from local AI.");
          }
        },
        variant: "primary",
      },
    ]);
  };
}

export default ErrorBoundary;