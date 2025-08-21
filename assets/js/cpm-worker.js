'use strict';

// Load shared helpers.
importScripts('core/date-cal.js', 'core/duration.js', 'core/deps.js', 'core/cpm.js');

// --- Worker message handler ---
self.onmessage = function(e) {
  if (e.data && e.data.type === 'compute') {
    const project = e.data.project;
    const cpmResult = computeCPM(project);
    // Post the result back to the main thread
    self.postMessage({ type: 'result', cpm: cpmResult });
  }
};
