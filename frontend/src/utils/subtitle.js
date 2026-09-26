// Shared subtitle helpers: timestamps, QC rules, languages, film profiles.

export const LANGUAGES = {
  auto: 'Tự động nhận diện',
  vi: 'Tiếng Việt',
  en: 'Tiếng Anh',
  'zh-cn': 'Trung (Giản thể)',
  'zh-tw': 'Trung (Phồn thể)',
  ko: 'Tiếng Hàn',
  ja: 'Tiếng Nhật',
  th: 'Tiếng Thái',
  fr: 'Tiếng Pháp',
  de: 'Tiếng Đức',
  es: 'Tiếng Tây Ban Nha',
  id: 'Tiếng Indonesia',
};

export const TARGET_LANGUAGES = Object.fromEntries(
  Object.entries(LANGUAGES).filter(([code]) => code !== 'auto')
);

export const STATUS_INFO = {
  untranslated: { label: 'Chưa dịch', short: 'Chưa dịch', cls: 'bg-red-50 text-red-600 border-red-200' },
  machine: { label: 'Máy dịch', short: 'Máy', cls: 'bg-blue-50 text-blue-600 border-blue-200' },
  edited: { label: 'Đã sửa', short: 'Đã sửa', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  reviewed: { label: 'Đã duyệt', short: 'Duyệt', cls: 'bg-green-50 text-green-700 border-green-200' },
};

// ── Timestamps ───────────────────────────────────────────────────────────────

// Supports SRT "00:00:01,000", VTT "00:00:01.000" / "00:01.000", ASS "0:00:01.00"
export function parseTimestamp(ts) {
  if (!ts) return null;
  const m = String(ts).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/);
  if (!m) return null;
  const frac = m[4].padEnd(3, '0');
  return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+frac) / 1000;
}

export function formatTime(seconds) {
  if (seconds == null || !isFinite(seconds)) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// "00:12:30", "12:30" or "750" (seconds) → seconds
export function parseJumpTime(text) {
  const t = text.trim();
  if (/^\d+$/.test(t)) return null;
  const parts = t.split(':').map(Number);
  if (parts.some((p) => Number.isNaN(p)) || parts.length < 2 || parts.length > 3) return null;
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}

// Index into `timed` (sorted by start) of the line showing at `time`, or -1
export function findActiveLine(timed, time) {
  let lo = 0;
  let hi = timed.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timed[mid].start <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found >= 0 && timed[found].end != null && time > timed[found].end) return -1;
  return found;
}

// ── QC (Netflix-style) ───────────────────────────────────────────────────────

export const QC_MAX_CPS = 20;
export const QC_MAX_LINE_LEN = 42;
export const QC_MIN_DURATION = 1.0;
export const QC_MAX_DURATION = 7.0;

export function entryDuration(entry) {
  const start = parseTimestamp(entry.start_time);
  const end = parseTimestamp(entry.end_time);
  return start != null && end != null ? end - start : null;
}

export function textMetrics(text, duration) {
  const clean = (text || '').replace(/\n/g, '');
  const maxLine = Math.max(0, ...(text || '').split('\n').map((l) => l.length));
  const cps = duration && duration > 0 ? clean.length / duration : null;
  return { chars: clean.length, maxLine, cps };
}

export function computeQc(entry) {
  const issues = [];
  const text = entry.translated_text || '';
  if (!text) return issues;

  const duration = entryDuration(entry);
  const { cps, maxLine } = textMetrics(text, duration);
  if (cps != null && cps > QC_MAX_CPS) {
    issues.push({ code: 'cps', label: `${cps.toFixed(0)} ký tự/giây — đọc không kịp (>${QC_MAX_CPS})` });
  }
  if (duration != null && duration > 0) {
    if (duration < QC_MIN_DURATION) issues.push({ code: 'flash', label: `Hiện ${duration.toFixed(1)}s — quá ngắn` });
    else if (duration > QC_MAX_DURATION) issues.push({ code: 'linger', label: `Hiện ${duration.toFixed(1)}s — quá lâu` });
  }
  if (maxLine > QC_MAX_LINE_LEN) {
    issues.push({ code: 'long', label: `Dòng ${maxLine} ký tự (>${QC_MAX_LINE_LEN})` });
  }
  return issues;
}

// True when the source line had tags in the middle that can't be carried over
export function hasInlineTags(entry) {
  if (!entry.raw_text) return false;
  let body = entry.raw_text.trim();
  if (entry.prefix && body.startsWith(entry.prefix)) body = body.slice(entry.prefix.length);
  if (entry.suffix && body.endsWith(entry.suffix)) body = body.slice(0, -entry.suffix.length);
  return /\{[^}]*\}|<\/?\w+[^>]*>/.test(body);
}

// ── Film profiles (localStorage) ─────────────────────────────────────────────

const PROFILES_KEY = 'subtranslator_film_profiles';

export function loadProfiles() {
  try {
    return JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveProfiles(profiles) {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  } catch {
    // storage unavailable — profiles just won't persist
  }
}

export function parseGlossary(text) {
  if (!text || !text.trim()) return null;
  const glossary = {};
  text.split('\n').forEach((line) => {
    const eq = line.indexOf('=');
    if (eq > 0) {
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim();
      if (key && value) glossary[key] = value;
    }
  });
  return Object.keys(glossary).length ? glossary : null;
}

export function glossaryToText(glossary) {
  if (!glossary) return '';
  return Object.entries(glossary).map(([k, v]) => `${k} = ${v}`).join('\n');
}

export function countStatuses(entries) {
  const counts = { total: entries.length, untranslated: 0, machine: 0, edited: 0, reviewed: 0 };
  for (const e of entries) counts[e.status || (e.translated_text ? 'machine' : 'untranslated')] += 1;
  return counts;
}

const LAST_PROJECT_KEY = 'subtranslator_last_project';

export function getLastProjectId() {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    return null;
  }
}

export function setLastProjectId(id) {
  try {
    if (id) localStorage.setItem(LAST_PROJECT_KEY, id);
    else localStorage.removeItem(LAST_PROJECT_KEY);
  } catch {
    // ignore
  }
}
