import React from "react";

interface ToggleProps {
  on: boolean;
  onChange: () => void;
}

export function Toggle({ on, onChange }: ToggleProps) {
  return (
    <div className="toggle" onClick={onChange} style={{ background: on ? `linear-gradient(135deg,#6366f1,#a78bfa)` : "#1a2035" }}>
      <div className="toggle-knob" style={{ left: on ? 19 : 3 }} />
    </div>
  );
}
