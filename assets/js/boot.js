import './app.js';

window.addEventListener('DOMContentLoaded', () => {
  if (typeof window.boot === 'function') {
    window.boot();
  }
});
