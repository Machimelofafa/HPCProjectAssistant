import '@testing-library/dom';
import { jest } from '@jest/globals';
import '../assets/js/app.js';

describe('debounce utility', () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });
  afterAll(() => {
    jest.useRealTimers();
  });
  test('debounce delays function execution', () => {
    const fn = jest.fn();
    const debounced = window.debounce(fn, 100);
    debounced();
    debounced();
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
