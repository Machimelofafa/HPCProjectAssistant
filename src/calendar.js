import { fmtDate, isWeekend, addDays, daysBetween } from './utils.js';

export function makeCalendar(mode, holidaysSet) {
    const isHoliday = d => holidaysSet.has(fmtDate(d));

    function isWorkday(d) {
        return mode === 'calendar' ? true : (!isWeekend(d) && !isHoliday(d));
    }

    function addBusinessDays(start, n) {
        let d = new Date(start);
        let step = n >= 0 ? 1 : -1;
        let count = 0;
        while (count !== n) {
            d.setDate(d.getDate() + step);
            if (isWorkday(d)) count += step;
        }
        return d;
    }

    function diffBusinessDays(start, end) {
        let d = new Date(start);
        let n = 0;
        const step = start < end ? 1 : -1;
        while ((step > 0 ? d < end : d > end)) {
            d.setDate(d.getDate() + step);
            if (isWorkday(d)) n += step;
        }
        return n;
    }

    return {
        mode,
        isWorkday,
        add: (start, n) => mode === 'calendar' ? addDays(start, n) : addBusinessDays(start, n),
        diff: (start, end) => mode === 'calendar' ? daysBetween(start, end) : diffBusinessDays(start, end)
    };
}
