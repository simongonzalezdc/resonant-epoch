#!/usr/bin/env node
import {
  CANONICAL_TOOL_NAMES,
  CURRENT_BASIS_VERSION,
  ESTIMATE_UNIT_TO_HOURS,
  ESTIMATION_TOOL_NAMES,
  LEGACY_BASIS_VERSION,
  MODEL_CALIBRATIONS,
  UNIT_SUSPECT_FLAG_HINT,
  assertNever,
  batchRecordActuals,
  calibrateEstimates,
  cocomoEstimate,
  composePertCorrectionFactor,
  computeAccuracyMetrics,
  criticalPath,
  extractEstimatedHours,
  getAllModelPricing,
  getCalibrationData,
  getCocomoDerivedFactors,
  getCocomoProjects,
  getEstimationResearch,
  getFeedbackHealthReport,
  getGlobalCorrectionFactor,
  getHumanBaselines,
  getModelPricing,
  getPendingEstimates,
  getPertToolTaskCorrection,
  getScopeGuide,
  getTelemetry,
  inferScopeFromComplexity,
  isExcluded,
  isPertLearnedCorrectionEnabled,
  loadLedgerWithOverlays,
  minNForVerdict,
  monteCarloSim,
  notifyToolCall,
  pertEstimate,
  recordActualDetailed,
  recordEstimate,
  recordToolCall,
  referenceClassEstimate,
  sprintForecast,
  tokenTimeBridge
} from "./chunk-K22BNBU4.js";

// src/dispatcher/index.ts
import { ZodError } from "zod";

// src/dispatcher/tool-registry.ts
import { z as z2 } from "zod";

// src/lib/temporal.ts
import {
  format,
  parseISO,
  addDays as dateFnsAddDays,
  differenceInSeconds
} from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

// src/lib/internal/error-helpers.ts
function makeError(message, retryHint) {
  return { isError: true, message, retryHint };
}
function isInternalError(error) {
  return error.errorKind === "internal";
}
function isStorageError(error) {
  return error.errorKind === "storage";
}
function makeValidationError(message, retryHint) {
  return { isError: true, errorKind: "validation", message, retryHint };
}
function makeInternalError(message, retryHint) {
  return { isError: true, errorKind: "internal", message, retryHint };
}
function makeStorageError(message, retryHint) {
  return { isError: true, errorKind: "storage", message, retryHint };
}
function formatIssuePath(path) {
  return path.map(
    (segment) => typeof segment === "symbol" ? segment.description ?? String(segment) : String(segment)
  ).join(".");
}
var ZOD_DEFAULT_BOUND_PREFIX = /^Too (?:small|big): expected /;
function readableBoundMessage(issueCode, meta) {
  const plural = (noun, n) => `${noun}${n === 1 ? "" : "s"}`;
  if (issueCode === "too_small") {
    const min = meta.minimum;
    const inclusive = meta.inclusive !== false;
    if (typeof min === "number") {
      switch (meta.origin) {
        case "string":
          return `must be at least ${min} character${min === 1 ? "" : "s"} long`;
        case "array":
          return inclusive ? `must contain at least ${min} ${plural("item", min)}` : `must contain more than ${min} ${plural("item", min)}`;
        default:
          return inclusive ? `must be at least ${min}` : `must be greater than ${min}`;
      }
    }
    if (min instanceof Date) {
      return inclusive ? `must be at or after ${min.toISOString()}` : `must be after ${min.toISOString()}`;
    }
  }
  if (issueCode === "too_big") {
    const max = meta.maximum;
    const inclusive = meta.inclusive !== false;
    if (typeof max === "number") {
      switch (meta.origin) {
        case "string":
          return `must be at most ${max} character${max === 1 ? "" : "s"} long`;
        case "array":
          return inclusive ? `must contain at most ${max} ${plural("item", max)}` : `must contain fewer than ${max} ${plural("item", max)}`;
        default:
          return inclusive ? `must be at most ${max}` : `must be less than ${max}`;
      }
    }
    if (max instanceof Date) {
      return inclusive ? `must be at or before ${max.toISOString()}` : `must be before ${max.toISOString()}`;
    }
  }
  return null;
}
function displayValue(value) {
  const MAX = 60;
  return value.length > MAX ? `${value.slice(0, MAX - 3)}...` : value;
}
function describeReceived(path, rawInput) {
  if (rawInput === null || typeof rawInput !== "object") return null;
  let current = rawInput;
  for (const segment of path) {
    if (current === null || typeof current !== "object") return null;
    current = current[segment];
  }
  if (typeof current === "string") return JSON.stringify(displayValue(current));
  if (typeof current === "number" || typeof current === "bigint" || typeof current === "boolean") {
    return String(current);
  }
  if (current === null) return "null";
  return null;
}
function formatZodIssues(error, rawInput) {
  const lines = error.issues.map((issue) => {
    const meta = issue;
    const path = formatIssuePath(issue.path);
    let message;
    if ((issue.code === "too_small" || issue.code === "too_big") && ZOD_DEFAULT_BOUND_PREFIX.test(issue.message)) {
      message = readableBoundMessage(issue.code, meta) ?? issue.message;
    } else {
      message = issue.message;
    }
    const received = describeReceived(issue.path, rawInput);
    return `${path ? `${path}: ` : ""}${message}${received ? ` \u2014 got ${received}` : ""}`;
  });
  return lines.length > 0 ? lines.join("\n") : "Invalid input.";
}

