import type { TargetApp } from "../types";

interface Props {
  value: TargetApp;
  onChange: (value: TargetApp) => void;
  className?: string;
}

export function AppTargetSelector({ value, onChange, className = "" }: Props) {
  return (
    <div className={`app-target-selector ${className}`}>
      <label htmlFor="app-target-select" className="sr-only">
        Target Engine
      </label>
      <select
        id="app-target-select"
        value={value}
        onChange={(e) => onChange(e.target.value as TargetApp)}
        className="app-target-dropdown select-input"
        title="Switch Target AI Engine (Antigravity 2 vs Antigravity IDE)"
      >
        <option value="all">🌐 All Engines</option>
        <option value="antigravity">🚀 Antigravity 2</option>
        <option value="antigravity-ide">⚡ Antigravity IDE</option>
      </select>
    </div>
  );
}
