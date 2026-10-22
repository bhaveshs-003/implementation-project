import React from 'react';

export default function ProgressBar({ value = 0, max = 100, color, height = 8, showLabel = false }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const fillStyle = { width: `${pct}%` };
  if (color) fillStyle.background = color;
  if (pct === 100 && !color) fillStyle.background = 'linear-gradient(90deg, #10b981, #059669)';

  return (
    <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-track" style={{ height }}>
        <div className="progress-fill" style={fillStyle} />
      </div>
      {showLabel && <span className="progress-label">{pct}%</span>}
    </div>
  );
}
