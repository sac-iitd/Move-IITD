import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** When this value changes (e.g. the route), a crashed boundary resets and re-renders. */
  resetKey?: unknown;
  /** "page" keeps the app shell visible; "app" is the last-resort full screen. */
  variant?: 'page' | 'app';
}

interface State {
  error: Error | null;
}

/** Catches render errors so one broken page never blanks the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error', error, info.componentStack);
  }

  override componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    // A new deploy can make old lazy-loaded chunks disappear; a reload fetches the new ones.
    const chunkMissing = /Loading chunk|dynamically imported module|Failed to fetch/i.test(
      this.state.error.message,
    );
    return (
      <div role="alert" className="pop-in mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl font-bold">
          {chunkMissing
            ? 'A newer version of MoveIITD is available'
            : 'Something went wrong on this page'}
        </h1>
        <p className="mt-2 text-sm">
          {chunkMissing
            ? 'Reload to get the latest version.'
            : 'The rest of the app still works. Try again, or go back and continue.'}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          {!chunkMissing && this.props.variant !== 'app' && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
          )}
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
