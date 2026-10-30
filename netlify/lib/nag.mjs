import { local, fromLocal } from "./time.mjs";

// Повтор напоминания, пока задачу не отметили: каждые nagEvery часов (1–4), выбирается кнопкой
// под напоминанием или текстом «каждые 2 часа». С 22:00 до 9:00 по Ташкенту повторы ждут утра.
export const NAG_OPTIONS = [1, 2, 3, 4];

export function nextNag(t, now) {
  const at = now + t.nagEvery * 3_600_000;
  const l = local(at);
  if (l.h >= 22) return fromLocal(l.y, l.mo, l.d + 1, 9, 0);
  if (l.h < 9) return fromLocal(l.y, l.mo, l.d, 9, 0);
  return at;
}

// Ряд кнопок: «🔁 1 ч · 2 ч · 3 ч · 4 ч» или «🔕 Не повторять», если повтор уже включён.
export const nagRow = (t) =>
  t.nagEvery
    ? [{ text: `🔕 Не повторять (сейчас каждые ${t.nagEvery} ч)`, callback_data: `stop:${t.id}` }]
    : NAG_OPTIONS.map((h) => ({ text: `🔁 ${h} ч`, callback_data: `nag:${h}:${t.id}` }));
