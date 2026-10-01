import { useState } from 'react';

interface OutputMessage {
  id: string;
  time: string;
  channel: string;
  text: string;
}

export default function OutputPanel() {
  const [channel, setChannel] = useState<'build' | 'tasks' | 'general'>('general');
  const [messages, setMessages] = useState<OutputMessage[]>([]);

  const clearOutput = () => {
    setMessages([]);
  };

  const filtered = messages.filter((m) => m.channel === channel);

  return (
    <div className="output-panel-container">
      <div className="panel-toolbar">
        <div className="panel-toolbar-left">
          <label htmlFor="output-channel-select" className="panel-toolbar-label">Channel:</label>
          <select
            id="output-channel-select"
            className="panel-select"
            value={channel}
            onChange={(e) => setChannel(e.target.value as 'build' | 'tasks' | 'general')}
          >
            <option value="general">General</option>
            <option value="build">Build</option>
            <option value="tasks">Tasks</option>
          </select>
        </div>
        <div className="panel-toolbar-right">
          <button className="panel-btn" onClick={clearOutput} title="Clear Output">
            Clear
          </button>
        </div>
      </div>

      <div className="output-content" style={{ fontFamily: 'var(--code-font)' }}>
        {filtered.length === 0 ? (
          <div className="panel-empty-state">No output source is connected to this channel yet.</div>
        ) : (
          filtered.map((msg) => (
            <div key={msg.id} className="output-line">
              <span className="output-time">[{msg.time}]</span>
              <span className="output-channel">[{msg.channel.toUpperCase()}]</span>
              <span className="output-text">{msg.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
