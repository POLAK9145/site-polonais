import React from 'react';
import VideoClipper from './VideoClipper.jsx';

export default function App() {
  return (
    <div style={{ background: '#0d0d0f', minHeight: '100vh' }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0d0d0f; }
        @keyframes spin { to { transform: rotate(360deg); } }
        input:focus { border-color: #8b5cf6 !important; box-shadow: 0 0 0 3px rgba(139,92,246,0.15); }
        input[type=range] { cursor: pointer; }
        details > summary { list-style: none; }
        details > summary::-webkit-details-marker { display: none; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #18181b; }
        ::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 3px; }
      `}</style>
      <VideoClipper />
    </div>
  );
}