// src/lib/temporal.ts
function isValidTimezone(tz) {
  if (!tz || tz.length < 2) return false;
  try {
    const now = /* @__PURE__ */ new Date();
    formatInTimeZone(now, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
    return true;
  } catch {
    return false;
  }
}
function parseTimestamp(ts) {
  const parsed = parseISO(ts);
  if (isNaN(parsed.getTime())) {
    return makeError(
      `Invalid timestamp: "${ts}". Use ISO-8601 format like "2026-05-01T14:30:00Z".`,
      "Provide a valid ISO-8601 date string."
    );
  }
  return parsed;
}
function getCurrentTime(timezone) {
  if (!isValidTimezone(timezone)) {
    return {
      ok: false,
      error: makeError(
        `Invalid timezone: "${timezone}". Use IANA identifiers like 'America/New_York'.`,
        "Try a canonical IANA timezone such as 'UTC', 'America/Los_Angeles', or 'Europe/London'."
      )
    };
  }
  const now = /* @__PURE__ */ new Date();
  return {
    ok: true,
    data: {
      iso: formatInTimeZone(now, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      humanReadable: formatInTimeZone(
        now,
        timezone,
        "EEEE, MMMM d, yyyy 'at' h:mm a (zzz)"
      ),
      timezone,
      utcOffset: formatInTimeZone(now, timezone, "XXX")
    }
  };
}
function convertTimezone(timestamp, targetTz) {
  const parsed = parseTimestamp(timestamp);
  if ("isError" in parsed) {
    return { ok: false, error: parsed };
  }
  if (!isValidTimezone(targetTz)) {
    return {
      ok: false,
      error: makeError(
        `Invalid target timezone: "${targetTz}". Use IANA identifiers like 'Asia/Tokyo'.`,
        "Try a canonical IANA timezone such as 'UTC', 'America/Chicago', or 'Europe/Berlin'."
      )
    };
  }
  return {
    ok: true,
    data: {
      iso: formatInTimeZone(parsed, targetTz, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      humanReadable: formatInTimeZone(
        parsed,
        targetTz,
        "EEEE, MMMM d, yyyy 'at' h:mm a (zzz)"
      ),
      timezone: targetTz,
      utcOffset: formatInTimeZone(parsed, targetTz, "XXX")
    }
  };
}
function parseDuration(durationString) {
  if (!durationString || durationString.trim().length === 0) {
    return {
      ok: false,
      error: makeError(
        "Empty duration string.",
        "Provide a duration like '2h30m', '1d6h', '45m', or '1w2d'."
      )
    };
  }
  const input = durationString.trim();
  const TOKEN_RE = /(\d+(?:\.\d+)?)\s*(y|mo|w|d|h|m|s)/g;
  const parts = [];
  let match;
  while ((match = TOKEN_RE.exec(input)) !== null) {
    const value = match[1];
    const unit = match[2];
    if (!value || !unit) continue;
    parts.push({ value: parseFloat(value), unit });
  }
  if (parts.length === 0) {
    return {
      ok: false,
      error: makeError(
        `Could not parse duration: "${input}". No valid duration tokens found.`,
        "Use combinations of y, mo, w, d, h, m, s \u2014 e.g. '2h30m' or '1w3d12h'."
      )
    };
  }
  const reconstructed = parts.map((p) => `${p.value}${p.unit}`).join("");
  const normalisedInput = input.replace(/\s+/g, "");
  if (reconstructed !== normalisedInput) {
    return {
      ok: false,
      error: makeError(
        `Unrecognised tokens in duration: "${input}".`,
        "Use only y, mo, w, d, h, m, s \u2014 e.g. '2h30m', '1d', '3mo2w'."
      )
    };
  }
  let totalSeconds = 0;
  let years = 0;
  let months = 0;
  let weeks = 0;
  let days = 0;
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  for (const part of parts) {
    switch (part.unit) {
      case "y":
        years += part.value;
        totalSeconds += part.value * 365.25 * 24 * 3600;
        break;
      case "mo":
        months += part.value;
        totalSeconds += part.value * 30.44 * 24 * 3600;
        break;
      case "w":
        weeks += part.value;
        totalSeconds += part.value * 7 * 24 * 3600;
        break;
      case "d":
        days += part.value;
        totalSeconds += part.value * 24 * 3600;
        break;
      case "h":
        hours += part.value;
        totalSeconds += part.value * 3600;
        break;
      case "m":
        minutes += part.value;
        totalSeconds += part.value * 60;
        break;
      case "s":
        seconds += part.value;
        totalSeconds += part.value;
        break;
    }
  }
  const segments = [];
  if (years > 0) segments.push(`${years} year${years !== 1 ? "s" : ""}`);
  if (months > 0) segments.push(`${months} month${months !== 1 ? "s" : ""}`);
  if (weeks > 0) segments.push(`${weeks} week${weeks !== 1 ? "s" : ""}`);
  if (days > 0) segments.push(`${days} day${days !== 1 ? "s" : ""}`);
  if (hours > 0) segments.push(`${hours} hour${hours !== 1 ? "s" : ""}`);
  if (minutes > 0)
    segments.push(`${minutes} minute${minutes !== 1 ? "s" : ""}`);
  if (seconds > 0)
    segments.push(`${seconds} second${seconds !== 1 ? "s" : ""}`);
  return {
    ok: true,
    data: {
      input,
      totalSeconds: Math.round(totalSeconds * 100) / 100,
      humanReadable: segments.length > 0 ? segments.join(" ") : "0 seconds"
    }
  };
}
function formatElapsed(ms) {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1e3);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor(totalSeconds % 86400 / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  const segments = [];
  if (days > 0) segments.push(`${days}d`);
  if (hours > 0) segments.push(`${hours}h`);
  if (minutes > 0) segments.push(`${minutes}m`);
  if (seconds > 0 || segments.length === 0) segments.push(`${seconds}s`);
  return segments.join(" ");
}
function addDays(date, days) {
  const parsed = parseISO(date);
  if (isNaN(parsed.getTime())) {
    return "Invalid Date";
  }
  const result = dateFnsAddDays(parsed, days);
  return format(result, "yyyy-MM-dd");
}
function diffDates(start, end) {
  const startDate = parseISO(start);
  const endDate = parseISO(end);
  const totalSeconds = differenceInSeconds(endDate, startDate);
  const absSeconds = Math.abs(totalSeconds);
  const sign = totalSeconds < 0 ? -1 : 1;
  const days = sign * Math.floor(absSeconds / 86400);
  const hours = sign * Math.floor(absSeconds % 86400 / 3600);
  const minutes = sign * Math.floor(absSeconds % 3600 / 60);
  return {
    days,
    hours,
    minutes,
    total_seconds: totalSeconds
  };
}

// src/lib/calendar.ts
import {
  parseISO as parseISO2,
  format as format2,
  isWeekend,
  getDay,
  getHours
} from "date-fns";
import { toZonedTime } from "date-fns-tz";
function parseDate(dateStr) {
  const parsed = parseISO2(dateStr);
  if (isNaN(parsed.getTime())) {
    return makeError(
      `Invalid date: "${dateStr}". Use ISO-8601 format like "2026-05-01".`,
      "Provide a valid ISO-8601 date string."
    );
  }
  return parsed;
}
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
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = (h + l - 7 * m + 114) % 31 + 1;
  return new Date(year, month - 1, day);
}
function nthWeekdayOfMonth(year, month, weekday, n) {
  const first = new Date(year, month, 1);
  const firstDay = getDay(first);
  const offset = (weekday - firstDay + 7) % 7;
  return new Date(year, month, 1 + offset + (n - 1) * 7);
}
function lastWeekdayOfMonth(year, month, weekday) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  const last = new Date(year, month, lastDay);
  const lastDayOfWeek = getDay(last);
  const diff = (lastDayOfWeek - weekday + 7) % 7;
  return new Date(year, month, lastDay - diff);
}
var JP_EQUINOX_TABLE = {
  2024: { shunbun: [2, 20], shubun: [8, 22] },
  2025: { shunbun: [2, 20], shubun: [8, 23] },
  2026: { shunbun: [2, 20], shubun: [8, 23] },
  2027: { shunbun: [2, 21], shubun: [8, 23] },
  2028: { shunbun: [2, 20], shubun: [8, 22] },
  2029: { shunbun: [2, 20], shubun: [8, 23] },
  2030: { shunbun: [2, 20], shubun: [8, 23] }
};
var DEG = Math.PI / 180;
function deltaTSeconds(year) {
  const t = year - 2e3;
  return 62.92 + 0.32217 * t + 5589e-6 * t * t;
}
function jdToGregorian(jd) {
  const z3 = Math.floor(jd + 0.5);
  const f = jd + 0.5 - z3;
  let a = z3;
  if (z3 >= 2299161) {
    const alpha = Math.floor((z3 - 186721625e-2) / 36524.25);
    a = z3 + 1 + alpha - Math.floor(alpha / 4);
  }
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);
  const day = Math.floor(b - d - Math.floor(30.6001 * e) + f);
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;
  return { year, month, day };
}
function astronomicalJpEquinoxDates(year) {
  const equinoxJstJd = (which) => {
    const y = (year - 2e3) / 1e3;
    const jde0 = which === "march" ? 245162380984e-5 + 365242.37404 * y + 0.05169 * y * y - 411e-5 * y ** 3 - 57e-5 * y ** 4 : 245181021715e-5 + 365242.01767 * y - 0.11575 * y * y + 337e-5 * y ** 3 + 78e-5 * y ** 4;
    const t = (jde0 - 2451545) / 36525;
    const w = 35999.373 * t - 2.47;
    const deltaLambda = 1 + 0.0334 * Math.cos(w * DEG) + 7e-4 * Math.cos(2 * w * DEG);
    const terms = [
      [485, 324.96, 1934.136],
      [203, 337.23, 32964.467],
      [199, 342.08, 20.186],
      [182, 27.85, 445267.112],
      [156, 73.14, 45036.886],
      [136, 171.52, 22518.443],
      [77, 222.54, 65928.934],
      [74, 296.72, 3034.906],
      [70, 243.58, 9037.513],
      [58, 119.81, 33718.147],
      [52, 297.17, 150.678],
      [50, 21.02, 2281.226],
      [45, 247.54, 29929.562],
      [44, 325.15, 31555.956],
      [29, 60.93, 4443.417],
      [18, 155.12, 67555.328],
      [17, 288.79, 4562.452],
      [16, 198.04, 62894.029],
      [14, 199.76, 31436.921],
      [12, 95.39, 14577.848],
      [12, 287.11, 31931.756],
      [12, 320.81, 34777.259],
      [9, 227.73, 1222.114],
      [8, 15.45, 16859.074]
    ];
    let s = 0;
    for (const [amp, phase, freq] of terms) {
      s += amp * Math.cos((phase + freq * t) * DEG);
    }
    const jde = jde0 + 1e-5 * s / deltaLambda;
    const jdUt = jde - deltaTSeconds(year) / 86400;
    return jdUt + 9 / 24;
  };
  const toDate = (jd) => {
    const { year: y, month, day } = jdToGregorian(jd);
    return new Date(y, month - 1, day);
  };
  return { shunbun: toDate(equinoxJstJd("march")), shubun: toDate(equinoxJstJd("september")) };
}
function jpEquinoxDates(year) {
  const table = JP_EQUINOX_TABLE[year];
  if (table) {
    return {
      shunbun: new Date(year, table.shunbun[0], table.shunbun[1]),
      shubun: new Date(year, table.shubun[0], table.shubun[1])
    };
  }
  return astronomicalJpEquinoxDates(year);
}
var US_FIXED_DATE_HOLIDAYS = [
  [0, 1],
  // New Year's Day
  [5, 19],
  // Juneteenth
  [6, 4],
  // Independence Day
  [10, 11],
  // Veterans Day
  [11, 25]
  // Christmas Day
];
function usHolidays(year) {
  const holidays = [
    ...US_FIXED_DATE_HOLIDAYS.map(([m, d]) => new Date(year, m, d)),
    nthWeekdayOfMonth(year, 0, 1, 3),
    // MLK Day (3rd Mon Jan)
    nthWeekdayOfMonth(year, 1, 1, 3),
    // Presidents' Day (3rd Mon Feb)
    lastWeekdayOfMonth(year, 4, 1),
    // Memorial Day (last Mon May)
    nthWeekdayOfMonth(year, 8, 1, 1),
    // Labor Day (1st Mon Sep)
    nthWeekdayOfMonth(year, 9, 1, 2),
    // Columbus Day (2nd Mon Oct)
    nthWeekdayOfMonth(year, 10, 3, 4)
    // Thanksgiving (4th Thu Nov)
  ].map(normaliseHolidayDate);
  for (const [month, day] of US_FIXED_DATE_HOLIDAYS) {
    const date = new Date(year, month, day);
    const dow = getDay(date);
    if (dow === 6) {
      holidays.push(normaliseHolidayDate(new Date(year, month, day - 1)));
    } else if (dow === 0) {
      holidays.push(normaliseHolidayDate(new Date(year, month, day + 1)));
    }
  }
  if (getDay(new Date(year + 1, 0, 1)) === 6) {
    holidays.push(normaliseHolidayDate(new Date(year, 11, 31)));
  }
  return holidays;
}
function ukHolidays(year) {
  const easter = easterSunday(year);
  const earlyMay = nthWeekdayOfMonth(year, 4, 1, 1);
  const base = [
    new Date(year, 0, 1),
    // New Year's Day
    normaliseHolidayDate(new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() - 2)),
    // Good Friday
    normaliseHolidayDate(new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() + 1)),
    // Easter Monday
    earlyMay,
    // Early May Bank Holiday
    lastWeekdayOfMonth(year, 4, 1),
    // Spring Bank Holiday (last Mon May)
    lastWeekdayOfMonth(year, 7, 1),
    // Summer Bank Holiday (last Mon Aug)
    new Date(year, 11, 25),
    // Christmas Day
    new Date(year, 11, 26)
    // Boxing Day
  ].map(normaliseHolidayDate);
  const substituted = [];
  const isTaken = (d) => getDay(d) === 0 || getDay(d) === 6 || base.some((h) => h.getTime() === d.getTime()) || substituted.some((h) => h.getTime() === d.getTime());
  for (const holiday of base) {
    if (getDay(holiday) !== 0 && getDay(holiday) !== 6) continue;
    const candidate = new Date(holiday);
    do {
      candidate.setDate(candidate.getDate() + 1);
    } while (isTaken(candidate));
    substituted.push(normaliseHolidayDate(candidate));
  }
  return [...base, ...substituted];
}
function frHolidays(year) {
  const easter = easterSunday(year);
  return [
    new Date(year, 0, 1),
    // Jour de l'An
    normaliseHolidayDate(new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() + 1)),
    // Lundi de Paques
    new Date(year, 4, 1),
    // Fete du Travail
    new Date(year, 4, 8),
    // Victoire 1945
    normaliseHolidayDate(new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() + 39)),
    // Ascension
    normaliseHolidayDate(new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() + 50)),
    // Lundi de Pentecote
    new Date(year, 6, 14),
    // Fete nationale
    new Date(year, 7, 15),
    // Assomption
    new Date(year, 10, 1),
    // Toussaint
    new Date(year, 10, 11),
    // Armistice
    new Date(year, 11, 25)
    // Noel
  ].map(normaliseHolidayDate);
}
function deHolidays(year) {
  const easter = easterSunday(year);
  return [
    new Date(year, 0, 1),
    // Neujahrstag
    normaliseHolidayDate(new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() - 2)),
    // Karfreitag
    normaliseHolidayDate(new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() + 1)),
    // Ostermontag
    new Date(year, 4, 1),
    // Tag der Arbeit
    normaliseHolidayDate(new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() + 39)),
    // Christi Himmelfahrt
    normaliseHolidayDate(new Date(easter.getFullYear(), easter.getMonth(), easter.getDate() + 50)),
    // Pfingstmontag
    new Date(year, 9, 3),
    // Tag der Deutschen Einheit
    new Date(year, 11, 25),
    // Weihnachtstag
    new Date(year, 11, 26)
    // 2. Weihnachtstag
  ].map(normaliseHolidayDate);
}
function jpHolidays(year) {
  const comingOfAge = nthWeekdayOfMonth(year, 0, 1, 2);
  const sportsDay = nthWeekdayOfMonth(year, 9, 1, 2);
  const marineDay = nthWeekdayOfMonth(year, 6, 1, 3);
  const respectAged = nthWeekdayOfMonth(year, 8, 1, 3);
  const { shunbun, shubun } = jpEquinoxDates(year);
  const base = [
    new Date(year, 0, 1),
    // Ganjitsu (New Year)
    comingOfAge,
    // Seijin no Hi
    new Date(year, 1, 11),
    // Kenkoku Kinen no Hi (Foundation Day)
    new Date(year, 1, 23),
    // Tencho Setsu (Emperor's Birthday, since 2020)
    shunbun,
    // Shunbun no Hi (Vernal Equinox)
    new Date(year, 3, 29),
    // Showa no Hi
    new Date(year, 4, 3),
    // Kenpo Kinen Bi (Constitution Day)
    new Date(year, 4, 4),
    // Midori no Hi (Greenery Day)
    new Date(year, 4, 5),
    // Kodomo no Hi (Children's Day)
    marineDay,
    // Umi no Hi
    new Date(year, 7, 11),
    // Yama no Hi (Mountain Day)
    respectAged,
    // Keiro no Hi
    shubun,
    // Shubun no Hi (Autumnal Equinox)
    sportsDay,
    // Taiiku no Hi
    new Date(year, 10, 3),
    // Bunka no Hi (Culture Day)
    new Date(year, 10, 23)
    // Kinro Kansha no Hi (Labor Thanksgiving)
  ].map(normaliseHolidayDate);
  const sandwiches = [];
  for (const holiday of base) {
    const twoAfter = normaliseHolidayDate(new Date(holiday.getFullYear(), holiday.getMonth(), holiday.getDate() + 2));
    const middle = normaliseHolidayDate(new Date(holiday.getFullYear(), holiday.getMonth(), holiday.getDate() + 1));
    if (getDay(middle) !== 0 && base.some((h) => h.getTime() === twoAfter.getTime()) && !base.some((h) => h.getTime() === middle.getTime())) {
      sandwiches.push(middle);
    }
  }
  const substituted = [];
  const isTaken = (d) => getDay(d) === 0 || getDay(d) === 6 || base.some((h) => h.getTime() === d.getTime()) || sandwiches.some((h) => h.getTime() === d.getTime()) || substituted.some((h) => h.getTime() === d.getTime());
  for (const holiday of base) {
    if (getDay(holiday) !== 0) continue;
    const candidate = new Date(holiday);
    do {
      candidate.setDate(candidate.getDate() + 1);
    } while (isTaken(candidate));
    substituted.push(normaliseHolidayDate(candidate));
  }
  return [...base, ...sandwiches, ...substituted];
}
function normaliseHolidayDate(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function dateToKey(d) {
  return format2(d, "yyyy-MM-dd");
}
var CALENDAR_VERSION = "2026.08";
var HolidayRegistry = class {
  registry = /* @__PURE__ */ new Map();
  /** Memoized holiday key-sets per (country, year) — the day-walk hot path. */
  keySetCache = /* @__PURE__ */ new Map();
  computeCount = 0;
  constructor() {
    this.registry.set("US", (year) => usHolidays(year));
    this.registry.set("UK", (year) => ukHolidays(year));
    this.registry.set("FR", (year) => frHolidays(year));
    this.registry.set("DE", (year) => deHolidays(year));
    this.registry.set("JP", (year) => jpHolidays(year));
  }
  /** Returns true if the country code has a registered holiday function. */
  hasCountry(country) {
    return this.registry.has(country.toUpperCase());
  }
  /** Lists all supported country codes. */
  supportedCountries() {
    return [...this.registry.keys()];
  }
  /**
   * Returns the set of holiday dates for a given country and year as
   * a Set of "YYYY-MM-DD" strings for fast lookup. Memoized per
   * (country, year): a multi-year day-walk computes each holiday set once
   * instead of rebuilding it for every day visited.
   */
  holidayDateKeys(country, year) {
    const code = country.toUpperCase();
    const cacheKey = `${code}:${year}`;
    const cached = this.keySetCache.get(cacheKey);
    if (cached) return cached;
    const fn = this.registry.get(code);
    const keys = /* @__PURE__ */ new Set();
    if (fn) {
      this.computeCount++;
      for (const d of fn(year)) keys.add(dateToKey(d));
    }
    this.keySetCache.set(cacheKey, keys);
    return keys;
  }
  /**
   * Returns all holiday Date objects for a given country and year.
   * (Not memoized — the bulk accessor; use holidayDateKeys on hot paths.)
   */
  holidays(country, year) {
    const fn = this.registry.get(country.toUpperCase());
    return fn ? fn(year) : [];
  }
  /** Observability/test hook: how many holiday-set computations have run (vs. cache hits). */
  holidayComputeCount() {
    return this.computeCount;
  }
  /** Test hook: clears the memoization cache (compute counter is preserved). */
  clearHolidayCache() {
    this.keySetCache.clear();
  }
};
var holidayRegistry = new HolidayRegistry();
function addBusinessDays(startDate, days, countryCode) {
  const parsed = parseDate(startDate);
  if ("isError" in parsed) {
    return { ok: false, error: parsed };
  }
  const code = countryCode.toUpperCase();
  const knownCountry = holidayRegistry.hasCountry(code);
  const direction = days >= 0 ? 1 : -1;
  const targetCount = Math.abs(days);
  let added = 0;
  const current = new Date(parsed);
  const holidaysSkipped = [];
  while (added < targetCount) {
    current.setDate(current.getDate() + direction);
    const year = current.getFullYear();
    const holidayKeys = knownCountry ? holidayRegistry.holidayDateKeys(code, year) : /* @__PURE__ */ new Set();
    if (isWeekend(current)) continue;
    if (holidayKeys.has(dateToKey(current))) {
      holidaysSkipped.push(dateToKey(current));
      continue;
    }
    added++;
  }
  return {
    ok: true,
    data: {
      startDate: format2(parsed, "yyyy-MM-dd"),
      endDate: format2(current, "yyyy-MM-dd"),
      businessDays: targetCount,
      countryCode: code,
      calendarVersion: CALENDAR_VERSION,
      humanReadable: `${targetCount} business days from ${format2(parsed, "yyyy-MM-dd")} to ${format2(current, "yyyy-MM-dd")} (${code}).`
    }
  };
}
function countBusinessDays(startDate, endDate, countryCode) {
  const startParsed = parseDate(startDate);
  if ("isError" in startParsed) {
    return { ok: false, error: startParsed };
  }
  const endParsed = parseDate(endDate);
  if ("isError" in endParsed) {
    return { ok: false, error: endParsed };
  }
  const code = countryCode.toUpperCase();
  const knownCountry = holidayRegistry.hasCountry(code);
  const holidaysSkipped = [];
  let businessDays = 0;
  const current = new Date(startParsed);
  current.setDate(current.getDate() + 1);
  const endTime = endParsed.getTime();
  while (current.getTime() <= endTime) {
    const year = current.getFullYear();
    const holidayKeys = knownCountry ? holidayRegistry.holidayDateKeys(code, year) : /* @__PURE__ */ new Set();
    if (!isWeekend(current) && !holidayKeys.has(dateToKey(current))) {
      businessDays++;
    } else if (holidayKeys.has(dateToKey(current)) && !isWeekend(current)) {
      holidaysSkipped.push(dateToKey(current));
    }
    current.setDate(current.getDate() + 1);
  }
  return {
    ok: true,
    data: {
      startDate: format2(startParsed, "yyyy-MM-dd"),
      endDate: format2(endParsed, "yyyy-MM-dd"),
      businessDays,
      countryCode: code,
      calendarVersion: CALENDAR_VERSION,
      humanReadable: `${businessDays} business days between ${format2(startParsed, "yyyy-MM-dd")} and ${format2(endParsed, "yyyy-MM-dd")} (${code}).`
    }
  };
}

// src/schemas/index.ts
import { z } from "zod";
var timeUnitEnum = z.enum(["hours", "days", "weeks", "months"]).describe("Time unit used throughout the estimation result.");
var taskTypeEnum = z.enum([
  "feature",
  "bugfix",
  "refactor",
  "migration",
  "infrastructure",
  "documentation",
  "testing",
  "design"
]).describe("Category of work being estimated for reference-class lookup.");
var aiNativeGradient = z.union([z.boolean(), z.coerce.number().min(0).max(1)]).transform((v) => typeof v === "boolean" ? v ? 1 : 0 : v).describe("Degree of AI assistance: 0.0 = fully human, 1.0 = fully AI-native, 0.5 = hybrid. Accepts boolean for backward compatibility (true=1.0, false=0.0).").default(1);
var reasoningDepthEnum = z.enum(["shallow", "moderate", "deep"]).describe(
  "How much chain-of-thought reasoning the model is expected to perform. Deep reasoning multiplies estimated time."
);
var complexityScale = z.number().min(1).max(5).describe("Fine-tuning complexity from 1 (trivial) to 5 (extreme).");
var taskLabelField = z.string().min(1).describe(
  "Optional free-text label identifying the task this estimate is for (e.g. an issue key or short title). Surfaced on get_pending_estimates output for triage."
).optional();
var projectField = z.string().min(1).describe(
  "Optional project/repo identifier this estimate belongs to, for cross-project analytics."
).optional();
var sessionIdField = z.string().min(1).describe(
  "Optional session identifier (minted by a calling agent/hook) used to deduplicate repeated estimate calls for the same task within a session."
).optional();
var actualUnitEnum = z.enum(["minutes", "hours", "days", "weeks"]).describe(
  "Unit actual_hours is expressed in. Normalized to hours at ingest (days=8h, weeks=40h workday convention, matching estimation.ts's toHours()). Defaults to hours when omitted."
);
var calibrationProvenanceEnum = z.enum([
  "prospective",
  "backfilled_real_session",
  "backfilled_calibration",
  "synthetic",
  "smoke",
  "unknown",
  "auto_wallclock"
]).describe(
  "Optional explicit provenance classification for this actual, consumed by the shared exclusion predicate (synthetic/smoke are excluded from calibration math). auto_wallclock marks a wall-clock-derived actual auto-recorded at session end (never focused-effort-verified) \u2014 included in correction training by default but subject to a dedicated sanity gate and segmented separately in feedback_health."
);
var brandedString = (label) => z.string().describe(`${label} identifier`).brand();
var BUSINESS_DAYS_LIMIT = 1e5;
var businessDaysOffset = z.coerce.number().int({ error: `days must be a whole number of business days (between -${BUSINESS_DAYS_LIMIT} and ${BUSINESS_DAYS_LIMIT}).` }).min(-BUSINESS_DAYS_LIMIT, { error: `days must be >= -${BUSINESS_DAYS_LIMIT}. For larger shifts, call the tool repeatedly or convert to calendar days.` }).max(BUSINESS_DAYS_LIMIT, { error: `days must be <= ${BUSINESS_DAYS_LIMIT}. For larger shifts, call the tool repeatedly or convert to calendar days.` }).describe(`Number of business days to add (negative to subtract). Integer between -${BUSINESS_DAYS_LIMIT} and ${BUSINESS_DAYS_LIMIT}.`);
var TASK_ARRAY_LIMIT = 500;
var MONTE_CARLO_ITERATION_TASK_PRODUCT_LIMIT = 1e7;
var CONTEXT_LENGTH_LIMIT = 5e4;
var timeMathOperationEnum = z.enum([
  "add_days",
  "add_business_days",
  "diff",
  "convert_tz",
  "parse_nl",
  "format_duration"
]).describe(
  "The time arithmetic operation to perform. Each operation expects specific operands."
);
var timeMathSchema = z.object({
  operation: timeMathOperationEnum,
  operands: z.record(z.string(), z.unknown()).describe(
    "Key-value pairs matching the chosen operation's expected fields. See operation documentation for required keys."
  )
});
var pertEstimateSchema = z.object({
  optimistic: z.coerce.number().positive().describe(
    "Best-case duration. Do NOT use your initial optimistic guess \u2014 this should be the absolute minimum if everything goes perfectly."
  ),
  most_likely: z.coerce.number().positive().describe(
    "Mode of the distribution \u2014 the single most probable outcome."
  ),
  pessimistic: z.coerce.number().positive().describe(
    "Worst-case duration accounting for known risks and unknown unknowns."
  ),
  unit: timeUnitEnum.default("hours").describe("Time unit for all three PERT estimates."),
  task_type: taskTypeEnum.describe("Optional task type for feedback matching. Enables per-task-type accuracy tracking.").optional(),
  ai_native: aiNativeGradient,
  complexity: complexityScale.describe(
    "Optional complexity hint from 1 (trivial) to 5 (extreme). Reserved for future per-complexity correction-factor conditioning; not yet applied to the headline estimate."
  ).optional(),
  task_label: taskLabelField,
  project: projectField,
  session_id: sessionIdField
});
var cocomoEstimateSchema = z.object({
  kloc: z.coerce.number().positive().describe(
    "Estimated thousands of lines of code. Count actual code, not comments/blank lines."
  ),
  reasoning_complexity: z.coerce.number().min(0.5).max(2).describe(
    "Multiplier for reasoning complexity of the codebase. 0.5 = trivial CRUD, 1.0 = average, 2.0 = novel algorithm/R&D."
  ).default(1),
  context_completeness: z.coerce.number().min(0.5).max(2).describe(
    "How complete is the context provided to the LLM? 0.5 = exhaustive specs, 1.0 = typical, 2.0 = vague requirements."
  ).default(1),
  transformation_impact: z.coerce.number().min(0.5).max(2).describe(
    "Scale of transformation relative to existing code. 0.5 = small patch, 1.0 = new module, 2.0 = architectural rewrite."
  ).default(1),
  iterative_cycles: z.coerce.number().min(0.5).max(10).describe(
    "Iteration overhead multiplier or literal cycle count. Multiplier scale: 0.5 = one-shot, 1.0 = typical debug loop, 2.0 = heavy back-and-forth. Values above 2.0 are accepted as literal cycle counts and normalized internally."
  ).default(1),
  human_oversight: z.coerce.number().min(0.5).max(2).describe(
    "Human review overhead multiplier. 0.5 = auto-merged, 1.0 = standard PR review, 2.0 = compliance/security review."
  ).default(1),
  task_type: taskTypeEnum.describe("Optional task type for feedback matching.").optional(),
  ai_native: aiNativeGradient,
  task_label: taskLabelField,
  project: projectField,
  session_id: sessionIdField
});
var sprintForecastSchema = z.object({
  backlog_points: z.coerce.number().positive().describe(
    "Total story points or effort units remaining in the backlog."
  ),
  velocity_history: z.array(z.coerce.number().positive().describe("Velocity in points for a single sprint (must be > 0).")).min(1).describe(
    "Historical velocities from completed sprints. Minimum 1 data point; 3+ recommended for meaningful forecasts."
  ),
  sprint_length_days: z.coerce.number().positive().describe("Calendar days in a single sprint cycle.").default(14),
  hours_per_sprint: z.coerce.number().positive().describe(
    "Total productive engineering hours available per sprint (accounts for meetings, overhead)."
  ).default(300),
  task_type: taskTypeEnum.describe("Optional task type for feedback matching.").optional(),
  ai_native: aiNativeGradient,
  task_label: taskLabelField,
  project: projectField,
  session_id: sessionIdField
});
var taskSchema = z.object({
  name: z.string().min(1).describe("Unique task identifier used in predecessor references."),
  duration: z.coerce.number().positive().describe("Estimated task duration in days."),
  predecessors: z.array(z.string().describe("Name of a preceding task that must finish first.")).describe(
    "List of task names this task depends on. Use an empty array for start nodes."
  )
});
var criticalPathSchema = z.object({
  tasks: z.array(taskSchema).min(1).max(TASK_ARRAY_LIMIT, { error: `tasks must contain at most ${TASK_ARRAY_LIMIT} tasks per call. Split very large graphs into phases.` }).describe("All tasks in the project graph. Each task must have a unique name."),
  task_type: taskTypeEnum.describe("Optional task type for feedback matching.").optional(),
  task_label: taskLabelField,
  project: projectField,
  session_id: sessionIdField
});
var referenceClassEstimateSchema = z.object({
  task_type: taskTypeEnum,
  scope: z.enum(["small", "medium", "large", "xl"]).describe(
    "Rough size of the task: small=tiny fix/tweak, medium=typical task, large=significant effort, xl=epic-scale. When omitted, inferred from complexity (1-2=small, 3=medium, 4=large, 5=xl)."
  ).optional(),
  complexity: z.number().min(1).max(5).describe(
    "Fine-tuning complexity from 1 (trivial) to 5 (extreme). Adjusts within the scope band: low complexity shortens, high complexity lengthens the estimate."
  ).default(3),
  team_id: brandedString("Team").describe(
    "Optional team identifier to scope historical data to a specific team."
  ).optional(),
  ai_native: aiNativeGradient,
  task_label: taskLabelField,
  project: projectField,
  session_id: sessionIdField
});
var monteCarloSchema = z.object({
  tasks: z.array(
    z.object({
      name: z.string().min(1).describe("Task name / identifier."),
      optimistic: z.coerce.number().positive().describe("Best-case duration in days."),
      most_likely: z.coerce.number().positive().describe("Most probable duration in days."),
      pessimistic: z.coerce.number().positive().describe("Worst-case duration in days.")
    }).refine(
      (t) => t.optimistic <= t.most_likely && t.most_likely <= t.pessimistic,
      { message: "Estimates must satisfy optimistic <= most_likely <= pessimistic." }
    )
  ).min(1).max(TASK_ARRAY_LIMIT, { error: `tasks must contain at most ${TASK_ARRAY_LIMIT} tasks per call. Split very large schedules into phases.` }).describe("Task list with PERT-style three-point estimates and dependency edges."),
  iterations: z.coerce.number().min(1).max(1e5).describe("Number of Monte Carlo simulation iterations (1\u2013100,000). Higher = more stable percentiles.").default(1e4),
  seed: z.number().int().optional().describe("Optional seed for reproducible results."),
  task_type: taskTypeEnum.describe("Optional task type for feedback matching. Enables per-task-type accuracy tracking.").optional(),
  task_label: taskLabelField,
  project: projectField,
  session_id: sessionIdField
});
var calibrateEstimatesSchema = z.object({
  team_id: brandedString("Team").describe(
    "Team identifier whose historical accuracy data should be analysed."
  ),
  period_days: z.coerce.number().positive().describe("Lookback window in calendar days for calibration data.").default(90),
  minimum_samples: z.coerce.number().positive().describe(
    "Minimum number of completed tasks required before producing a calibration factor."
  ).default(10)
});
var tokenTimeBridgeSchema = z.object({
  tokens: z.coerce.number().positive().describe("Total number of tokens in the LLM request (prompt + completion)."),
  model: z.string().describe("LLM model identifier. Unknown models fall back to generic estimates."),
  tool_calls: z.coerce.number().nonnegative().describe(
    "Number of tool calls expected in the agentic loop. Each adds overhead latency."
  ).default(0),
  reasoning_depth: reasoningDepthEnum.describe(
    "Expected depth of chain-of-thought reasoning. Deep reasoning adds significant per-token latency."
  ).default("moderate"),
  task_type: taskTypeEnum.describe("Optional task type for feedback matching.").optional(),
  task_label: taskLabelField,
  project: projectField,
  session_id: sessionIdField
});
var tokenCostEstimateSchema = z.object({
  tokens: z.coerce.number().positive().describe("Total number of tokens in the LLM request (prompt + completion)."),
  model: z.string().describe("LLM model identifier. Unknown models fall back to generic estimates."),
  tool_calls: z.coerce.number().nonnegative().describe("Number of tool calls expected in the agentic loop.").default(0),
  reasoning_depth: reasoningDepthEnum.describe("Expected depth of chain-of-thought reasoning.").default("moderate"),
  task_type: taskTypeEnum.describe("Optional task type for feedback matching.").optional()
});
var compareModelsSchema = z.object({
  tokens: z.coerce.number().positive().describe("Total number of tokens to estimate across all models."),
  tool_calls: z.coerce.number().nonnegative().describe("Number of tool calls expected.").default(0),
  reasoning_depth: reasoningDepthEnum.describe("Expected depth of chain-of-thought reasoning.").default("moderate"),
  sort_by: z.enum(["cost", "time"]).describe("Sort models by cost (default) or estimated time.").default("cost")
});
var accuracyTrendSchema = z.object({
  team_id: brandedString("Team").describe("Optional team identifier to scope historical data.").optional(),
  window_size: z.coerce.number().min(5).describe("Number of records per sliding window.").default(50)
});
var scheduleRiskSchema = z.object({
  estimated_hours: z.coerce.number().positive().describe("The estimated effort in hours to assess risk for."),
  task_type: taskTypeEnum.describe("Optional task type to refine historical accuracy lookup.").optional(),
  team_id: brandedString("Team").describe("Optional team identifier to scope historical data.").optional(),
  complexity: z.number().min(1).max(5).describe("Task complexity from 1 (trivial) to 5 (extreme). Higher complexity widens confidence intervals.").optional(),
  ai_native: aiNativeGradient,
  task_label: taskLabelField,
  project: projectField,
  session_id: sessionIdField
});
var cocomoValidateSchema = z.object({
  dataset_filter: z.array(z.string().describe("Dataset name: COCOMO81, NASA93, Albrecht, or Kemerer.")).describe("Optional filter to validate against specific datasets only.").optional()
});
var cocomoGroundTruthSchema = z.object({
  dataset_filter: z.array(z.string().describe("Dataset name: COCOMO81, NASA93, Albrecht, or Kemerer.")).describe("Optional filter to validate against specific datasets only.").optional()
});
var batchRecordActualsSchema = z.object({
  entries: z.array(
    z.object({
      estimate_id: z.string().describe("ID of the estimate to update."),
      actual_hours: z.number().positive().describe("Actual hours spent."),
      notes: z.string().optional().describe("Optional context."),
      unit: actualUnitEnum.optional(),
      calibration_provenance: calibrationProvenanceEnum.optional()
    })
  ).min(1).max(500).describe("Array of actual-hour records (1\u2013500 entries).")
});
var feedbackHealthSchema = z.object({});
var recordActualSchema = z.object({
  estimate_id: z.string().describe("ID of the estimate to update."),
  actual_hours: z.number().positive().describe("Actual hours spent."),
  notes: z.string().optional().describe("Optional context."),
  unit: actualUnitEnum.optional(),
  calibration_provenance: calibrationProvenanceEnum.optional()
});
var estimateFromContextSchema = z.object({
  context: z.string().min(1).max(CONTEXT_LENGTH_LIMIT, { error: `context must be at most ${CONTEXT_LENGTH_LIMIT} characters. Summarize the task or attach only the relevant excerpt.` }).describe(
    "Free-text context describing the task to estimate \u2014 issue body, PR/diff description, or task summary. Will be used to classify task_type and complexity and delegate to reference_class_estimate / PERT correction once classification logic ships (Phase 5)."
  ),
  task_type: taskTypeEnum.describe("Optional pre-classified task type hint; used once classification logic ships.").optional(),
  complexity: complexityScale.describe("Optional pre-assessed complexity hint (1-5); used once classification logic ships.").optional(),
  team_id: brandedString("Team").describe("Optional team identifier to scope historical data once classification logic ships.").optional()
});

// src/lib/internal/time-math-dispatch.ts
function countryOperand(operands) {
  const raw = operands.country;
  if (raw === void 0) return "US";
  if (typeof raw !== "string") {
    return {
      ok: false,
      error: {
        isError: true,
        message: `country must be a 2-letter ISO-3166 country code string (e.g. "US"), but received ${typeof raw}.`,
        retryHint: 'Pass country as a string like "US", "UK", "FR", "DE", or "JP", or omit it for "US".'
      }
    };
  }
  return raw;
}
function dispatchTimeMath(operation, operands) {
  const str = (v) => typeof v === "string" ? v : typeof v === "number" ? String(v) : void 0;
  const num = (v, fallback) => typeof v === "number" ? v : typeof v === "string" ? Number(v) : fallback;
  switch (operation) {
    case "add_days": {
      const date = str(operands.start_date) ?? str(operands.date) ?? str(operands.from_date) ?? str(operands.startDate);
      const days = num(operands.days);
      if (!date || days === void 0) {
        return {
          ok: false,
          error: {
            isError: true,
            message: "add_days requires operands: {start_date, days}.",
            retryHint: "Pass start_date as an ISO date string and days as a number."
          }
        };
      }
      if (!Number.isFinite(days)) {
        return {
          ok: false,
          error: {
            isError: true,
            message: `add_days days must be a finite number, but received ${String(operands.days)}.`,
            retryHint: "Pass days as a number (e.g. 7), not a non-numeric string."
          }
        };
      }
      if (Math.abs(days) > BUSINESS_DAYS_LIMIT) {
        return {
          ok: false,
          error: {
            isError: true,
            message: `add_days days must be between -${BUSINESS_DAYS_LIMIT} and ${BUSINESS_DAYS_LIMIT}, but received ${days}.`,
            retryHint: `Reduce days to at most ${BUSINESS_DAYS_LIMIT} in magnitude, or convert to months/years.`
          }
        };
      }
      return { ok: true, data: addDays(date, days) };
    }
    case "add_business_days": {
      const start = str(operands.start_date) ?? str(operands.date) ?? str(operands.from_date) ?? str(operands.startDate);
      const days = num(operands.days);
      if (!start || days === void 0) {
        return {
          ok: false,
          error: {
            isError: true,
            message: "add_business_days requires operands: {start_date, days, country?}.",
            retryHint: "Pass start_date as an ISO date string and days as a number."
          }
        };
      }
      if (!Number.isFinite(days)) {
        return {
          ok: false,
          error: {
            isError: true,
            message: `add_business_days days must be a finite number, but received ${String(operands.days)}.`,
            retryHint: "Pass days as a number (e.g. 10), not a non-numeric string."
          }
        };
      }
      if (Math.abs(days) > BUSINESS_DAYS_LIMIT) {
        return {
          ok: false,
          error: {
            isError: true,
            message: `add_business_days days must be between -${BUSINESS_DAYS_LIMIT} and ${BUSINESS_DAYS_LIMIT}, but received ${days}.`,
            retryHint: `Reduce days to at most ${BUSINESS_DAYS_LIMIT} in magnitude, or convert to calendar days.`
          }
        };
      }
      const country = countryOperand(operands);
      if (typeof country === "object") return country;
      return addBusinessDays(start, days, country);
    }
    case "diff": {
      const start = str(operands.start_date) ?? str(operands.date) ?? str(operands.from_date) ?? str(operands.startDate);
      const end = str(operands.end_date) ?? str(operands.to_date) ?? str(operands.endDate) ?? str(operands.end);
      if (!start || !end) {
        return {
          ok: false,
          error: {
            isError: true,
            message: "diff requires operands: {start_date, end_date}.",
            retryHint: "Pass both start_date and end_date as ISO date strings."
          }
        };
      }
      return { ok: true, data: diffDates(start, end) };
    }
    case "convert_tz": {
      const ts = str(operands.timestamp);
      const tz = str(operands.target_tz);
      if (!ts || !tz) {
        return {
          ok: false,
          error: {
            isError: true,
            message: "convert_tz requires operands: {timestamp, target_tz}.",
            retryHint: "Pass an ISO timestamp and a target IANA timezone."
          }
        };
      }
      return convertTimezone(ts, tz);
    }
    case "parse_nl": {
      const dur = str(operands.duration_string);
      if (!dur) {
        return {
          ok: false,
          error: {
            isError: true,
            message: "parse_nl requires operands: {duration_string}.",
            retryHint: 'Pass a duration string like "2h30m" or "1d6h".'
          }
        };
      }
      return parseDuration(dur);
    }
    case "format_duration": {
      const ms = num(operands.milliseconds);
      if (ms === void 0) {
        return {
          ok: false,
          error: {
            isError: true,
            message: "format_duration requires operands: {milliseconds}.",
            retryHint: "Pass a number of milliseconds."
          }
        };
      }
      if (!Number.isFinite(ms)) {
        return {
          ok: false,
          error: {
            isError: true,
            message: `format_duration milliseconds must be a finite number, but received ${String(operands.milliseconds)}.`,
            retryHint: "Pass milliseconds as a finite number (e.g. 90000)."
          }
        };
      }
      return { ok: true, data: formatElapsed(ms) };
    }
    default:
      return {
        ok: false,
        error: {
          isError: true,
          message: `Unknown time_math operation: ${operation}`,
          retryHint: "Use one of: add_days, add_business_days, diff, convert_tz, parse_nl, format_duration."
        }
      };
  }
}

// src/lib/cost.ts
var FALLBACK_COST_INPUT = 3;
var FALLBACK_COST_OUTPUT = 15;
var AVG_TOOL_CALL_TOKENS = 200;
var FAST_MODELS = /* @__PURE__ */ new Set([
  "claude-3.5-haiku-20241022",
  "claude-haiku-4-5",
  "gpt-4o-mini",
  "gemini-2.0-flash",
  "llama-3.1-70b"
]);
var PREMIUM_MODELS = /* @__PURE__ */ new Set([
  "claude-opus-4-20250514",
  "claude-opus-4-8",
  "claude-fable-5",
  "gpt-4-turbo"
]);
function getQualityTier(model) {
  if (FAST_MODELS.has(model)) return "fast";
  if (PREMIUM_MODELS.has(model)) return "premium";
  return "standard";
}
function round4(n) {
  return Math.round(n * 1e4) / 1e4;
}
function tokenCostEstimate(params) {
  const timeMapping = tokenTimeBridge(params);
  const pricing = getModelPricing(params.model);
  const costInput = pricing?.costInput ?? FALLBACK_COST_INPUT;
  const costOutput = pricing?.costOutput ?? FALLBACK_COST_OUTPUT;
  const { promptTokens, completionTokens } = timeMapping.breakdown;
  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) {
    return {
      tokens: params.tokens,
      model: params.model,
      estimatedSeconds: 0,
      estimatedMinutes: 0,
      estimatedCost: 0,
      costBreakdown: { inputCost: 0, outputCost: 0, toolCallOverheadCost: 0 },
      timeBreakdown: timeMapping.breakdown,
      confidence: timeMapping.confidence,
      urgency: timeMapping.urgency,
      humanReadable: `Cost estimate unavailable for ${params.model} \u2014 calibration data issue.`
    };
  }
  const inputCost = round4(promptTokens * costInput / 1e6);
  const outputCost = round4(completionTokens * costOutput / 1e6);
  const toolCallOverheadCost = round4(
    params.toolCalls * AVG_TOOL_CALL_TOKENS * costOutput / 1e6
  );
  const totalCost = round4(inputCost + outputCost + toolCallOverheadCost);
  const estMin = Math.round(timeMapping.estimatedMinutes * 10) / 10;
  const humanReadable = `~${estMin} min, ~$${totalCost} for ${params.tokens} tokens with ${params.model} (${params.reasoningDepth} reasoning, ${params.toolCalls} tool calls)`;
  return {
    tokens: params.tokens,
    model: params.model,
    estimatedSeconds: timeMapping.estimatedSeconds,
    estimatedMinutes: timeMapping.estimatedMinutes,
    estimatedCost: totalCost,
    costBreakdown: {
      inputCost,
      outputCost,
      toolCallOverheadCost
    },
    timeBreakdown: timeMapping.breakdown,
    confidence: timeMapping.confidence,
    urgency: timeMapping.urgency,
    humanReadable
  };
}
function compareModels(params) {
  const sortBy = params.sortBy ?? "cost";
  const allPricing = getAllModelPricing();
  const entries = [];
  for (const model of Object.keys(MODEL_CALIBRATIONS)) {
    const timeMapping = tokenTimeBridge({
      tokens: params.tokens,
      model,
      toolCalls: params.toolCalls,
      reasoningDepth: params.reasoningDepth
    });
    const pricing = allPricing[model];
    const costInput = pricing?.costInput ?? FALLBACK_COST_INPUT;
    const costOutput = pricing?.costOutput ?? FALLBACK_COST_OUTPUT;
    const { promptTokens, completionTokens } = timeMapping.breakdown;
    const inputCost = promptTokens * costInput / 1e6;
    const outputCost = completionTokens * costOutput / 1e6;
    const toolCallOverheadCost = params.toolCalls * AVG_TOOL_CALL_TOKENS * costOutput / 1e6;
    const totalCost = round4(inputCost + outputCost + toolCallOverheadCost);
    const calibration = MODEL_CALIBRATIONS[model];
    const tps = calibration?.tokensPerSecond ?? 75;
    entries.push({
      model,
      estimatedSeconds: timeMapping.estimatedSeconds,
      estimatedMinutes: timeMapping.estimatedMinutes,
      estimatedCost: totalCost,
      costAvailable: pricing != null,
      qualityTier: getQualityTier(model),
      tokensPerSecond: tps
    });
  }
  entries.sort((a, b) => {
    if (sortBy === "time") {
      return a.estimatedSeconds - b.estimatedSeconds;
    }
    if (a.estimatedCost === 0 && b.estimatedCost !== 0) return 1;
    if (a.estimatedCost !== 0 && b.estimatedCost === 0) return -1;
    return a.estimatedCost - b.estimatedCost;
  });
  const header = "Model                          | Time (min) | Cost ($)  | Tier";
  const separator = "-------------------------------|------------|-----------|--------";
  const rows = entries.map((e) => {
    const modelCol = e.model.padEnd(30);
    const timeCol = String(e.estimatedMinutes).padStart(10);
    const costCol = e.estimatedCost.toFixed(4).padStart(9);
    const tierCol = e.qualityTier;
    return `${modelCol}| ${timeCol} | ${costCol} | ${tierCol}`;
  });
  const humanReadable = [header, separator, ...rows].join("\n");
  return {
    tokens: params.tokens,
    models: entries,
    sortBy,
    humanReadable
  };
}

