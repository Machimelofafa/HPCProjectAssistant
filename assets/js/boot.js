import './state/store.js';
import './app.js';

window.addEventListener('DOMContentLoaded', () => {
  if (typeof window.appBoot === 'function') {
    window.appBoot();
  }
});
