import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. Catches unexpected render/effect errors so a bad
 * page doesn't blank the whole app. Not a replacement for per-request error
 * UI — React Query surfaces those inline where they occur.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private readonly reset = () => this.setState({ error: null });

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return <DefaultFallback error={error} reset={this.reset} />;
  }
}

function DefaultFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="error-boundary">
      <div className="error-boundary-inner">
        <h1>Something went wrong.</h1>
        <p className="sub">
          The page hit an error and could not render. This is a bug — please
          report it.
        </p>
        <pre>{error.message}</pre>
        <div className="modal-actions">
          <button className="btn" onClick={reset}>Try again</button>
          <button className="btn ghost" onClick={() => window.location.assign('/')}>
            Back home
          </button>
        </div>
      </div>
    </div>
  );
}