// src/lib/accuracy-trend.ts
function computeAccuracyTrend(params) {
  const result = computeAccuracyTrendRaw(params);
  const minN = minNForVerdict();
  if (result.totalWithActuals < minN) {
    return {
      ...result,
      overallTrend: "stable",
      humanReadable: `Insufficient sample (n=${result.totalWithActuals}). Need at least ${minN} matched estimate-actual pairs before an accuracy-trend verdict (improving/degrading/stable) can be reported. Raw MAPE so far: ${result.currentMape}%.`
    };
  }
  return result;
}
function computeAccuracyTrendRaw(params) {
  const requestedWindowSize = params?.windowSize ?? 50;
  const records = getCalibrationData(params?.teamId);
  const totalEstimates = records.length;
  const totalWithActuals = records.length;
  if (records.length === 0) {
    const industryBaseline2 = getEstimationResearch().expertEstimatesWithinPercent;
    return {
      windows: [],
      overallTrend: "stable",
      currentMape: 0,
      industryBaselineMape: industryBaseline2,
      improvementVsIndustry: industryBaseline2 - 0,
      totalEstimates: 0,
      totalWithActuals: 0,
      humanReadable: "No historical estimation data available. Start recording estimates and actuals to track accuracy trends."
    };
  }
  const sorted = [...records].sort(
    (a, b) => (a.completedAt ?? "").localeCompare(b.completedAt ?? "")
  );
  const minWindowSize = 10;
  let windowSize = requestedWindowSize;
  if (sorted.length >= windowSize * 2) {
    const remainder = sorted.length % windowSize;
    if (remainder > 0 && remainder < windowSize / 2) {
      const numWindows = Math.ceil(sorted.length / windowSize);
      windowSize = Math.ceil(sorted.length / numWindows);
    }
  }
  windowSize = Math.max(minWindowSize, windowSize);
  if (sorted.length < windowSize) {
    const metrics = computeAccuracyMetrics(sorted);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const window = {
      period: `Window 1 (estimates 1-${sorted.length})`,
      dateRange: first && last ? `${(first.completedAt ?? "").slice(0, 10)} to ${(last.completedAt ?? "").slice(0, 10)}` : void 0,
      mape: metrics.mape,
      mdape: metrics.mdape,
      bias: metrics.bias,
      sampleSize: sorted.length
    };
    const industryBaseline2 = getEstimationResearch().expertEstimatesWithinPercent;
    const currentMape2 = metrics.mape;
    const improvementVsIndustry2 = Math.round((industryBaseline2 - currentMape2) * 10) / 10;
    return {
      windows: [window],
      overallTrend: "stable",
      currentMape: currentMape2,
      industryBaselineMape: industryBaseline2,
      improvementVsIndustry: improvementVsIndustry2,
      totalEstimates,
      totalWithActuals,
      humanReadable: buildHumanReadable("stable", currentMape2, industryBaseline2, improvementVsIndustry2, [window])
    };
  }
  const windows = [];
  for (let i = 0; i < sorted.length; i += windowSize) {
    const windowRecords = sorted.slice(i, i + windowSize);
    if (windowRecords.length === 0) break;
    const metrics = computeAccuracyMetrics(windowRecords);
    const first = windowRecords[0];
    const last = windowRecords[windowRecords.length - 1];
    if (!first || !last) continue;
    const windowIndex = Math.floor(i / windowSize) + 1;
    const startEstimate = i + 1;
    const endEstimate = i + windowRecords.length;
    windows.push({
      period: `Window ${windowIndex} (estimates ${startEstimate}-${endEstimate})`,
      dateRange: `${(first.completedAt ?? "").slice(0, 10)} to ${(last.completedAt ?? "").slice(0, 10)}`,
      mape: metrics.mape,
      mdape: metrics.mdape,
      bias: metrics.bias,
      sampleSize: windowRecords.length
    });
  }
  const firstMdape = windows[0]?.mdape ?? 0;
  const lastMdape = windows[windows.length - 1]?.mdape ?? 0;
  const lastMape = windows[windows.length - 1]?.mape ?? 0;
  let overallTrend = "stable";
  if (lastMdape < firstMdape * 0.85) {
    overallTrend = "improving";
  } else if (lastMdape > firstMdape * 1.15) {
    overallTrend = "degrading";
  }
  const industryBaseline = getEstimationResearch().expertEstimatesWithinPercent;
  const currentMape = lastMape;
  const improvementVsIndustry = Math.round((industryBaseline - currentMape) * 10) / 10;
  return {
    windows,
    overallTrend,
    currentMape,
    industryBaselineMape: industryBaseline,
    improvementVsIndustry,
    totalEstimates,
    totalWithActuals,
    humanReadable: buildHumanReadable(overallTrend, currentMape, industryBaseline, improvementVsIndustry, windows)
  };
}
function buildHumanReadable(trend, currentMape, industryBaseline, improvementVsIndustry, windows) {
  const trendLabel = trend === "improving" ? "improving" : trend === "degrading" ? "degrading" : "stable";
  const vsIndustry = improvementVsIndustry > 0 ? `${improvementVsIndustry}% better than industry baseline (${industryBaseline}%)` : improvementVsIndustry < 0 ? `${Math.abs(improvementVsIndustry)}% worse than industry baseline (${industryBaseline}%)` : `equal to industry baseline (${industryBaseline}%)`;
  const lastMdape = windows[windows.length - 1]?.mdape ?? 0;
  const mdapeValues = windows.map((w) => w.mdape);
  const windowSummary = windows.length === 1 ? `1 window (MdAPE: ${lastMdape}%, MAPE: ${windows[0]?.mape ?? 0}%)` : `${windows.length} windows, MdAPE range: ${Math.min(...mdapeValues)}% to ${Math.max(...mdapeValues)}%`;
  return `Accuracy trend is ${trendLabel}. Current MdAPE: ${lastMdape}% (MAPE: ${currentMape}%), ${vsIndustry}. ${windowSummary} across ${windows.reduce((sum, w) => sum + w.sampleSize, 0)} estimates.`;
}

