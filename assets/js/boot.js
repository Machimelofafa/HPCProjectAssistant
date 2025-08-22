// Bootstraps the application using ES modules
import './core/date-cal.js';
import './core/duration.js';
import './core/deps.js';
import './core/cpm.js';
import './state/store.js';
import './app.js';

window.addEventListener('DOMContentLoaded', () => {
  if (typeof window.boot === 'function') {
    window.boot();
  }
});

