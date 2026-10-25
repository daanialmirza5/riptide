import { Component, type ReactNode } from "react";

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Keeps the rest of the app usable if WebGL is missing or the 3D scene crashes. */
export default class SceneBoundary extends Component<{ children: ReactNode; label?: string }, { failed: boolean; key: number }> {
  state = { failed: !webglAvailable(), key: 0 };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(err: unknown) {
    console.error("3D scene failed", err);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="grid h-full place-items-center p-6 text-center">
          <div className="glass max-w-sm p-5">
            <div className="text-sm font-medium text-slate-100">{this.props.label ?? "3D view"} unavailable</div>
            <p className="mt-1 text-xs text-slate-400">
              This browser couldn't start WebGL. Everything else keeps working: forecasts, root cause and recovery are all in the side panels.
            </p>
            <button className="btn-ghost mt-3 text-xs" onClick={() => this.setState((s) => ({ failed: false, key: s.key + 1 }))}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return <div key={this.state.key} className="h-full w-full">{this.props.children}</div>;
  }
}
