import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { startSse } from './sse';
import './theme.css';
import './app.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('missing #root element');
}

// Global SSE hookup (PLAN.md §7): connects once for the app's lifetime and
// wires ws-change events into the store, independent of which panel is
// mounted. Reconnects with backoff on connection loss (see sse.ts).
startSse();

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
