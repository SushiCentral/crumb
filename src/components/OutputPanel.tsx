export default function OutputPanel() {
  return (
    <div style={{ padding: '16px', color: '#ccc', fontFamily: 'monospace', fontSize: '13px', overflowY: 'auto', height: '100%' }}>
      <p style={{ margin: 0, opacity: 0.5 }}>[Output] Waiting for build or runtime events...</p>
    </div>
  );
}
