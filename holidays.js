// Canadian federal government public holidays (federal public service calendar),
// plus helpers for working days.
//
// Holidays included:
//   New Year's Day, Good Friday, Easter Monday, Victoria Day, Canada Day,
//   Civic Holiday, Labour Day, National Day for Truth and Reconciliation,
//   Thanksgiving, Remembrance Day, Christmas Day, Boxing Day.
//
// When a fixed-date holiday falls on a weekend, it moves to the next working day
// (e.g. Canada Day on a Sunday is observed Monday July 2; Christmas on a Saturday
// is observed Monday Dec 27 and Boxing Day then moves to Tuesday Dec 28).

// Turn a Date into "YYYY-MM-DD" using the local calendar (not UTC)
function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Turn "YYYY-MM-DD" back into a local Date
function fromISODate(text) {
  const [y, m, d] = text.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function isWeekend(date) {
  const day = date.getDay(); // 0 = Sunday, 6 = Saturday
  return day === 0 || day === 6;
}

// Easter Sunday (Gregorian calendar), using the well-known "anonymous" algorithm
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// The nth Monday of a month (month is 0-based: 0 = January)
function nthMonday(year, month, n) {
  const date = new Date(year, month, 1);
  while (date.getDay() !== 1) date.setDate(date.getDate() + 1);
  date.setDate(date.getDate() + 7 * (n - 1));
  return date;
}

// The last Monday on or before a given day (month is 0-based)
function lastMondayOnOrBefore(year, month, day) {
  let date = new Date(year, month, day);
  while (date.getDay() !== 1) date = addDays(date, -1);
  return date;
}

// Returns a Set of "YYYY-MM-DD" strings: the days off for that year
function federalHolidays(year) {
  const holidays = new Set();

  // Fixed-date holidays: if on a weekend (or a day already taken), move forward
  function addFixed(month, day) {
    let date = new Date(year, month, day);
    while (isWeekend(date) || holidays.has(toISODate(date))) {
      date = addDays(date, 1);
    }
    holidays.add(toISODate(date));
  }

  // Holidays that always land on a weekday
  function addExact(date) {
    holidays.add(toISODate(date));
  }

  const easter = easterSunday(year);

  addFixed(0, 1);                              // New Year's Day
  addExact(addDays(easter, -2));               // Good Friday
  addExact(addDays(easter, 1));                // Easter Monday
  addExact(lastMondayOnOrBefore(year, 4, 24)); // Victoria Day: Monday before May 25
  addFixed(6, 1);                              // Canada Day
  addExact(nthMonday(year, 7, 1));             // Civic Holiday: 1st Monday of August
  addExact(nthMonday(year, 8, 1));             // Labour Day: 1st Monday of September
  addFixed(8, 30);                             // National Day for Truth and Reconciliation
  addExact(nthMonday(year, 9, 2));             // Thanksgiving: 2nd Monday of October
  addFixed(10, 11);                            // Remembrance Day
  addFixed(11, 25);                            // Christmas Day
  addFixed(11, 26);                            // Boxing Day

  return holidays;
}

function isHoliday(date) {
  return federalHolidays(date.getFullYear()).has(toISODate(date));
}

function isWorkingDay(date) {
  return !isWeekend(date) && !isHoliday(date);
}

// Default end date: yesterday, stepping back until it's a working day
function defaultEndDate(today = new Date()) {
  let date = addDays(new Date(today.getFullYear(), today.getMonth(), today.getDate()), -1);
  while (!isWorkingDay(date)) {
    date = addDays(date, -1);
  }
  return date;
}
