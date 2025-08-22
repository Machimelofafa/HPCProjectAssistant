import { parseDuration } from '../assets/js/core/duration.js';
import { makeCalendar, parseDate } from '../assets/js/core/date-cal.js';
import { normalizeDeps } from '../assets/js/core/deps.js';

global.parseDuration = parseDuration;
global.makeCalendar = makeCalendar;
global.parseDate = parseDate;
global.normalizeDeps = normalizeDeps;

import { computeCPM } from '../assets/js/core/cpm.js';

describe('computeCPM', () => {
  test('calculates task order and early start', () => {
    const project = {
      calendar: 'workdays',
      startDate: '01-01-2023',
      tasks: [
        { id: 'A', name: 'A', duration: '2', deps: [], active: true },
        { id: 'B', name: 'B', duration: '3', deps: ['A'], active: true }
      ]
    };
    const result = computeCPM(project);
    expect(result.order).toEqual(['A', 'B']);
    const taskB = result.tasks.find(t => t.id === 'B');
    expect(taskB.es).toBe(2);
  });
});