// src/lib/profiles.ts
var AI_NATIVE_ANCHOR = {
  featureDevTimeDays: 0.72,
  bugfixTimeHours: 6.15,
  sprintVelocityPoints: 80,
  estimationMape: 15,
  underestimationBias: 0.2
};
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function getHumanAnchor() {
  const baselines = getHumanBaselines();
  const research = getEstimationResearch();
  return {
    featureDevTimeDays: baselines?.featureDevTimeDays?.median ?? 14,
    bugfixTimeHours: baselines?.bugfixTimeHours?.median ?? 72,
    sprintVelocityPoints: baselines?.sprintVelocityPoints?.median ?? 35,
    estimationMape: research?.expertEstimatesWithinPercent ?? 25,
    underestimationBias: research ? research.underestimationRate / 100 : 0.575
  };
}
function getDeveloperProfileGradient(aiRatio) {
  const clamped = Math.max(0, Math.min(1, aiRatio));
  const human = getHumanAnchor();
  const ai = AI_NATIVE_ANCHOR;
  const mode = clamped >= 1 ? "ai_native" : clamped <= 0 ? "human" : "hybrid";
  const humanCF = 1.8;
  const aiCF = Math.max(0.1, getGlobalCorrectionFactor());
  return {
    mode,
    aiRatio: clamped,
    featureDevTimeDays: Math.round(lerp(human.featureDevTimeDays, ai.featureDevTimeDays, clamped) * 100) / 100,
    bugfixTimeHours: Math.round(lerp(human.bugfixTimeHours, ai.bugfixTimeHours, clamped) * 100) / 100,
    sprintVelocityPoints: Math.round(lerp(human.sprintVelocityPoints, ai.sprintVelocityPoints, clamped) * 10) / 10,
    estimationMape: Math.round(lerp(human.estimationMape, ai.estimationMape, clamped) * 10) / 10,
    underestimationBias: Math.round(lerp(human.underestimationBias, ai.underestimationBias, clamped) * 1e3) / 1e3,
    correctionFactor: Math.round(lerp(humanCF, aiCF, clamped) * 100) / 100
  };
}

// src/lib/risk.ts
function scheduleRisk(params) {
  const { estimatedHours, taskType, teamId, complexity } = params;
  if (!estimatedHours || !Number.isFinite(estimatedHours) || estimatedHours <= 0) {
    return {
      estimatedHours: 0,
      riskLevel: "critical",
      confidenceIntervals: { p50: 0, p80: 0, p95: 0 },
      historicalAccuracy: { mape: 0, mdape: 0, sampleSize: 0 },
      estimatedTokenCost: 0,
      cappedMdape: 0,
      recommendation: "Invalid estimated hours. Provide a positive number.",
      humanReadable: "Cannot assess risk: estimated hours is zero or invalid."
    };
  }
  const records = getCalibrationData(teamId, taskType);
  let mdape;
  let cappedMdape;
  let mape;
  let sampleSize;
  if (records.length >= 5) {
    const metrics = computeAccuracyMetrics(records);
    mdape = metrics.mdape;
    cappedMdape = metrics.cappedMdape;
    mape = metrics.mape;
    sampleSize = metrics.sample_size;
  } else {
    const profile = getDeveloperProfileGradient(params.aiNative ?? 1);
    mdape = profile.estimationMape;
    cappedMdape = profile.estimationMape;
    mape = profile.estimationMape;
    sampleSize = records.length;
  }
  const complexityFactor = complexity && complexity >= 4 ? 1 + (complexity - 3) * 0.1 : 1;
  const p50 = Math.round(estimatedHours * 10) / 10;
  const p80 = Math.round(estimatedHours * (1 + 0.842 * cappedMdape / 100 * complexityFactor) * 10) / 10;
  const p95 = Math.round(estimatedHours * (1 + 1.645 * cappedMdape / 100 * complexityFactor) * 10) / 10;
  let riskLevel;
  if (cappedMdape < 20) {
    riskLevel = "low";
  } else if (cappedMdape <= 35) {
    riskLevel = "medium";
  } else if (cappedMdape <= 50) {
    riskLevel = "high";
  } else {
    riskLevel = "critical";
  }
  const recommendation = getRecommendation(riskLevel);
  const mapeRounded = Math.round(mape * 10) / 10;
  const mdapeRounded = Math.round(mdape * 10) / 10;
  const cappedMdapeRounded = Math.round(cappedMdape * 10) / 10;
  const taskLabel = taskType ? ` for ${taskType}` : "";
  const complexityLabel = complexity ? ` (complexity ${complexity})` : "";
  const taskTypeBreakdown = computeTaskTypeBreakdown(teamId);
  return {
    estimatedHours: p50,
    estimatedTokenCost: Math.round(p50 * 5e4 * 100) / 100,
    riskLevel,
    confidenceIntervals: { p50, p80, p95 },
    historicalAccuracy: {
      mape: mapeRounded,
      mdape: mdapeRounded,
      sampleSize
    },
    cappedMdape: cappedMdapeRounded,
    taskTypeBreakdown,
    recommendation,
    humanReadable: buildHumanReadable2(riskLevel, cappedMdapeRounded, mapeRounded, p50, p80, p95, sampleSize, recommendation, taskLabel, complexityLabel)
  };
}
function getRecommendation(riskLevel) {
  switch (riskLevel) {
    case "low":
      return "Low risk. Estimate is within normal variance.";
    case "medium":
      return "Moderate risk. Consider adding 20-30% buffer.";
    case "high":
      return "High risk. Recommend re-estimating with more detail.";
    case "critical":
      return "Critical risk. Break down the task and re-estimate each component.";
    default:
      return assertNever(riskLevel);
  }
}
function computeTaskTypeBreakdown(teamId) {
  const allRecords = getCalibrationData(teamId);
  const byType = /* @__PURE__ */ new Map();
  for (const r of allRecords) {
    const type = r.taskType ?? "unknown";
    const arr = byType.get(type) ?? [];
    arr.push(r);
    byType.set(type, arr);
  }
  const result = {};
  for (const [type, records] of byType) {
    if (records.length < 3) continue;
    const metrics = computeAccuracyMetrics(records);
    const mdape = metrics.cappedMdape;
    let riskLevel;
    if (mdape < 20) riskLevel = "low";
    else if (mdape <= 35) riskLevel = "medium";
    else if (mdape <= 50) riskLevel = "high";
    else riskLevel = "critical";
    result[type] = { riskLevel, mdape: Math.round(mdape * 10) / 10, sampleSize: metrics.sample_size };
  }
  return result;
}
function buildHumanReadable2(riskLevel, mdape, mape, p50, p80, p95, sampleSize, recommendation, taskLabel, complexityLabel) {
  return `Schedule risk${taskLabel}${complexityLabel}: ${riskLevel}. MdAPE: ${mdape}% (MAPE: ${mape}%, based on ${sampleSize} historical records). Confidence intervals: p50=${p50}h, p80=${p80}h, p95=${p95}h. ${recommendation}`;
}

// src/lib/cocomo-validate.ts
var COCOMO_BASIC = {
  organic: { a: 2.4, b: 1.05 },
  semidetached: { a: 3, b: 1.12 },
  embedded: { a: 3.6, b: 1.2 }
};
function cocomoValidate(params) {
  const datasets = getCocomoProjects();
  const derivedFactors = getCocomoDerivedFactors();
  if (datasets.length === 0) {
    return {
      ok: false,
      error: {
        isError: true,
        message: "COCOMO calibration data not found. Load calibration datasets before validation.",
        retryHint: "Ensure the COCOMO calibration data files are present in the data directory."
      }
    };
  }
  const coefficients = { ...COCOMO_BASIC };
  if (derivedFactors?.cocomoBasic) {
    for (const [type, factors] of Object.entries(derivedFactors.cocomoBasic)) {
      coefficients[type] = { a: factors.a, b: factors.b };
    }
  }
  const allErrors = [];
  const allBiases = [];
  const byType = /* @__PURE__ */ new Map();
  const datasetFilter = params?.datasetFilter;
  const filteredDatasets = datasetFilter ? datasets.filter((d) => datasetFilter.includes(d.name)) : datasets;
  let projectsEvaluated = 0;
  for (const dataset of filteredDatasets) {
    for (const project of dataset.projects) {
      if (project.kloc <= 0 || project.effortPersonMonths <= 0) continue;
      const projectType = project.type ?? "semidetached";
      const coeffs = coefficients[projectType] ?? coefficients.semidetached;
      if (!coeffs) continue;
      const predicted = coeffs.a * Math.pow(project.kloc, coeffs.b);
      const actual = project.effortPersonMonths;
      const errorPercent = (predicted - actual) / actual * 100;
      const absError = Math.abs(errorPercent);
      allErrors.push(absError);
      allBiases.push(errorPercent);
      projectsEvaluated++;
      if (!byType.has(projectType)) {
        byType.set(projectType, { errors: [], biases: [] });
      }
      const typeEntry = byType.get(projectType);
      if (!typeEntry) continue;
      typeEntry.errors.push(absError);
      typeEntry.biases.push(errorPercent);
    }
  }
  if (projectsEvaluated === 0) {
    return {
      ok: false,
      error: {
        isError: true,
        message: "No valid projects found in COCOMO calibration data (all projects had kloc <= 0 or effort <= 0).",
        retryHint: "Check that calibration datasets contain projects with positive kloc and effort values."
      }
    };
  }
  const mape = allErrors.reduce((sum, e) => sum + e, 0) / allErrors.length;
  const bias = allBiases.reduce((sum, b) => sum + b, 0) / allBiases.length;
  const byProjectType = {};
  for (const [type, entry] of byType) {
    byProjectType[type] = {
      mape: entry.errors.reduce((s, e) => s + e, 0) / entry.errors.length,
      count: entry.errors.length
    };
  }
  const recommendedAdjustments = [];
  for (const [type, entry] of byType) {
    const coeffs = coefficients[type] ?? coefficients.semidetached;
    if (!coeffs) continue;
    const typeMape = entry.errors.reduce((s, e) => s + e, 0) / entry.errors.length;
    const typeBias = entry.biases.reduce((s, b) => s + b, 0) / entry.biases.length;
    if (type === "organic" && typeMape > 30) {
      const adjustedA = coeffs.a * (1 - typeBias / 100);
      recommendedAdjustments.push({
        parameter: `${type}.a`,
        currentValue: coeffs.a,
        recommendedValue: Math.round(adjustedA * 100) / 100,
        reason: `Organic MAPE is ${Math.round(typeMape)}%, exceeding 30% threshold. Adjust coefficient a to reduce prediction error.`
      });
    }
    if (type === "embedded" && typeMape > 30) {
      const adjustedB = coeffs.b * (1 - typeBias / 200);
      recommendedAdjustments.push({
        parameter: `${type}.b`,
        currentValue: coeffs.b,
        recommendedValue: Math.round(adjustedB * 1e3) / 1e3,
        reason: `Embedded MAPE is ${Math.round(typeMape)}%, exceeding 30% threshold. Adjust coefficient b to reduce prediction error.`
      });
    }
  }
  if (Math.abs(bias) > 20) {
    const scaleFactor = 1 - bias / 100;
    recommendedAdjustments.push({
      parameter: "overall_scale_factor",
      currentValue: 1,
      recommendedValue: Math.round(scaleFactor * 100) / 100,
      reason: `Overall bias is ${Math.round(bias)}%, exceeding 20% threshold. Apply scale factor to correct systematic over/underprediction.`
    });
  }
  const humanReadable = [
    `COCOMO Validation Report: ${projectsEvaluated} projects evaluated.`,
    `Overall MAPE: ${Math.round(mape)}%, Bias: ${Math.round(bias)}%.`,
    Object.entries(byProjectType).map(([type, data]) => `  ${type}: MAPE=${Math.round(data.mape)}% (${data.count} projects)`).join("\n"),
    recommendedAdjustments.length > 0 ? `Recommended adjustments: ${recommendedAdjustments.map((a) => a.parameter).join(", ")}.` : "No adjustments recommended \u2014 model fits within acceptable thresholds."
  ].join("\n");
  return {
    ok: true,
    data: {
      projectsEvaluated,
      mape: Math.round(mape * 100) / 100,
      bias: Math.round(bias * 100) / 100,
      byProjectType,
      recommendedAdjustments,
      humanReadable
    }
  };
}

