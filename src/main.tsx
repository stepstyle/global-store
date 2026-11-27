// ⚠️ Must stay the FIRST import: installs the sandbox network allow-list before any other module runs.
import './config/sandboxNetGuard';
// then: a browser that refuses web storage gets an in-memory one (otherwise the app stops on a blank page)
import './config/safeStorage';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
