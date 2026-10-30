import { local, fromLocal } from "./time.mjs";

// Разбор задачи на русском: «завтра в 10 позвонить автошколе», «через 2 часа отправить отчёт»,
// «каждый понедельник в 9 планёрка». Возвращает { text, due, repeat }:
// due — момент напоминания (ms) или null, repeat — правило повтора или null.

const WEEKDAYS = [
  [/^воскресень/, 0], [/^вс$/, 0], [/^понедельник/, 1], [/^пн$/, 1], [/^вторник/, 2], [/^вт$/, 2],
  [/^сред/, 3], [/^ср$/, 3], [/^четверг/, 4], [/^чт$/, 4], [/^пятниц/, 5], [/^пт$/, 5], [/^суббот/, 6], [/^сб$/, 6],
];
const WD = "(воскресенье|понедельник|вторник|среду|среда|четверг|пятницу|пятница|субботу|суббота|вс|пн|вт|ср|чт|пт|сб)";
const MONTHS = ["январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];
const MONTH_RE = "(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)";
const B = "(?<![\\p{L}\\d])"; // начало слова
const E = "(?![\\p{L}\\d])"; // конец слова

const dowOf = (w) => WEEKDAYS.find(([re]) => re.test(w))?.[1];
const monthOf = (w) => (w.startsWith("ма") && !w.startsWith("март") ? 4 : MONTHS.findIndex((m) => w.startsWith(m)));

export function nextRepeat(repeat, fromMs) {
  // Ближайший момент строго после fromMs по правилу повтора.
  const { h, mi } = repeat;
  const l = local(fromMs);
  for (let i = 0; i <= 62; i++) {
    const t = fromLocal(l.y, l.mo, l.d + i, h, mi);
    if (t <= fromMs) continue;
    const ld = local(t);
    if (repeat.kind === "daily") return t;
    if (repeat.kind === "weekdays" && ld.dow >= 1 && ld.dow <= 5) return t;
    if (repeat.kind === "weekly" && ld.dow === repeat.dow) return t;
    if (repeat.kind === "monthly" && ld.d === Math.min(repeat.day, new Date(Date.UTC(ld.y, ld.mo + 1, 0)).getUTCDate())) return t;
  }
  return null;
}

export function repeatLabel(r) {
  if (!r) return "";
  const hm = `${r.h}:${String(r.mi).padStart(2, "0")}`;
  if (r.kind === "daily") return `каждый день в ${hm}`;
  if (r.kind === "weekdays") return `по будням в ${hm}`;
  if (r.kind === "weekly") return `каждую неделю, ${["вс", "пн", "вт", "ср", "чт", "пт", "сб"][r.dow]} в ${hm}`;
  if (r.kind === "monthly") return `каждый месяц ${r.day}-го в ${hm}`;
  return "";
}

export function parse(input, now = Date.now()) {
  let s = ` ${String(input).replace(/\s+/g, " ").trim()} `;
  let low = s.toLowerCase().replace(/ё/g, "е");
  const take = (re) => {
    const m = new RegExp(re, "u").exec(low);
    if (!m) return null;
    const i = m.index, j = i + m[0].length;
    s = s.slice(0, i) + " ".repeat(j - i) + s.slice(j);
    low = low.slice(0, i) + " ".repeat(j - i) + low.slice(j);
    return m;
  };
  const n = local(now);
  let day = null; // {y, mo, d}
  let time = null; // {h, mi}
  let repeat = null;
  let rel = null; // ms

  // Относительное время: «через 2 часа», «через полчаса», «через 3 дня», «через неделю»
  let m = take(`${B}через\\s+(\\d+|полчаса|пол часа)?\\s*(минуту|минуты|минут|мин|часа|часов|час|ч|дня|дней|день|недели|недель|неделю)?${E}`);
  if (m) {
    const num = m[1] === "полчаса" || m[1] === "пол часа" ? 30 : Number(m[1] || 1);
    const unit = m[2] || (m[1] && /пол/.test(m[1]) ? "мин" : "");
    if (/^мин/.test(unit) || /пол/.test(m[1] || "")) rel = now + num * 60_000;
    else if (/^ч/.test(unit)) rel = now + num * 3_600_000;
    else if (/^(дн|день)/.test(unit)) day = { y: n.y, mo: n.mo, d: n.d + num };
    else if (/^недел/.test(unit)) day = { y: n.y, mo: n.mo, d: n.d + 7 * num };
  }

  // Повторы
  if (take(`${B}(каждый день|ежедневно|каждое утро|каждый вечер)${E}`)) repeat = { kind: "daily" };
  else if (take(`${B}(по будням|каждый будний день|в будни)${E}`)) repeat = { kind: "weekdays" };
  else if ((m = take(`${B}(?:каждый|каждую|каждое|по)\\s+${WD}${E}`)) ) repeat = { kind: "weekly", dow: dowOf(m[1]) };
  else if ((m = take(`${B}(?:каждое|каждого)\\s+(\\d{1,2})(?:-?е|-?го)?\\s*(?:число|числа)?${E}`)) || (m = take(`${B}каждый месяц(?:\\s+(\\d{1,2})(?:-?го)?\\s*(?:числа)?)?${E}`))) {
    repeat = { kind: "monthly", day: Number(m[1] || n.d) };
  } else if (take(`${B}каждую неделю${E}`)) repeat = { kind: "weekly", dow: n.dow };

  // День
  if (!day && !rel) {
    if (take(`${B}послезавтра${E}`)) day = { y: n.y, mo: n.mo, d: n.d + 2 };
    else if (take(`${B}завтра${E}`)) day = { y: n.y, mo: n.mo, d: n.d + 1 };
    else if (take(`${B}сегодня${E}`)) day = { y: n.y, mo: n.mo, d: n.d };
    else if ((m = take(`${B}(\\d{1,2})\\s+${MONTH_RE}(?:\\s+(\\d{4}))?${E}`))) {
      day = { y: m[3] ? Number(m[3]) : n.y, mo: monthOf(m[2]), d: Number(m[1]), fixed: !!m[3], date: true };
    } else if ((m = take(`${B}(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{2,4}))?${E}`))) {
      const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : n.y;
      day = { y, mo: Number(m[2]) - 1, d: Number(m[1]), fixed: !!m[3], date: true };
    } else if (!repeat && (m = take(`${B}(?:во|в|на|к)?\\s*${WD}${E}`))) {
      const dow = dowOf(m[1]);
      day = { y: n.y, mo: n.mo, d: n.d + ((dow - n.dow + 7) % 7), weekday: true };
    }
  }

  // Время
  if (!rel) {
    if ((m = take(`${B}(?:в|к|на)\\s+(\\d{1,2})(?:[:.](\\d{2}))?(?:\\s*(?:ч|час|часа|часов))?(?:\\s+(утра|вечера|дня|ночи))?${E}`)) || (m = take(`${B}(\\d{1,2}):(\\d{2})(?:\\s+(утра|вечера|дня|ночи))?${E}`))) {
      let h = Number(m[1]);
      const mi = Number(m[2] || 0);
      if ((m[3] === "вечера" || m[3] === "дня") && h < 12) h += 12;
      if (m[3] === "ночи" && h === 12) h = 0;
      if (h <= 23 && mi <= 59) time = { h, mi };
    } else if (take(`${B}(утром|с утра)${E}`)) time = { h: 9, mi: 0 };
    else if (take(`${B}(днем|днём|в обед)${E}`)) time = { h: 13, mi: 0 };
    else if (take(`${B}вечером${E}`)) time = { h: 19, mi: 0 };
  }

  let due = null;
  if (rel) due = rel;
  else if (repeat) {
    repeat = { ...repeat, ...(time || { h: 9, mi: 0 }) };
    due = nextRepeat(repeat, now - 1);
  } else if (day || time) {
    const t = time || { h: 9, mi: 0 };
    const d = day || { y: n.y, mo: n.mo, d: n.d };
    due = fromLocal(d.y, d.mo, d.d, t.h, t.mi);
    if (due <= now) {
      if (!day) due = fromLocal(d.y, d.mo, d.d + 1, t.h, t.mi); // только время, и оно прошло — завтра
      else if (d.weekday) due = fromLocal(d.y, d.mo, d.d + 7, t.h, t.mi); // «в пятницу», а сегодня пятница и время прошло — следующая
      else if (d.date && !d.fixed && fromLocal(d.y, d.mo, d.d) < fromLocal(n.y, n.mo, n.d)) due = fromLocal(d.y + 1, d.mo, d.d, t.h, t.mi); // «5 марта» в октябре — следующий год
    }
  }

  const text = s.replace(/\s+/g, " ").replace(/^[\s,.:;—–-]+|[\s,.:;—–-]+$/g, "").trim();
  return { text: text ? text[0].toUpperCase() + text.slice(1) : String(input).trim(), due, repeat };
}