// src/lib/cocomo-ground-truth.ts
var COCOMO_BASIC2 = {
  organic: { a: 2.4, b: 1.05 },
  semidetached: { a: 3, b: 1.12 },
  embedded: { a: 3.6, b: 1.2 }
};
var DEFAULT_BASIC_COEFFS = { a: 3, b: 1.12 };
var COCOMO_II_A = 2.94;
var COCOMO_II_B = 1.1;
function predictAll(kloc, projectType) {
  const basicCoeffs = COCOMO_BASIC2[projectType] ?? DEFAULT_BASIC_COEFFS;
  const basic = basicCoeffs.a * Math.pow(kloc, basicCoeffs.b);
  const nominal = COCOMO_II_A * Math.pow(kloc, COCOMO_II_B);
  const aiSpeedup = nominal / 12;
  const profile0 = getDeveloperProfileGradient(0);
  const profile05 = getDeveloperProfileGradient(0.5);
  const profile1 = getDeveloperProfileGradient(1);
  const aiProfile0 = aiSpeedup * profile0.correctionFactor;
  const aiProfile05 = aiSpeedup * profile05.correctionFactor;
  const aiProfile1 = aiSpeedup * profile1.correctionFactor;
  return { basic, nominal, aiSpeedup, aiProfile0, aiProfile05, aiProfile1 };
}
function computeMetrics(predictions, actuals, name) {
  const n = predictions.length;
  if (n === 0) {
    return { name, mape: 0, mmre: 0, pred25: 0, pred50: 0, bias: 0, count: 0 };
  }
  let sumAbsPctErr = 0;
  let sumMre = 0;
  let within25 = 0;
  let within50 = 0;
  let sumBias = 0;
  for (let i = 0; i < n; i++) {
    const pred = predictions[i];
    const act = actuals[i];
    if (pred === void 0 || act === void 0) continue;
    const absErr = Math.abs(pred - act);
    const relErr = absErr / act;
    sumAbsPctErr += relErr * 100;
    sumMre += relErr;
    if (relErr <= 0.25) within25++;
    if (relErr <= 0.5) within50++;
    sumBias += (pred - act) / act;
  }
  return {
    name,
    mape: Math.round(sumAbsPctErr / n * 100) / 100,
    mmre: Math.round(sumMre / n * 1e3) / 1e3,
    pred25: Math.round(within25 / n * 1e3) / 1e3,
    pred50: Math.round(within50 / n * 1e3) / 1e3,
    bias: Math.round(sumBias / n * 1e4) / 100,
    count: n
  };
}
function cocomoValidateGroundTruth(params) {
  const datasets = getCocomoProjects();
  if (datasets.length === 0) {
    return {
      ok: false,
      error: {
        isError: true,
        message: "No COCOMO calibration data available.",
        retryHint: "Ensure COCOMO calibration data files are present."
      }
    };
  }
  const datasetFilter = params?.datasetFilter;
  const filtered = datasetFilter ? datasets.filter((d) => datasetFilter.includes(d.name)) : datasets;
  const projects = [];
  for (const dataset of filtered) {
    for (const project of dataset.projects) {
      if (project.kloc <= 0 || project.effortPersonMonths <= 0) continue;
      const projectType = project.type ?? "semidetached";
      projects.push({
        id: project.id,
        kloc: project.kloc,
        actual: project.effortPersonMonths,
        dataset: dataset.name,
        type: projectType,
        models: predictAll(project.kloc, projectType)
      });
    }
  }
  if (projects.length === 0) {
    return {
      ok: false,
      error: {
        isError: true,
        message: "No valid projects found (all had kloc <= 0 or effort <= 0).",
        retryHint: "Check that calibration datasets contain projects with positive kloc and effort."
      }
    };
  }
  const actuals = projects.map((p) => p.actual);
  const modelEntries = [
    { key: "basic", label: "COCOMO Basic" },
    { key: "nominal", label: "COCOMO II Nominal" },
    { key: "aiSpeedup", label: "COCOMO II + AI 12x" },
    { key: "aiProfile0", label: "AI + Profile (human)" },
    { key: "aiProfile05", label: "AI + Profile (hybrid)" },
    { key: "aiProfile1", label: "AI + Profile (ai_native)" }
  ];
  const allMetrics = modelEntries.map(
    ({ key, label }) => computeMetrics(projects.map((p) => p.models[key]), actuals, label)
  );
  const winner = allMetrics.reduce((best, m) => m.mape < best.mape ? m : best);
  const datasetGroups = /* @__PURE__ */ new Map();
  for (const p of projects) {
    const group = datasetGroups.get(p.dataset) ?? [];
    group.push(p);
    datasetGroups.set(p.dataset, group);
  }
  const byDataset = {};
  for (const [dsName, dsProjects] of datasetGroups) {
    const dsActuals = dsProjects.map((p) => p.actual);
    let bestModel = "";
    let bestMape = Infinity;
    for (const { key, label } of modelEntries) {
      const m = computeMetrics(dsProjects.map((p) => p.models[key]), dsActuals, label);
      if (m.mape < bestMape) {
        bestMape = m.mape;
        bestModel = label;
      }
    }
    byDataset[dsName] = { count: dsProjects.length, bestModel, bestMape: Math.round(bestMape * 100) / 100 };
  }
  const typeGroups = /* @__PURE__ */ new Map();
  for (const p of projects) {
    const group = typeGroups.get(p.type) ?? [];
    group.push(p);
    typeGroups.set(p.type, group);
  }
  const byType = {};
  for (const [typeName, typeProjects] of typeGroups) {
    const typeActuals = typeProjects.map((p) => p.actual);
    let bestModel = "";
    let bestMape = Infinity;
    for (const { key, label } of modelEntries) {
      const m = computeMetrics(typeProjects.map((p) => p.models[key]), typeActuals, label);
      if (m.mape < bestMape) {
        bestMape = m.mape;
        bestModel = label;
      }
    }
    byType[typeName] = { count: typeProjects.length, bestModel, bestMape: Math.round(bestMape * 100) / 100 };
  }
  const modelTable = allMetrics.map((m) => `  ${m.name}: MAPE=${m.mape}%, MMRE=${m.mmre}, PRED(25)=${m.pred25}, PRED(50)=${m.pred50}, bias=${m.bias}%`).join("\n");
  const aiModels = allMetrics.filter((m) => m.name.includes("AI"));
  const bestAi = aiModels.reduce((best, m) => m.mape < best.mape ? m : best, aiModels[0] ?? winner);
  const traditionalBest = allMetrics.filter((m) => !m.name.includes("AI")).reduce((best, m) => m.mape < best.mape ? m : best);
  const aiSpeedup12 = allMetrics.find((m) => m.name === "COCOMO II + AI 12x");
  const conclusion = (aiSpeedup12?.pred25 ?? 0) < 0.05 ? `Best model: ${winner.name} (MAPE=${winner.mape}%). WARNING: The 12x AI speedup divisor produces catastrophic underprediction (PRED(25)=0%, bias=${aiSpeedup12?.bias ?? "unknown"}%). These are pre-LLM projects \u2014 the speedup factor needs empirical validation against modern AI-assisted project data, not historical human-only data. Best traditional model: ${traditionalBest.name} at ${traditionalBest.mape}% MAPE.` : `Best model: ${winner.name} (MAPE=${winner.mape}%). AI speedup models show ${bestAi.pred25 > traditionalBest.pred25 ? "better" : "comparable"} PRED(25) vs traditional COCOMO.`;
  const humanReadable = [
    `COCOMO Ground Truth Validation: ${projects.length} projects evaluated.`,
    "Model Comparison:",
    modelTable,
    "",
    `By Dataset: ${Object.entries(byDataset).map(([n, d]) => `${n}(${d.count}): ${d.bestModel} at ${d.bestMape}%`).join(" | ")}`,
    `By Type: ${Object.entries(byType).map(([n, d]) => `${n}(${d.count}): ${d.bestModel} at ${d.bestMape}%`).join(" | ")}`,
    "",
    conclusion
  ].join("\n");
  return {
    ok: true,
    data: {
      projectsEvaluated: projects.length,
      models: allMetrics,
      byDataset,
      byType,
      winner: winner.name,
      conclusion,
      humanReadable
    }
  };
}

// src/lib/context-estimate.ts
var TASK_TYPES = [
  "feature",
  "bugfix",
  "refactor",
  "migration",
  "infrastructure",
  "documentation",
  "testing",
  "design"
];
var DEFAULT_TASK_TYPE = "feature";
var BASELINE_COMPLEXITY = 3;
var MIN_COMPLEXITY = 1;
var MAX_COMPLEXITY = 5;
var TASK_TYPE_PATTERNS = {
  bugfix: /\b(bug|bugs|fix|fixes|fixed|fixing|error|errors|exception|crash|crashes|crashed|broken|regression|null ?pointer|npe|stack trace|traceback|failing test|flaky|hotfix|patch)\b/gi,
  feature: /\b(add|adds|adding|implement|implements|implementing|new feature|feature request|introduce|introduces|support for|enable|enables)\b/gi,
  refactor: /\b(refactor|refactors|refactoring|clean ?up|restructure|restructuring|reorganize|reorganizing|simplify|simplifying|rename|renaming|extract (?:method|function|class)|dedupe|deduplicate)\b/gi,
  migration: /\b(migrate|migrates|migration|migrating|upgrade|upgrades|upgrading|port to|porting|move to|moving to|switch to|switching to|schema change|breaking change|backfill)\b/gi,
  infrastructure: /\b(deploy|deploys|deployment|\bci\b|\bcd\b|pipeline|infra(?:structure)?|docker|kubernetes|k8s|terraform|helm|provision(?:ing)?|dockerfile|github actions|workflow file)\b/gi,
  documentation: /\b(docs?|documentation|readme|changelog|comment|comments|commenting|docstring)\b/gi,
  testing: /\b(test|tests|testing|spec|specs|unit test|integration test|e2e|coverage|regression test)\b/gi,
  design: /\b(design|\bui\b|\bux\b|mockup|wireframe|figma|layout|styling|\bcss\b|visual|typography|color palette)\b/gi
};
var VOCAB_HIGH = /\b(overhaul|major refactor|breaking change|large[- ]scale|significant|epic|rewrite|redesign)\b/i;
var VOCAB_LOW = /\b(trivial|typo|tiny|one[- ]line|quick fix|minor|small tweak)\b/i;
var DIFF_LINE = /^[+-](?![+-])[^\n]*$/gm;
var FILE_COUNT_MENTION = /\b(\d+)\s+files?\b/i;
var LONG_CONTEXT_CHARS = 1200;
var SHORT_CONTEXT_CHARS = 80;
var DIFF_LINE_THRESHOLD = 5;
var LARGE_DIFF_LINE_THRESHOLD = 20;
function countMatches(text, pattern) {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}
function classifyTaskType(context) {
  let best = DEFAULT_TASK_TYPE;
  let bestScore = 0;
  for (const type of TASK_TYPES) {
    const score = countMatches(context, TASK_TYPE_PATTERNS[type]);
    if (score > bestScore) {
      bestScore = score;
      best = type;
    }
  }
  if (bestScore === 0) {
    return { taskType: DEFAULT_TASK_TYPE, matched: false, signal: "task_type_defaulted" };
  }
  return { taskType: best, matched: true, signal: `task_type_matched:${best}` };
}
function classifyComplexity(context, taskType, taskTypeMatched) {
  let delta = 0;
  const signals = [];
  const diffLineCount = countMatches(context, DIFF_LINE);
  if (diffLineCount >= DIFF_LINE_THRESHOLD) {
    delta += 1;
    signals.push("diff_markers");
    if (diffLineCount >= LARGE_DIFF_LINE_THRESHOLD) {
      delta += 1;
      signals.push("large_diff");
    }
  }
  const fileCountMatch = context.match(FILE_COUNT_MENTION);
  if (fileCountMatch) {
    const n = Number(fileCountMatch[1]);
    if (Number.isFinite(n) && n >= 3) {
      delta += 1;
      signals.push(`multi_file:${n}`);
      if (n >= 10) {
        delta += 1;
        signals.push("many_files");
      }
    }
  }
  if (context.length > LONG_CONTEXT_CHARS) {
    delta += 1;
    signals.push("long_context");
  } else if (context.length > 0 && context.length < SHORT_CONTEXT_CHARS) {
    delta -= 1;
    signals.push("short_context");
  }
  if (VOCAB_HIGH.test(context)) {
    delta += 1;
    signals.push("vocabulary_high");
  }
  if (VOCAB_LOW.test(context)) {
    delta -= 1;
    signals.push("vocabulary_low");
  }
  if (taskTypeMatched && (taskType === "migration" || taskType === "infrastructure")) {
    delta += 1;
    signals.push("task_type_risk");
  }
  const complexity = Math.min(MAX_COMPLEXITY, Math.max(MIN_COMPLEXITY, BASELINE_COMPLEXITY + delta));
  return { complexity, signals };
}
function countInformativeSignals(complexitySignals) {
  return complexitySignals.filter((s) => s !== "short_context").length;
}
function resolveConfidence(taskTypeMatched, informativeComplexitySignalCount) {
  const realSignalCount = (taskTypeMatched ? 1 : 0) + informativeComplexitySignalCount;
  if (taskTypeMatched && informativeComplexitySignalCount >= 2) return "high";
  if (realSignalCount >= 1) return "medium";
  return "low";
}
function classifyContext(context) {
  const trimmed = context.trim();
  const { taskType, matched, signal: taskTypeSignal } = classifyTaskType(trimmed);
  const { complexity, signals: complexitySignals } = classifyComplexity(trimmed, taskType, matched);
  const confidence = resolveConfidence(matched, countInformativeSignals(complexitySignals));
  return {
    taskType,
    complexity,
    confidence,
    signals: [taskTypeSignal, ...complexitySignals]
  };
}
function resolveContextEstimateInputs(classification, hints = {}) {
  return {
    taskType: hints.taskType ?? classification.taskType,
    complexity: hints.complexity ?? classification.complexity,
    taskTypeFromHint: hints.taskType !== void 0,
    complexityFromHint: hints.complexity !== void 0
  };
}

// src/lib/coverage.ts
var MIN_N_FOR_QUANTILES = 5;
var MIN_N_FOR_V2_POPULATION = 30;
function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
function clampedInterval(lower, upper) {
  return { lower: round(Math.max(0, lower), 2), upper: round(Math.max(0, upper), 2) };
}
var Z_P50 = 0.674;
var Z_P80 = 1.282;
var Z_P90 = 1.645;
function pertVarianceIntervals(expected, stdDeviation) {
  return {
    p50: clampedInterval(expected - Z_P50 * stdDeviation, expected + Z_P50 * stdDeviation),
    p80: clampedInterval(expected - Z_P80 * stdDeviation, expected + Z_P80 * stdDeviation),
    p90: clampedInterval(expected - Z_P90 * stdDeviation, expected + Z_P90 * stdDeviation),
    source: "pert_variance"
  };
}
function quantile(sortedAsc, q) {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.round(q * (sortedAsc.length - 1))));
  return sortedAsc[idx] ?? 0;
}
function empiricalRatioQuantiles(ratios) {
  if (ratios.length < MIN_N_FOR_QUANTILES) return null;
  const sorted = [...ratios].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: [quantile(sorted, 0.25), quantile(sorted, 0.75)],
    p80: [quantile(sorted, 0.1), quantile(sorted, 0.9)],
    p90: [quantile(sorted, 0.05), quantile(sorted, 0.95)]
  };
}
function empiricalIntervals(estimatedHours, quantiles) {
  return {
    p50: clampedInterval(estimatedHours * quantiles.p50[0], estimatedHours * quantiles.p50[1]),
    p80: clampedInterval(estimatedHours * quantiles.p80[0], estimatedHours * quantiles.p80[1]),
    p90: clampedInterval(estimatedHours * quantiles.p90[0], estimatedHours * quantiles.p90[1]),
    source: "empirical_ratio_quantile"
  };
}
function pertValueToHours(value, unit) {
  if (unit === void 0) return value;
  const factor = ESTIMATE_UNIT_TO_HOURS[unit];
  return factor === void 0 ? null : value * factor;
}
function loadCleanMatchedPairs() {
  const merged = loadLedgerWithOverlays();
  const pairs = [];
  for (const rec of merged) {
    if (!rec.actual) continue;
    if (!(rec.actual.actualHours > 0)) continue;
    const estimatedHours = extractEstimatedHours(rec.outputs);
    if (estimatedHours === null || !(estimatedHours > 0)) continue;
    const verdict = isExcluded({
      id: rec.id,
      tool: rec.tool,
      inputs: rec.inputs,
      estimatedAt: rec.estimatedAt,
      estimatedHours,
      actual: {
        actualHours: rec.actual.actualHours,
        notes: rec.actual.notes,
        reportedAt: rec.actual.reportedAt,
        completedAt: rec.actual.completedAt,
        calibrationProvenance: rec.actual.calibrationProvenance
      },
      flags: { quarantined: rec.flags.quarantined, orphan: rec.flags.orphan },
      ...rec.expiresAt && { expiresAt: rec.expiresAt }
    });
    if (verdict.excluded) continue;
    const taskType = typeof rec.inputs["task_type"] === "string" ? rec.inputs["task_type"] : "feature";
    const basisVersion = rec.basisVersion === CURRENT_BASIS_VERSION ? CURRENT_BASIS_VERSION : LEGACY_BASIS_VERSION;
    const expectedRaw = typeof rec.outputs["expected"] === "number" ? rec.outputs["expected"] : void 0;
    const stdDeviationRaw = typeof rec.outputs["stdDeviation"] === "number" ? rec.outputs["stdDeviation"] : void 0;
    const expectedHours = expectedRaw !== void 0 ? pertValueToHours(expectedRaw, rec.outputs["unit"]) : void 0;
    const stdDeviationHours = stdDeviationRaw !== void 0 ? pertValueToHours(stdDeviationRaw, rec.outputs["unit"]) : void 0;
    pairs.push({
      taskType,
      tool: rec.tool,
      basisVersion,
      estimatedHours,
      actualHours: rec.actual.actualHours,
      ...expectedHours !== null && expectedHours !== void 0 && stdDeviationHours !== null && stdDeviationHours !== void 0 && { expected: expectedHours, stdDeviation: stdDeviationHours }
    });
  }
  return pairs;
}
function populationKey(tool2, taskType, basisVersion) {
  return `${tool2}|${taskType}|v${basisVersion}`;
}
function empiricalRatioQuantilesForTaskType(taskType, tool2) {
  const cellPairs = loadCleanMatchedPairs().filter((pair) => pair.tool === tool2 && pair.taskType === taskType);
  const v2Ratios = cellPairs.filter((pair) => pair.basisVersion === CURRENT_BASIS_VERSION).map((pair) => pair.actualHours / pair.estimatedHours);
  const v1Ratios = cellPairs.filter((pair) => pair.basisVersion === LEGACY_BASIS_VERSION).map((pair) => pair.actualHours / pair.estimatedHours);
  const fromV2 = v2Ratios.length >= MIN_N_FOR_V2_POPULATION ? empiricalRatioQuantiles(v2Ratios) : null;
  if (fromV2) return { quantiles: fromV2, basisVersion: CURRENT_BASIS_VERSION, n: v2Ratios.length };
  const fromV1 = v1Ratios.length >= MIN_N_FOR_QUANTILES ? empiricalRatioQuantiles(v1Ratios) : null;
  if (fromV1) return { quantiles: fromV1, basisVersion: LEGACY_BASIS_VERSION, n: v1Ratios.length };
  const v2Only = v1Ratios.length === 0 && v2Ratios.length >= MIN_N_FOR_QUANTILES ? empiricalRatioQuantiles(v2Ratios) : null;
  return v2Only ? { quantiles: v2Only, basisVersion: CURRENT_BASIS_VERSION, n: v2Ratios.length } : null;
}
function predictInterval(pair, quantilesByPopulation) {
  if (pair.tool === "pert_estimate" && pair.expected !== void 0 && pair.stdDeviation !== void 0 && pair.stdDeviation >= 0) {
    return pertVarianceIntervals(pair.expected, pair.stdDeviation);
  }
  const quantiles = quantilesByPopulation.get(populationKey(pair.tool, pair.taskType, pair.basisVersion));
  if (!quantiles) return null;
  return empiricalIntervals(pair.estimatedHours, quantiles);
}
function computeIntervalCoverage() {
  const pairs = loadCleanMatchedPairs();
  const ratiosByPopulation = /* @__PURE__ */ new Map();
  for (const pair of pairs) {
    const key = populationKey(pair.tool, pair.taskType, pair.basisVersion);
    const arr = ratiosByPopulation.get(key) ?? [];
    arr.push(pair.actualHours / pair.estimatedHours);
    ratiosByPopulation.set(key, arr);
  }
  const quantilesByPopulation = /* @__PURE__ */ new Map();
  for (const [key, ratios] of ratiosByPopulation) {
    quantilesByPopulation.set(key, empiricalRatioQuantiles(ratios));
  }
  let totalScored = 0;
  let totalHits = 0;
  const typeTotals = /* @__PURE__ */ new Map();
  const typeHits = /* @__PURE__ */ new Map();
  const typeSources = /* @__PURE__ */ new Map();
  for (const pair of pairs) {
    const interval = predictInterval(pair, quantilesByPopulation);
    if (!interval) continue;
    totalScored += 1;
    typeTotals.set(pair.taskType, (typeTotals.get(pair.taskType) ?? 0) + 1);
    const sources = typeSources.get(pair.taskType) ?? /* @__PURE__ */ new Set();
    sources.add(interval.source);
    typeSources.set(pair.taskType, sources);
    const within = pair.actualHours >= interval.p80.lower && pair.actualHours <= interval.p80.upper;
    if (within) {
      totalHits += 1;
      typeHits.set(pair.taskType, (typeHits.get(pair.taskType) ?? 0) + 1);
    }
  }
  const byTaskType = {};
  const typesWithPairs = /* @__PURE__ */ new Set([...pairs.map((pair) => pair.taskType)]);
  const allTaskTypes = /* @__PURE__ */ new Set([...typeTotals.keys(), ...typesWithPairs]);
  for (const taskType of allTaskTypes) {
    const n = typeTotals.get(taskType) ?? 0;
    if (n === 0) {
      byTaskType[taskType] = { n: 0, p80CoverageRate: null, method: "insufficient_data" };
      continue;
    }
    const hits = typeHits.get(taskType) ?? 0;
    const sources = typeSources.get(taskType) ?? /* @__PURE__ */ new Set();
    const method = sources.size > 1 ? "mixed" : [...sources][0] ?? "insufficient_data";
    byTaskType[taskType] = { n, p80CoverageRate: round(hits / n, 3), method };
  }
  return {
    n: totalScored,
    p80CoverageRate: totalScored > 0 ? round(totalHits / totalScored, 3) : null,
    targetP80Coverage: 0.8,
    byTaskType,
    note: `In-sample calibration: P80 intervals for pert_estimate rows use their own recorded expected/stdDeviation converted to hours with the shared unit table (days=8h, weeks=40h, months=160h \u2014 same as ingest); every other tool uses empirical actual/estimate ratio quantiles computed per (tool, task_type, basis-era) population from the same exclusion-filtered corpus \u2014 populations are never pooled across tools or across basis eras (v1 = legacy pre-unification rows, v2 = rows stamped displayed==recorded; minimum ${MIN_N_FOR_QUANTILES} matched pairs per population; below that, method is "insufficient_data" and the pair is excluded from the coverage rate rather than scored against a fabricated interval). This is a coverage sanity check against the 0.80 target, not an out-of-sample validation.`
  };
}

