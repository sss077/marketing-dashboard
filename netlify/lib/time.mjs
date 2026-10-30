// Время в Ташкенте (UTC+5, без перехода на летнее время).
export const TZ_OFFSET_MIN = 5 * 60;
const SHIFT = TZ_OFFSET_MIN * 60_000;

// Местные дата и время для момента ms.
export function local(ms = Date.now()) {
  const d = new Date(ms + SHIFT);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), dow: d.getUTCDay() };
}

// Момент (ms) для местных даты и времени. Переполнение дней и месяцев допускается.
export const fromLocal = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo, d, h, mi) - SHIFT;

export const dayKey = (ms = Date.now()) => {
  const l = local(ms);
  return `${l.y}-${String(l.mo + 1).padStart(2, "0")}-${String(l.d).padStart(2, "0")}`;
};
export const monthKey = (ms = Date.now()) => dayKey(ms).slice(0, 7);

// «сегодня в 10:00», «завтра в 9:30», «пт, 7 нояб. в 12:00»
export function human(ms, now = Date.now()) {
  const t = new Date(ms + SHIFT);
  const hm = `${t.getUTCHours()}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
  const n = local(now);
  const diff = Math.round((fromLocal(...Object.values(local(ms)).slice(0, 3)) - fromLocal(n.y, n.mo, n.d)) / 864e5);
  if (diff === 0) return `сегодня в ${hm}`;
  if (diff === 1) return `завтра в ${hm}`;
  if (diff === -1) return `вчера в ${hm}`;
  const date = t.toLocaleDateString("ru-RU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", ...(t.getUTCFullYear() !== n.y ? { year: "numeric" } : {}) });
  return `${date} в ${hm}`;
}

export function humanDate(iso, now = Date.now()) {
  const [y, mo, d] = iso.split("-").map(Number);
  const n = local(now);
  const diff = Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(n.y, n.mo, n.d)) / 864e5);
  if (diff === 0) return "сегодня";
  if (diff === 1) return "завтра";
  return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString("ru-RU", { timeZone: "UTC", day: "numeric", month: "long" });
}

export const daysUntil = (iso, now = Date.now()) => {
  const [y, mo, d] = iso.split("-").map(Number);
  const n = local(now);
  return Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(n.y, n.mo, n.d)) / 864e5);
};
