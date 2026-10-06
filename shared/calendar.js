/*
 * XOLVE calendar, shared by every game.
 * Turns a date into a day number, so the same date gives the same puzzle number
 * (and the same seed) in every game.
 */
const XolveCalendar = (() => {
  'use strict';
  const LAUNCH_EPOCH_DAY = Date.UTC(2026, 9, 1) / 864e5; // Puzzle #1 = 1 October 2026

  /* 0 = Sunday ... 6 = Saturday. 1 Jan 1970 (epoch day 0) was a Thursday. */
  const weekdayOf = (epochDay) => (((epochDay + 4) % 7) + 7) % 7;

  function infoFromEpoch(epochDay) {
    const iso = new Date(epochDay * 864e5).toISOString().slice(0, 10);
    return { epochDay, iso, number: epochDay - LAUNCH_EPOCH_DAY + 1 };
  }
  /* The calendar date in the player's own time zone. */
  function localEpochDay(date) {
    return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 864e5);
  }
  const dayInfo = (date) => infoFromEpoch(localEpochDay(date));

  return { LAUNCH_EPOCH_DAY, weekdayOf, infoFromEpoch, localEpochDay, dayInfo };
})();

if (typeof module !== 'undefined') module.exports = XolveCalendar; // lets Node run the tests
