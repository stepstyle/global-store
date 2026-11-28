// ⚠️ Must stay the FIRST import: installs the sandbox network allow-list before any other module runs.
import './config/sandboxNetGuard';
// then: a browser that refuses web storage gets an in-memory one (otherwise the app stops on a blank page)
import './config/safeStorage';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { stashReviewToken } from './services/reviewLink';

// a private review link (#/review/<order>/<token>): the token leaves the address bar BEFORE anything renders or any
// analytics (after consent) could read the URL; it is kept for this tab only
try { stashReviewToken(window.location, window.sessionStorage, window.history); } catch { /* storage refused */ }

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
