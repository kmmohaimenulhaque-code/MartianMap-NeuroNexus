import { Component } from "react";

/* Keeps one failing view from blanking the whole console; shows the error instead of a fabricated fallback. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(`[${this.props.label ?? "view"}]`, error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="nn-error-card" role="alert">
        <strong>{this.props.label ?? "VIEW"} STOPPED · {String(this.state.error.message ?? this.state.error)}</strong>
        <span>The rest of the console keeps working. No value was substituted for the failed view.</span>
        <button type="button" onClick={() => this.setState({ error: null })}>
          RETRY VIEW
        </button>
      </div>
    );
  }
}