// src/dispatcher/tool-registry.ts
function tool(name, description, inputSchema, outputSchema, handler) {
  return [name, { name, description, inputSchema, outputSchema, handler }];
}
var getCurrentTimeSchema = z2.object({
  timezone: z2.string().describe('IANA timezone identifier. Defaults to "UTC".').default("UTC")
});
var convertTimezoneSchema = z2.object({
  timestamp: z2.string().describe("ISO-8601 timestamp to convert."),
  target_tz: z2.string().describe("Target IANA timezone identifier.")
});
var parseDurationSchema = z2.object({
  duration_string: z2.string().describe('Duration string like "2h30m", "1d6h", "45m".')
});
var addBusinessDaysSchema = z2.object({
  start_date: z2.string().describe("ISO date string for the start date."),
  // Input safety bound (W1): the business-day walk is day-by-day, so an
  // uncapped days (e.g. 1e9) hangs the event loop. Bounded field from
  // schemas/index.ts (businessDaysOffset).
  days: businessDaysOffset,
  country: z2.string().regex(/^[A-Za-z]{2}$/, { error: 'country must be a 2-letter ISO-3166-1-alpha-2 code (e.g. US, UK, DE) \u2014 got "USA"-style and other malformed codes are rejected rather than silently counting weekends-only.' }).describe("ISO-3166-1-alpha-2 country code for holiday calendar. Supported holiday sets: US, UK, FR, DE, JP; other valid 2-letter codes fall back to weekend-only counting and say so in holidaySupport.").default("US")
});
var countBusinessDaysSchema = z2.object({
  start_date: z2.string().describe("ISO date string for the start date."),
  end_date: z2.string().describe("ISO date string for the end date."),
  country: z2.string().regex(/^[A-Za-z]{2}$/, { error: 'country must be a 2-letter ISO-3166-1-alpha-2 code (e.g. US, UK, DE) \u2014 got "USA"-style and other malformed codes are rejected rather than silently counting weekends-only.' }).describe("ISO-3166-1-alpha-2 country code for holiday calendar. Supported holiday sets: US, UK, FR, DE, JP; other valid 2-letter codes fall back to weekend-only counting and say so in holidaySupport.").default("US")
});
var getPendingEstimatesSchema = z2.object({
  limit: z2.number().int().positive().max(100).default(20).describe("Max estimates to return.")
});
var temporalOutput = {
  type: "object",
  properties: {
    iso: { type: "string", description: "ISO-8601 timestamp" },
    humanReadable: { type: "string", description: "Human-readable date/time" },
    timezone: { type: "string", description: "IANA timezone identifier" },
    utcOffset: { type: "string", description: "UTC offset string" }
  }
};
var durationOutput = {
  type: "object",
  properties: {
    input: { type: "string" },
    totalSeconds: { type: "number" },
    humanReadable: { type: "string" }
  }
};
var businessDayOutput = {
  type: "object",
  properties: {
    startDate: { type: "string", description: "Start date (ISO)" },
    endDate: { type: "string", description: "End date (ISO)" },
    businessDays: { type: "number", description: "Number of business days" },
    countryCode: { type: "string", description: "ISO-3166 country code" },
    calendarVersion: { type: "string", description: "Holiday-table version stamp (CALENDAR_VERSION) used for the computation" },
    holidaySupport: { type: "string", enum: ["holiday_calendar", "weekends_only"], description: '"weekends_only" when the country code is valid 2-letter ISO but has no bundled holiday set (US/UK/FR/DE/JP do) \u2014 the count then excludes weekends only. Never silent: the fallback is named in the output.' },
    humanReadable: { type: "string", description: "Human-readable summary" }
  }
};
var feedbackRefField = { type: "string", description: "Token for recording actual hours via record_actual" };
var pertOutput = {
  type: "object",
  properties: {
    optimistic: { type: "number" },
    mostLikely: { type: "number" },
    pessimistic: { type: "number" },
    expected: { type: "number", description: "PERT expected value" },
    variance: { type: "number" },
    stdDeviation: { type: "number" },
    confidence95: { type: "array", items: { type: "number" }, description: "95% confidence interval [lower, upper]" },
    confidence99: { type: "array", items: { type: "number" }, description: "99% confidence interval [lower, upper]" },
    unit: { type: "string", enum: ["hours", "days", "weeks", "months"] },
    urgencyCategory: { type: "string", enum: ["short", "medium", "long"] },
    riskLevel: { type: "string", enum: ["low", "medium", "high"], description: "Estimation risk based on spread between optimistic and pessimistic" },
    humanReadable: { type: "string", description: "Human-readable summary. Leads with the calibrated P80 interval when one could be computed, followed by the point estimate." },
    adjustedEstimate: { type: "number", description: "Labeled dual field (one minor version): the developerProfile/learned-corrected headline. NOT the recorded basis \u2014 intervals and calibration use `expected`; see `basisNote`." },
    basisNote: { type: "string", description: "Names which fields carry the recorded basis (`expected`) versus the adjusted dual (`adjustedEstimate`) and which basis the intervals are scaled on." },
    intervalPopulation: { type: "string", description: "Which ratio population the empirical interval used: the v2 (basis-unified) (pert_estimate, task_type) cell, or the v1 fallback computed on the v1 recorded basis." },
    interval: {
      type: "object",
      description: 'P50/P80/P90 calibrated prediction intervals around the RECORDED basis (raw PERT `expected` \xD7 unit factor \u2014 never adjustedEstimate). `source` is "empirical_ratio_quantile" when >=5 exclusion-filtered historical (pert_estimate, task_type) pairs are available, else "pert_variance" (derived from this estimate\'s own optimistic/most_likely/pessimistic spread) \u2014 see `intervalNote` when the fallback is used.',
      properties: {
        p50: { type: "object", properties: { lower: { type: "number" }, upper: { type: "number" } } },
        p80: { type: "object", properties: { lower: { type: "number" }, upper: { type: "number" } } },
        p90: { type: "object", properties: { lower: { type: "number" }, upper: { type: "number" } } },
        source: { type: "string", enum: ["pert_variance", "empirical_ratio_quantile"] }
      }
    },
    intervalNote: { type: "string", description: "Present only when the empirical per-task-type interval was unavailable (n<5) and the PERT-variance fallback was used instead." },
    referenceClassCrossCheck: { type: "object", description: "Reference class estimate for comparison (AI-native only)", properties: { estimate: { type: "number" }, scope: { type: "string" }, baselineSource: { type: "string" }, sampleSize: { type: "number" } } },
    recommendation: { type: "string", description: "When reference class disagrees significantly with PERT, explains which to trust" },
    rawEstimate: { type: "number", description: "Pre-correction expected-based headline (same value as `expected`), exposed for provenance parity with reference_class_estimate." },
    correctionFactor: { type: "number", description: "Learned (pert_estimate, task_type) correction factor from computeToolTaskCorrectionFactors, independent of the ai_native developerProfile factor. 1.0 when EPOCH_PERT_LEARNED_CORRECTION is off or the cell has fewer than MIN_RECORDS_PER_FACTOR matched pairs." },
    n: { type: "number", description: "Matched-pair sample size for the (pert_estimate, task_type) correction cell. 0 when the learned-correction flag is off or no task_type was supplied." },
    feedbackRef: feedbackRefField
  }
};
var cocomoOutput = {
  type: "object",
  properties: {
    kloc: { type: "number" },
    personMonthsNominal: { type: "number" },
    personMonthsLlmAdjusted: { type: "number" },
    effortMultipliers: { type: "object", additionalProperties: { type: "number" } },
    assumptions: { type: "array", items: { type: "string" } },
    aiSpeedup: { type: "number", description: "AI speedup factor (nominal / LLM-adjusted)" },
    speedupCategory: { type: "string", enum: ["moderate", "significant", "extreme"], description: "Qualitative speedup category" },
    feedbackRef: feedbackRefField
  }
};
var sprintOutput = {
  type: "object",
  properties: {
    backlogPoints: { type: "number" },
    averageVelocity: { type: "number" },
    requiredSprints: { type: "number" },
    optimisticSprints: { type: "number" },
    pessimisticSprints: { type: "number" },
    hoursPerPoint: { type: "number" },
    totalHours: { type: "number" },
    completionDays: { type: "number" },
    sprintLengthDays: { type: "number" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    velocityCv: { type: "number" },
    estimatedTokenCost: { type: "number", description: "Estimated AI token cost (50k tokens/hour \xD7 totalHours)" },
    feedbackRef: feedbackRefField
  }
};
var criticalPathOutput = {
  type: "object",
  properties: {
    critical_path: { type: "array", items: { type: "string" } },
    slack_per_task: { type: "object", additionalProperties: { type: "number" } },
    total_duration: { type: "number" },
    merge_bias_adjustment: { type: "number" },
    estimatedHours: { type: "number", description: "Total duration in hours (total_duration \xD7 8)" },
    estimatedTokenCost: { type: "number", description: "Estimated token cost (50k tokens/hour \xD7 estimatedHours)" }
  }
};
var monteCarloOutput = {
  type: "object",
  properties: {
    p10: { type: "string", description: "10th percentile (optimistic)" },
    p50: { type: "string", description: "50th percentile (median)" },
    p80: { type: "string", description: "80th percentile" },
    p95: { type: "string", description: "95th percentile (conservative)" },
    criticalPathProbability: {
      type: ["number", "null"],
      description: "P(total <= target_hours) when a target_hours deadline was supplied; null otherwise (never a fabricated probability)"
    },
    targetHours: { type: "number", description: "The caller-supplied deadline in hours the probability was computed against, when supplied" },
    converged: { type: "boolean", description: "Whether p50 converged between iteration halves" },
    riskEvents: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          probability: { type: "number" },
          impactDays: { type: "number" }
        }
      }
    },
    humanReadable: { type: "string", description: "Human-readable summary" },
    estimatedHours: { type: "number", description: "Median estimate in hours (p50 \xD7 8)" },
    estimatedCost: { type: "number", description: "Estimated AI token cost at p50 (50k tokens/hour \xD7 estimatedHours)" },
    feedbackRef: feedbackRefField
  }
};
var tokenTimeOutput = {
  type: "object",
  properties: {
    tokens: { type: "number" },
    model: { type: "string" },
    estimatedSeconds: { type: "number" },
    estimatedMinutes: { type: "number" },
    confidence: { type: "string", enum: ["likely", "optimistic", "pessimistic"] },
    urgency: { type: "string", enum: ["short", "medium", "long"] },
    breakdown: {
      type: "object",
      properties: {
        promptTokens: { type: "number" },
        completionTokens: { type: "number" },
        toolOverheadSeconds: { type: "number" }
      }
    },
    humanReadable: { type: "string", description: "Human-readable summary" },
    estimatedTokenCost: { type: "number", description: "Estimated AI token cost (50k tokens/hour \xD7 estimatedHours)" },
    feedbackRef: feedbackRefField
  }
};
var referenceClassOutput = {
  type: "object",
  properties: {
    rawEstimate: { type: "number" },
    correctedEstimate: { type: "number" },
    correctionFactor: { type: "number" },
    sampleSize: { type: "number" },
    confidence: { type: "string", enum: ["likely", "optimistic", "pessimistic"] },
    estimatedTokenCost: { type: "number", description: "Estimated AI token cost (50k tokens/hour \xD7 correctedEstimate)" },
    humanReadable: { type: "string", description: "Human-readable summary. Leads with the calibrated P80 interval when >=5 exclusion-filtered historical (reference_class_estimate, task_type) pairs are available; otherwise states plainly that there wasn't enough data for a confidence interval." },
    adjustedEstimate: { type: "number", description: "Labeled dual field (one minor version): developerProfile-adjusted headline. NOT the recorded basis \u2014 intervals and calibration use `correctedEstimate`; see `basisNote`." },
    basisNote: { type: "string", description: "Names which fields carry the recorded basis (`correctedEstimate`) versus the adjusted dual (`adjustedEstimate`) and which basis the intervals are scaled on." },
    intervalPopulation: { type: "string", description: "Which ratio population the empirical interval used: the v2 (basis-unified) (reference_class_estimate, task_type) cell, or the v1 fallback computed on the v1 recorded basis." },
    interval: {
      type: "object",
      description: "P50/P80/P90 empirical prediction intervals around the RECORDED basis (`correctedEstimate` \u2014 never adjustedEstimate), from per-task-type actual/estimate ratio quantiles. Present only when >=5 matched pairs were available for this task_type \u2014 see `intervalNote` otherwise.",
      properties: {
        p50: { type: "object", properties: { lower: { type: "number" }, upper: { type: "number" } } },
        p80: { type: "object", properties: { lower: { type: "number" }, upper: { type: "number" } } },
        p90: { type: "object", properties: { lower: { type: "number" }, upper: { type: "number" } } },
        source: { type: "string", enum: ["empirical_ratio_quantile"] }
      }
    },
    intervalNote: { type: "string", description: "Present only when there wasn't enough per-task-type data (n<5) to compute an empirical interval." },
    feedbackRef: feedbackRefField
  }
};
var estimateFromContextOutput = {
  type: "object",
  properties: {
    tool: { type: "string" },
    rawEstimate: { type: "number" },
    correctedEstimate: { type: "number" },
    correctionFactor: { type: "number" },
    sampleSize: { type: "number" },
    baselineSource: { type: "string" },
    scopeUsed: { type: "string" },
    scopeInferred: { type: "boolean" },
    confidence: { type: "string", enum: ["likely", "optimistic", "pessimistic"] },
    estimatedTokenCost: { type: "number" },
    classification: {
      type: "object",
      description: "Provenance of the local heuristic classification (src/lib/context-estimate.ts), before any caller-supplied hint override.",
      properties: {
        classified_task_type: { type: "string" },
        classified_complexity: { type: "number" },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        signals: { type: "array", items: { type: "string" } },
        task_type_from_hint: { type: "boolean" },
        complexity_from_hint: { type: "boolean" }
      }
    },
    lowConfidenceNote: { type: "string" },
    note: { type: "string" },
    feedbackRef: feedbackRefField
  }
};
var calibrateOutput = {
  type: "object",
  properties: {
    mape: { type: "number", description: "Mean Absolute Percentage Error" },
    bias: { type: "number", description: "Mean bias (positive = underestimation)" },
    variance: { type: "number" },
    sample_size: { type: "number" },
    trend: { type: "string", enum: ["improving", "degrading", "stable"] }
  }
};
var accuracyTrendOutput = {
  type: "object",
  properties: {
    windows: { type: "array", items: { type: "object", properties: { period: { type: "string" }, mape: { type: "number" }, bias: { type: "number" }, sampleSize: { type: "number" } } } },
    overallTrend: { type: "string", enum: ["improving", "degrading", "stable"] },
    currentMape: { type: "number" },
    industryBaselineMape: { type: "number" },
    improvementVsIndustry: { type: "number" },
    totalEstimates: { type: "number" },
    totalWithActuals: { type: "number" },
    humanReadable: { type: "string" }
  }
};
var timeMathOutput = {
  type: "object",
  description: "Varies by operation. Returns temporal, duration, or date diff data."
};
var HOURS_PER_UNIT = { hours: 1, days: 8, weeks: 40, months: 160 };
function toHoursForUnit(value, unit) {
  return value * (HOURS_PER_UNIT[unit] ?? 1);
}
function fromHoursForUnit(hours, unit) {
  return hours / (HOURS_PER_UNIT[unit] ?? 1);
}
function round2(value) {
  return Math.round(value * 100) / 100;
}
function intervalToUnit(interval, unit) {
  return { lower: round2(fromHoursForUnit(interval.lower, unit)), upper: round2(fromHoursForUnit(interval.upper, unit)) };
}
function formatInterval(interval, unitLabel) {
  return `${interval.lower}\u2013${interval.upper} ${unitLabel}`;
}
var monteCarloTargetSchema = monteCarloSchema.extend({
  target_hours: z2.coerce.number().positive().optional().describe(
    "Optional deadline in working hours (task durations are in 8-hour days). When supplied, criticalPathProbability reports P(total <= target_hours); when omitted it is null instead of a fabricated value."
  )
});
var handlers = Object.fromEntries([
  // -- Temporal tools (6) ----------------------------------------------------
  tool(
    "get_current_time",
    "Returns the current date and time in the specified IANA timezone. Useful for grounding the LLM in the user's local time. Example timezones: 'UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo'.",
    getCurrentTimeSchema,
    temporalOutput,
    (input) => {
      const p = getCurrentTimeSchema.parse(input);
      return getCurrentTime(p.timezone);
    }
  ),
  tool(
    "convert_timezone",
    "Converts an ISO-8601 timestamp to a target IANA timezone. The input timestamp must include timezone information or be in UTC. Returns the localised time, UTC offset, and human-readable format. Use when you need to display or compare a moment in another region's local time.",
    convertTimezoneSchema,
    temporalOutput,
    (input) => {
      const p = convertTimezoneSchema.parse(input);
      return convertTimezone(p.timestamp, p.target_tz);
    }
  ),
  tool(
    "parse_duration",
    "Parses a human-readable duration string into structured seconds. Supports combinations of y (years), mo (months), w (weeks), d (days), h (hours), m (minutes), s (seconds). Examples: '2h30m', '1d6h', '1w3d', '45m'. Returns the total seconds for the duration. Use when normalising a free-text duration for arithmetic or comparison.",
    parseDurationSchema,
    durationOutput,
    (input) => {
      const p = parseDurationSchema.parse(input);
      return parseDuration(p.duration_string);
    }
  ),
  tool(
    "time_math",
    "Performs compound time-math operations. Dispatches to the appropriate sub-operation based on the 'operation' parameter. Operations: add_days, add_business_days, diff, convert_tz, parse_nl, format_duration. Use this for multi-step or dynamic time operations; for single-purpose calls use get_current_time, convert_timezone, parse_duration, add_business_days, or count_business_days.",
    timeMathSchema,
    timeMathOutput,
    (input) => {
      const p = timeMathSchema.parse(input);
      const operation = p.operation;
      let ops = p.operands;
      if (typeof ops === "string") {
        try {
          ops = JSON.parse(ops);
        } catch {
        }
      }
      if (!ops || typeof ops !== "object") ops = {};
      return dispatchTimeMath(operation, ops);
    }
  ),
  tool(
    "add_business_days",
    "Adds N business (working) days to a start date, skipping weekends and country-specific public holidays. Supports US, UK, FR, DE, and JP holidays. Returns the resulting date. Use when computing a deadline that excludes non-working days.",
    addBusinessDaysSchema,
    businessDayOutput,
    (input) => {
      const p = addBusinessDaysSchema.parse(input);
      const result = addBusinessDays(p.start_date, p.days, p.country);
      if (!result.ok) return result;
      return { ok: true, data: { ...result.data, holidaySupport: holidayRegistry.hasCountry(p.country) ? "holiday_calendar" : "weekends_only" } };
    }
  ),
  tool(
    "count_business_days",
    "Counts the number of business (working) days between two dates, excluding weekends and country-specific public holidays. The count is exclusive of the start date and inclusive of the end date. Returns the integer day count. Use when measuring working-time span between two dates.",
    countBusinessDaysSchema,
    businessDayOutput,
    (input) => {
      const p = countBusinessDaysSchema.parse(input);
      const result = countBusinessDays(p.start_date, p.end_date, p.country);
      if (!result.ok) return result;
      return { ok: true, data: { ...result.data, holidaySupport: holidayRegistry.hasCountry(p.country) ? "holiday_calendar" : "weekends_only" } };
    }
  ),
  // -- Estimation tools (5) --------------------------------------------------
  tool(
    "pert_estimate",
    `Calculate PERT expected duration from three-point estimates using Beta distribution.

Formula: E = (O + 4M + P) / 6. Returns expected value, variance, standard deviation,
and 95%/99% confidence bounds with urgency categorization.
Use when estimating task duration with uncertain outcomes.`,
    pertEstimateSchema,
    pertOutput,
    (input) => {
      const p = pertEstimateSchema.parse(input);
      const profile = getDeveloperProfileGradient(p.ai_native);
      const result = pertEstimate(p.optimistic, p.most_likely, p.pessimistic, p.unit);
      if (!result.ok) return result;
      let composedFactor = profile.correctionFactor;
      let learnedFactor = 1;
      let learnedN = 0;
      if (isPertLearnedCorrectionEnabled() && p.task_type) {
        const learned = getPertToolTaskCorrection(p.task_type);
        learnedFactor = learned.factor;
        learnedN = learned.n;
        composedFactor = composePertCorrectionFactor(learned, profile.correctionFactor).factor;
      }
      const adjustedEstimate = Math.round(result.data.expected * composedFactor * 100) / 100;
      const data = {
        ...result.data,
        developerProfile: { mode: profile.mode, correctionFactor: profile.correctionFactor },
        adjustedEstimate,
        rawEstimate: result.data.expected,
        correctionFactor: learnedFactor,
        n: learnedN
      };
      const selection = p.task_type ? empiricalRatioQuantilesForTaskType(p.task_type, "pert_estimate") : null;
      let interval;
      let intervalNote;
      let intervalPopulation;
      if (selection) {
        const hoursIntervals = empiricalIntervals(toHoursForUnit(result.data.expected, p.unit), selection.quantiles);
        interval = {
          p50: intervalToUnit(hoursIntervals.p50, p.unit),
          p80: intervalToUnit(hoursIntervals.p80, p.unit),
          p90: intervalToUnit(hoursIntervals.p90, p.unit),
          source: "empirical_ratio_quantile"
        };
        intervalPopulation = `basis-v${selection.basisVersion} pert_estimate "${p.task_type}" matched pairs (n=${selection.n})`;
      } else {
        interval = pertVarianceIntervals(result.data.expected, result.data.stdDeviation);
        intervalNote = p.task_type ? `Fewer than 5 exclusion-filtered historical "${p.task_type}" pert_estimate pairs are available yet, so this interval is derived from the PERT variance (optimistic/most_likely/pessimistic spread) instead of empirical data.` : "No task_type was supplied, so this interval is derived from the PERT variance (optimistic/most_likely/pessimistic spread) instead of empirical data.";
      }
      data.interval = interval;
      if (intervalNote) data.intervalNote = intervalNote;
      if (intervalPopulation) data.intervalPopulation = intervalPopulation;
      data.basisNote = `Interval and point estimate are on the ledger-recorded basis (raw PERT expected \xD7 unit factor). adjustedEstimate (${adjustedEstimate} ${p.unit}) additionally applies the correction factor (${composedFactor}) and is display-only \u2014 it is never recorded or calibrated against.`;
      data.humanReadable = `Expected ${formatInterval(interval.p80, p.unit)} (80% confidence interval); point estimate ${result.data.expected} ${p.unit} (ledger-recorded basis; adjustedEstimate ${adjustedEstimate} applies the correction factor).${intervalNote ? ` ${intervalNote}` : ""}${intervalPopulation ? ` Interval calibrated from ${intervalPopulation}.` : ""}`;
      if (p.ai_native >= 0.7 && p.task_type) {
        const scope = inferScopeFromComplexity(
          result.data.expected <= 1 ? 1 : result.data.expected <= 4 ? 2 : result.data.expected <= 8 ? 3 : result.data.expected <= 20 ? 4 : 5
        );
        const records = getCalibrationData(void 0, p.task_type, 90, "reference_class_estimate");
        const refResult = referenceClassEstimate(records, p.task_type, 3, scope, true);
        const refEstimate = Math.round(refResult.correctedEstimate * 100) / 100;
        data.referenceClassCrossCheck = {
          estimate: refEstimate,
          scope,
          baselineSource: refResult.baselineSource,
          sampleSize: refResult.sampleSize
        };
        if (refEstimate < result.data.expected * 0.5) {
          data.recommendation = `For AI-native ${p.task_type} work, reference_class_estimate (${refEstimate}h) is typically more accurate than PERT (${result.data.expected}h). AI agents finish local-prep tasks 3-10x faster than PERT pessimistic scenarios suggest.`;
        }
      }
      return { ok: true, data };
    }
  ),
  tool(
    "cocomo_estimate",
    `LLM-adapted COCOMO II parametric effort estimation.

Replaces traditional 17 human-labor cost drivers with 5 LLM-specific factors:
reasoning complexity, context completeness, transformation impact, iterative cycles,
and human oversight. Returns both nominal and LLM-adjusted person-months. Use when estimating effort for a codebase you can size in KLOC.
iterative_cycles: values <= 2.0 are literal multipliers (0.5 = one-shot,
1.0 = typical debug loop, 2.0 = heavy back-and-forth); values above 2.0 are
literal cycle counts, each additional cycle adding 0.1 of multiplier anchored
at 2.0 (2.0 -> 2.0x, 3 -> 2.1x, 10 -> 2.8x) \u2014 monotonic with no cliff at 2.0.`,
    cocomoEstimateSchema,
    cocomoOutput,
    (input) => {
      const p = cocomoEstimateSchema.parse(input);
      const profile = getDeveloperProfileGradient(p.ai_native);
      const rawCycles = p.iterative_cycles;
      const iterativeCycles = rawCycles <= 2 ? rawCycles : 2 + 0.1 * (Math.min(rawCycles, 10) - 2);
      const result = cocomoEstimate({
        kloc: p.kloc,
        reasoningComplexity: p.reasoning_complexity,
        contextCompleteness: p.context_completeness,
        transformationImpact: p.transformation_impact,
        iterativeCycles,
        humanOversight: p.human_oversight
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: {
          ...result.data,
          developerProfile: { mode: profile.mode, correctionFactor: profile.correctionFactor }
        }
      };
    }
  ),
  tool(
    "sprint_forecast",
    `Forecast sprint completion date from backlog size and historical velocity.

Computes average velocity from sprint history, converts story points to hours,
and returns required sprints with pessimistic estimate based on velocity variance. Use when planning a sprint completion date from backlog size and velocity history.`,
    sprintForecastSchema,
    sprintOutput,
    (input) => {
      const p = sprintForecastSchema.parse(input);
      const profile = getDeveloperProfileGradient(p.ai_native);
      const result = sprintForecast({
        backlogPoints: p.backlog_points,
        velocityHistory: p.velocity_history,
        sprintLengthDays: p.sprint_length_days,
        hoursPerSprint: p.hours_per_sprint
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: {
          ...result.data,
          developerProfile: { mode: profile.mode, sprintVelocityPoints: profile.sprintVelocityPoints, correctionFactor: profile.correctionFactor }
        }
      };
    }
  ),
  tool(
    "critical_path",
    `Compute critical path with merge-bias adjustment for project schedules.

Performs forward/backward pass to identify critical tasks and slack.
Applies merge bias: tasks with >2 predecessors get 5% duration increase per extra predecessor. Returns the critical path, task slack, and project duration. Use when sequencing dependent tasks to find the longest path and available slack.`,
    criticalPathSchema,
    criticalPathOutput,
    (input) => {
      const p = criticalPathSchema.parse(input);
      return criticalPath(p.tasks);
    }
  ),
  // monte_carlo_schedule uses monteCarloTargetSchema (declared above the
  // handlers map): optional target_hours for P(total <= target).
  tool(
    "monte_carlo_schedule",
    `Run Monte Carlo simulation for probabilistic schedule risk analysis.

Samples task durations from triangular distributions and returns P10/P50/P80/P95
completion estimates with identified risk events. Use seed for reproducible results.
Supply target_hours (working hours; durations are 8-hour days) to get
criticalPathProbability = P(total <= target_hours); without it that field is null.`,
    monteCarloTargetSchema,
    monteCarloOutput,
    (input) => {
      const p = monteCarloTargetSchema.parse(input);
      const taskCount = p.tasks.length;
      const product = taskCount * p.iterations;
      if (product > MONTE_CARLO_ITERATION_TASK_PRODUCT_LIMIT) {
        const maxIterations = Math.max(1, Math.floor(MONTE_CARLO_ITERATION_TASK_PRODUCT_LIMIT / taskCount));
        return {
          ok: false,
          error: {
            isError: true,
            message: `iterations \xD7 tasks = ${product.toLocaleString("en-US")} exceeds the ${MONTE_CARLO_ITERATION_TASK_PRODUCT_LIMIT.toLocaleString("en-US")} cap (${p.iterations.toLocaleString("en-US")} iterations \xD7 ${taskCount} tasks).`,
            retryHint: `Lower iterations to at most ${maxIterations.toLocaleString("en-US")} for ${taskCount} tasks, or split the schedule into smaller task lists.`
          }
        };
      }
      const tasks = p.tasks.map((t) => ({
        name: t.name,
        optimistic: t.optimistic,
        mostLikely: t.most_likely,
        pessimistic: t.pessimistic
      }));
      return { ok: true, data: monteCarloSim(tasks, p.iterations, p.seed, p.target_hours) };
    }
  ),
  // -- Analytics tools (3) ---------------------------------------------------
  tool(
    "reference_class_estimate",
    `Data-driven estimate using reference class forecasting.

Applies historical correction factors based on actual-vs-estimated ratios.
When no historical data exists, uses industry averages (1.3-2.2x for software tasks).
Prioritize this over algorithmic models when historical data is available.`,
    referenceClassEstimateSchema,
    referenceClassOutput,
    (input) => {
      const p = referenceClassEstimateSchema.parse(input);
      const profile = getDeveloperProfileGradient(p.ai_native);
      const records = getCalibrationData(
        p.team_id,
        p.task_type,
        90,
        "reference_class_estimate"
      );
      const result = referenceClassEstimate(records, p.task_type, p.complexity, p.scope, p.ai_native >= 0.7);
      const scopeGuide = getScopeGuide(p.task_type);
      const adjustedEstimate = Math.round(result.rawEstimate * profile.correctionFactor * 100) / 100;
      const selection = empiricalRatioQuantilesForTaskType(p.task_type, "reference_class_estimate");
      let interval;
      let intervalNote;
      let intervalPopulation;
      let humanReadable;
      if (selection) {
        interval = empiricalIntervals(result.correctedEstimate, selection.quantiles);
        intervalPopulation = `basis-v${selection.basisVersion} reference_class_estimate "${p.task_type}" matched pairs (n=${selection.n})`;
        humanReadable = `Expected ${formatInterval(interval.p80, "hours")} (80% confidence interval); point estimate ${result.correctedEstimate} hours (ledger-recorded basis; adjustedEstimate ${adjustedEstimate} applies the developerProfile correction). Interval calibrated from ${intervalPopulation}.`;
      } else {
        intervalNote = `Fewer than 5 exclusion-filtered historical "${p.task_type}" reference_class_estimate pairs are available yet, so no empirical confidence interval could be computed.`;
        humanReadable = `Expected ~${result.correctedEstimate} hours (point estimate, ledger-recorded basis; adjustedEstimate ${adjustedEstimate} applies the developerProfile correction). ${intervalNote}`;
      }
      return {
        ok: true,
        data: {
          ...result,
          ...scopeGuide ? { scopeGuide } : {},
          developerProfile: {
            mode: profile.mode,
            estimationMape: profile.estimationMape,
            underestimationBias: profile.underestimationBias,
            correctionFactor: profile.correctionFactor
          },
          adjustedEstimate,
          // PRD dual-field rule (ticket 11): both bases are emitted, labeled.
          basisNote: `correctedEstimate (${result.correctedEstimate} hours) is the ledger-recorded and displayed basis (rawEstimate \xD7 correctionFactor). adjustedEstimate (${adjustedEstimate} hours) additionally applies the developerProfile factor (${profile.correctionFactor}) and is display-only \u2014 it is never recorded or calibrated against.`,
          note: records.length >= 5 ? `Based on ${records.length} historical records for "${p.task_type}" tasks.` : "Using reference database correction factors. Submit actuals via /v1/feedback/record-actual to improve accuracy.",
          humanReadable,
          ...interval ? { interval } : {},
          ...intervalNote ? { intervalNote } : {},
          ...intervalPopulation ? { intervalPopulation } : {}
        }
      };
    }
  ),
  tool(
    "calibrate_estimates",
    `Recalculate team-specific correction factors from historical estimation data.

Compares estimated vs actual hours to compute a correction multiplier.
Requires PM system integration for best results. Returns recommendations
for improving estimation accuracy. Use when you have accumulated actuals and want to refresh team calibration factors.`,
    calibrateEstimatesSchema,
    calibrateOutput,
    (input) => {
      const p = calibrateEstimatesSchema.parse(input);
      const records = getCalibrationData(
        p.team_id,
        void 0,
        p.period_days
      );
      return {
        ok: true,
        data: calibrateEstimates(
          p.team_id,
          p.period_days,
          p.minimum_samples,
          records
        )
      };
    }
  ),
  tool(
    "token_time_bridge",
    `Map LLM token budgets to estimated wall-clock time.

Uses model-specific calibration data (tokens/second, reasoning overhead,
tool-call latency) to estimate how long a task will actually take.
Bridges the gap between token-space (how agents reason) and time-space (what humans need).
Use token_cost_estimate instead when dollar cost matters too.`,
    tokenTimeBridgeSchema,
    tokenTimeOutput,
    (input) => {
      const p = tokenTimeBridgeSchema.parse(input);
      return {
        ok: true,
        data: tokenTimeBridge({
          tokens: p.tokens,
          model: p.model,
          toolCalls: p.tool_calls,
          reasoningDepth: p.reasoning_depth
        })
      };
    }
  ),
  // -- Cost & Comparison tools (2) -------------------------------------------
  tool(
    "token_cost_estimate",
    `Estimate wall-clock time AND dollar cost for LLM token usage.

Combines token-to-time mapping with model-specific pricing data.
Returns cost breakdown (input/output/overhead) alongside the time estimate.
Use token_time_bridge when you only need wall-clock time and not dollar cost.`,
    tokenCostEstimateSchema,
    tokenTimeOutput,
    (input) => {
      const p = tokenCostEstimateSchema.parse(input);
      return {
        ok: true,
        data: tokenCostEstimate({
          tokens: p.tokens,
          model: p.model,
          toolCalls: p.tool_calls,
          reasoningDepth: p.reasoning_depth
        })
      };
    }
  ),
  tool(
    "compare_models",
    `Compare all LLM models side-by-side for a given token budget.

Ranks models by estimated cost or time. Shows quality tier for each model.
Use when choosing which model to use for a task.`,
    compareModelsSchema,
    { type: "object", properties: { tokens: { type: "number" }, models: { type: "array" }, humanReadable: { type: "string" } } },
    (input) => {
      const p = compareModelsSchema.parse(input);
      return {
        ok: true,
        data: compareModels({
          tokens: p.tokens,
          toolCalls: p.tool_calls,
          reasoningDepth: p.reasoning_depth,
          sortBy: p.sort_by
        })
      };
    }
  ),
  // -- Analytics & Risk tools (3) --------------------------------------------
  tool(
    "accuracy_trend",
    `Track estimation accuracy improvement over time.

Computes sliding-window MAPE and compares against industry baseline (25%).
Shows whether your estimates are improving, degrading, or stable.
Industry research shows estimation accuracy does NOT improve with experience (Cao 2022) \u2014 self-correcting systems like Epoch can buck this trend.`,
    accuracyTrendSchema,
    accuracyTrendOutput,
    (input) => {
      const p = accuracyTrendSchema.parse(input);
      return {
        ok: true,
        data: computeAccuracyTrend({
          teamId: p.team_id,
          windowSize: p.window_size
        })
      };
    }
  ),
  tool(
    "schedule_risk",
    `Assess schedule risk for an estimate using historical accuracy data.

Computes confidence intervals (p50/p80/p95) based on your team's MAPE.
Returns risk level and actionable recommendations.
Uses industry baseline (25% MAPE) when no historical data is available.`,
    scheduleRiskSchema,
    { type: "object", properties: { estimatedHours: { type: "number" }, estimatedTokenCost: { type: "number", description: "Estimated AI token cost (50k tokens/hour \xD7 estimatedHours)" }, riskLevel: { type: "string" }, confidenceIntervals: { type: "object" }, historicalAccuracy: { type: "object", properties: { mape: { type: "number" }, mdape: { type: "number" }, sampleSize: { type: "number" } } }, taskTypeBreakdown: { type: "object", additionalProperties: { type: "object", properties: { riskLevel: { type: "string" }, mdape: { type: "number" }, sampleSize: { type: "number" } } }, description: "Risk breakdown by task type from historical data" }, recommendation: { type: "string" } } },
    (input) => {
      const p = scheduleRiskSchema.parse(input);
      return {
        ok: true,
        data: scheduleRisk({
          estimatedHours: p.estimated_hours,
          taskType: p.task_type,
          teamId: p.team_id,
          aiNative: p.ai_native,
          complexity: p.complexity
        })
      };
    }
  ),
  tool(
    "cocomo_validate",
    `Validate COCOMO estimation model against 195 real historical projects.

Runs the COCOMO Basic formula against projects from NASA93, COCOMO81, Albrecht, and Kemerer datasets.
Reports overall MAPE, bias, per-type accuracy, and recommended coefficient adjustments.
Use cocomo_ground_truth for the full multi-model benchmark across all COCOMO and AI-adjusted models.`,
    cocomoValidateSchema,
    { type: "object", properties: { projectsEvaluated: { type: "number" }, mape: { type: "number" }, bias: { type: "number" }, humanReadable: { type: "string" } } },
    (input) => {
      const p = cocomoValidateSchema.parse(input);
      return cocomoValidate({
        datasetFilter: p.dataset_filter
      });
    }
  ),
  tool(
    "cocomo_ground_truth",
    `Validate all COCOMO estimation models against 240 real historical projects with known effort.

Runs 6 models in parallel: COCOMO Basic, COCOMO II Nominal, COCOMO II + AI 12x speedup, and AI + developer profile at human/hybrid/ai_native gradients.
Reports MAPE, MMRE, PRED(25), PRED(50), bias per model, with breakdowns by dataset and project type.
Use cocomo_validate for a quicker Basic COCOMO-only validation pass.`,
    cocomoGroundTruthSchema,
    { type: "object", properties: { projectsEvaluated: { type: "number" }, models: { type: "array" }, winner: { type: "string" }, conclusion: { type: "string" }, humanReadable: { type: "string" } } },
    (input) => {
      const p = cocomoGroundTruthSchema.parse(input);
      return cocomoValidateGroundTruth({
        datasetFilter: p.dataset_filter
      });
    }
  ),
  // -- Feedback tools (4) ----------------------------------------------------
  tool(
    "record_actual",
    `Submit actual hours for a previous estimate to improve future accuracy.

Pairs with any estimation tool. The estimate_id comes from the estimate response.
Actuals feed into the self-improvement loop \u2014 after enough samples, correction factors
update automatically to reduce estimation bias.`,
    recordActualSchema,
    { type: "object", properties: { recorded: { type: "boolean" }, message: { type: "string" }, flagged: { type: "string", enum: ["unit_suspect"], description: "Present when the actual is >10x the estimate \u2014 suspected unit mismatch; verify hours vs days/weeks/person-months." }, flagHint: { type: "string", description: "Actionable hint accompanying a flagged record." } } },
    (input) => {
      const p = recordActualSchema.parse(input);
      const result = recordActualDetailed(p.estimate_id, p.actual_hours, p.notes, p.unit, p.calibration_provenance);
      if (!result.ok) {
        const messages = {
          below_threshold: `Actual hours (${p.actual_hours}) must be positive.`,
          duplicate: `An actual for estimate ${p.estimate_id} already exists. Each estimate can only have one actual.`,
          write_failed: "Failed to write to feedback storage \u2014 ensure ~/.epoch/ directory is writable.",
          synthetic_id: `Estimate ID "${p.estimate_id}" looks like test/synthetic data (reserved prefix), so it cannot receive actuals. Use the feedbackRef returned by a fresh estimation-tool call.`,
          unknown_tool: `Estimate ${p.estimate_id} was recorded under an unrecognized tool name, so its actual cannot join calibration. Re-run the estimation tool and record against the new feedbackRef it returns.`,
          auto_wallclock_out_of_bounds: `Auto wall-clock actual for estimate ${p.estimate_id} failed the sanity gate (outside 0.05\u201312h or \u226510x the estimate). Record a verified actual manually via record_actual instead.`
        };
        return {
          ok: false,
          error: {
            isError: true,
            // Ticket 16 (unknown-tool policy): the lib may attach an
            // actionable hint (currently unknown_tool's canonical
            // estimation-tool set) — append it so the rejection is never a
            // silent contract severance.
            message: result.hint ? `${messages[result.reason] ?? `Failed to record actual for estimate ${p.estimate_id} (unrecognized reason: ${String(result.reason)}).`} ${result.hint}` : messages[result.reason] ?? `Failed to record actual for estimate ${p.estimate_id} (unrecognized reason: ${String(result.reason)}).`,
            retryHint: "Use the feedbackRef from a recent estimation tool call with a positive actual_hours value."
          }
        };
      }
      return {
        ok: true,
        data: {
          recorded: true,
          estimate_id: p.estimate_id,
          actual_hours: p.actual_hours,
          ...result.flagged === "unit_suspect" && {
            flagged: "unit_suspect",
            flagHint: UNIT_SUSPECT_FLAG_HINT
          },
          message: result.flagged === "unit_suspect" ? "Actual recorded, but flagged unit_suspect: the estimate and actual differ by more than 10x (either direction \u2014 the detection is symmetric) \u2014 suspected unit mismatch (check hours vs days/weeks/person-months)." : "Actual recorded. Correction factors update after more feedback accumulates."
        }
      };
    }
  ),
  tool(
    "get_pending_estimates",
    `List recent estimates that have not yet received actual-hour feedback.

Returns estimates awaiting actuals so you can submit feedback via record_actual.
Use this to close the estimation feedback loop and improve accuracy over time.`,
    getPendingEstimatesSchema,
    { type: "object", properties: { count: { type: "number" }, estimates: { type: "array", items: { type: "object", properties: { id: { type: "string" }, tool: { type: "string" }, inputs: { type: "object" }, estimatedAt: { type: "string" }, task_label: { type: "string", description: "Optional task_label carried on the estimate's inputs, if supplied at estimate time." } } } } } },
    (input) => {
      const p = getPendingEstimatesSchema.parse(input);
      const pending = getPendingEstimates(p.limit);
      const summary = pending.length > 0 ? `${pending.length} estimates awaiting actuals. Use record_actual with an estimate ID and the real hours spent to close the feedback loop.` : "No pending estimates \u2014 all recent estimates have actuals recorded.";
      return {
        ok: true,
        data: {
          count: pending.length,
          summary,
          estimates: pending.slice(-10).map((e) => {
            const taskLabel = e.inputs["task_label"];
            return {
              id: e.id,
              tool: e.tool,
              inputs: e.inputs,
              estimatedAt: e.estimatedAt,
              ...typeof taskLabel === "string" && taskLabel.length > 0 && { task_label: taskLabel }
            };
          })
        }
      };
    }
  ),
  tool(
    "batch_record_actuals",
    `Record actual hours for multiple estimates in a single call.

Efficient for bulk feedback submission \u2014 accepts 1 to 500 entries at once.
Each entry pairs an estimate ID with the actual hours spent. Returns total/succeeded/failed counts. Use when closing the feedback loop for many estimates at once; pass estimate_id values from get_pending_estimates.`,
    batchRecordActualsSchema,
    { type: "object", properties: { total: { type: "number" }, succeeded: { type: "number" }, failed: { type: "number" }, errors: { type: "array" } } },
    (input) => {
      const p = batchRecordActualsSchema.parse(input);
      const result = batchRecordActuals(p.entries.map((e) => ({
        estimateId: e.estimate_id,
        actualHours: e.actual_hours,
        notes: e.notes,
        unit: e.unit,
        calibrationProvenance: e.calibration_provenance
      })));
      if (result.succeeded === 0 && result.failed > 0) {
        const firstError = result.errors[0] ?? "no per-entry error reported";
        const anyWriteFailed = result.errors.some((e) => e.includes("write_failed"));
        return {
          ok: false,
          error: anyWriteFailed ? makeStorageError(
            `All ${result.total} entries failed to record. First failure: ${firstError}`,
            "A write_failed entry is a server-side storage failure (permissions/disk/lock) \u2014 fix the Epoch data directory, then retry the batch."
          ) : { isError: true, message: `All ${result.total} entries failed to record. First failure: ${firstError}`, retryHint: "Each entry needs the feedbackRef from a recent estimation tool call and a positive actual_hours value." }
        };
      }
      return { ok: true, data: result };
    }
  ),
  tool(
    "feedback_health",
    `Get a health report on the estimation feedback loop.

Shows total estimates, actuals, match rate, MAPE by tool and task type,
and self-improvement readiness (which types have enough data for auto-calibration). Use when checking whether you have enough recorded actuals for calibration to kick in.`,
    feedbackHealthSchema,
    { type: "object", properties: { totalEstimates: { type: "number" }, totalActuals: { type: "number" }, matchedPairs: { type: "number" }, seedRecordsFiltered: { type: "number" }, matchRate: { type: "number" }, byTool: { type: "object" }, byTaskType: { type: "object" }, selfImprovement: { type: "object" }, dataQuality: { type: "object" }, humanReadable: { type: "string" }, intervalCoverage: { type: "object", description: "P80 prediction-interval coverage calibration (Phase 5, additive). See src/lib/coverage.ts.", properties: { n: { type: "number" }, p80CoverageRate: { type: "number" }, targetP80Coverage: { type: "number" }, byTaskType: { type: "object" }, note: { type: "string" } } } } },
    () => {
      return {
        ok: true,
        data: { ...getFeedbackHealthReport(), intervalCoverage: computeIntervalCoverage() }
      };
    }
  ),
  // -- Context-driven estimation (registered Phase 3; logic lands Phase 5) --
  tool(
    "estimate_from_context",
    `Classify a free-text task description and delegate to reference-class estimation.

Classifies task_type and complexity from free text (issue body, PR/diff
description, or task summary) using a LOCAL, deterministic keyword/signal
heuristic \u2014 no LLM call (see src/lib/context-estimate.ts). Caller-supplied
task_type/complexity hints always override the classification. Delegates the
resolved inputs to the same reference-class-forecasting path used by
reference_class_estimate, and returns classification provenance
(classified_task_type, classified_complexity, confidence, signals) alongside
the estimate so callers can judge how much to trust it.`,
    estimateFromContextSchema,
    estimateFromContextOutput,
    (input) => {
      const p = estimateFromContextSchema.parse(input);
      const classification = classifyContext(p.context);
      const resolved = resolveContextEstimateInputs(classification, {
        ...p.task_type !== void 0 && { taskType: p.task_type },
        ...p.complexity !== void 0 && { complexity: p.complexity }
      });
      const records = getCalibrationData(p.team_id, resolved.taskType, 90, "estimate_from_context");
      const result = referenceClassEstimate(records, resolved.taskType, resolved.complexity, void 0, true);
      const scopeGuide = getScopeGuide(resolved.taskType);
      const lowConfidenceNote = classification.confidence === "low" && !resolved.taskTypeFromHint && !resolved.complexityFromHint ? `Classification confidence is low \u2014 no clear task-type keywords or complexity signals were found in the supplied context; defaulted to task_type="${classification.taskType}" and complexity=${classification.complexity}. Supply task_type/complexity hints for a more reliable estimate.` : void 0;
      return {
        ok: true,
        data: {
          tool: "estimate_from_context",
          ...result,
          ...scopeGuide ? { scopeGuide } : {},
          classification: {
            classified_task_type: classification.taskType,
            classified_complexity: classification.complexity,
            confidence: classification.confidence,
            signals: classification.signals,
            task_type_from_hint: resolved.taskTypeFromHint,
            complexity_from_hint: resolved.complexityFromHint
          },
          ...lowConfidenceNote ? { lowConfidenceNote } : {},
          note: records.length >= 5 ? `Based on ${records.length} historical records for "${resolved.taskType}" tasks.` : "Using reference database correction factors. Submit actuals via record_actual to improve accuracy."
        }
      };
    }
  )
]);
var TOOL_REGISTRY = new Map(
  Object.entries(handlers)
);
var TOOL_NAMES = CANONICAL_TOOL_NAMES;
var ESTIMATION_TOOLS = ESTIMATION_TOOL_NAMES;
function isEstimationTool(toolName) {
  return ESTIMATION_TOOLS.has(toolName);
}

// src/dispatcher/index.ts
async function dispatch(toolName, rawInput) {
  const definition = TOOL_REGISTRY.get(toolName);
  if (!definition) {
    const available = [...TOOL_NAMES].sort().join(", ");
    return {
      ok: false,
      error: {
        isError: true,
        message: `Unknown tool: "${toolName}".`,
        retryHint: `Available tools: ${available}`
      }
    };
  }
  const startMs = performance.now();
  try {
    const result = definition.handler(rawInput);
    const elapsedMs = performance.now() - startMs;
    const telemetry = getTelemetry();
    telemetry.record(toolName, elapsedMs, result.ok, rawInput);
    if (result.ok) {
      const data = result.data;
      if (data && typeof data === "object") {
        const d = data;
        if (isEstimationTool(toolName)) {
          const estimateId = recordEstimate(toolName, rawInput, d, resolveSource());
          if (estimateId === null) {
            notifyToolCall();
            return {
              ok: false,
              // errorKind "storage" (review M3): server-side persistence
              // failure — 500-class at the HTTP seam, message surfaced
              // verbatim (crafted safe, no paths/stack).
              error: makeStorageError(
                `Failed to write estimate to feedback storage \u2014 ensure the Epoch data directory is writable. The ${toolName} result was computed but NOT recorded.`,
                "Fix permissions/disk on the Epoch data directory and re-run the estimation tool; no feedbackRef was issued."
              )
            };
          }
          if (hasHourEstimate(d)) {
            d.feedbackRef = estimateId;
          }
        } else {
          recordToolCall(toolName, rawInput, d, resolveSource());
        }
      }
    }
    notifyToolCall();
    return result;
  } catch (err) {
    const elapsedMs = performance.now() - startMs;
    getTelemetry().record(toolName, elapsedMs, false, rawInput);
    notifyToolCall();
    if (err instanceof ZodError) {
      return {
        ok: false,
        error: makeValidationError(
          `Invalid input for ${toolName}:
${formatZodIssues(err, rawInput)}`,
          "Fix the listed input fields and retry."
        )
      };
    }
    const message = err instanceof Error ? err.message : "Unexpected handler error.";
    return {
      ok: false,
      error: makeInternalError(
        message,
        `Tool "${toolName}" failed with a server-side error \u2014 this is not an input problem. Retry, and file an issue at https://github.com/KyaniteLabs/Epoch/issues if it persists.`
      )
    };
  }
}
function resolveSource() {
  return process.env["EPOCH_SOURCE"];
}
var HOUR_FIELDS = [
  "expected",
  "totalHours",
  "estimatedHours",
  "estimatedMinutes",
  "estimatedSeconds",
  "personMonthsLlmAdjusted",
  "correctedEstimate",
  "total_duration"
];
function hasHourEstimate(data) {
  return HOUR_FIELDS.some((f) => typeof data[f] === "number");
}
function listTools() {
  return [...TOOL_REGISTRY.values()].map((def) => ({
    name: def.name,
    description: def.description
  }));
}

export {
  isInternalError,
  isStorageError,
  tokenCostEstimate,
  compareModels,
  scheduleRisk,
  TOOL_REGISTRY,
  TOOL_NAMES,
  dispatch,
  listTools
};
//# sourceMappingURL=chunk-V7N6FMO6.js.map