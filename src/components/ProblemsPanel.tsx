import { useState } from 'react';

export default function ProblemsPanel() {
  const [filter, setFilter] = useState('');

  return (
    <div className="problems-panel-container">
      <div className="panel-toolbar">
        <div className="panel-toolbar-left">
          <input
            type="text"
            className="panel-filter-input"
            placeholder="Filter problems (e.g. text, file)…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="panel-toolbar-right">
          <span className="problems-counter">Diagnostics unavailable</span>
        </div>
      </div>

      <div className="problems-content">
        <div className="problems-empty-box">
          <h3>Diagnostics are not available yet</h3>
          <p>Crumb is not connected to a diagnostics provider.</p>
        </div>
      </div>
    </div>
  );
}
