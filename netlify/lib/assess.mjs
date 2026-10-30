import { local, daysUntil } from "./time.mjs";

// Тот же светофор, что на сайте (public/index.html, assess), но «сегодня» — по Ташкенту.
export function assess(p, now = Date.now()) {
  const l = local(now);
  const today = Date.UTC(l.y, l.mo, l.d);
  const tasks = Array.isArray(p.tasks) ? p.tasks : [];
  const total = tasks.length, done = tasks.filter((t) => t.done).length;
  const progress = total ? done / total : 0;
  const s = p.start ? Date.parse(p.start + "T00:00:00Z") : null;
  const d = p.deadline ? Date.parse(p.deadline + "T00:00:00Z") : null;
  const timeShare = s && d && d > s ? Math.min(1, Math.max(0, (today - s) / (d - s))) : null;
  const daysLeft = p.deadline ? daysUntil(p.deadline, now) : null;
  const budgetUse = Number(p.budget) > 0 ? (Number(p.spent) || 0) / Number(p.budget) : null;
  const red = [], yellow = [];
  if (total && done === total) return { level: "done", reasons: ["Все задачи выполнены"], daysLeft };
  if (daysLeft !== null && daysLeft < 0) red.push(`Дедлайн прошёл ${-daysLeft} дн. назад`);
  if (budgetUse !== null && budgetUse > 1.1) red.push(`Перерасход: потрачено ${Math.round(budgetUse * 100)}% бюджета`);
  const lag = timeShare !== null && total ? timeShare - progress : null;
  if (lag !== null && lag > 0.25) red.push(`Отставание на ${Math.round(lag * 100)} п.п.`);
  else if (lag !== null && lag > 0.1) yellow.push(`Отставание на ${Math.round(lag * 100)} п.п.`);
  if (budgetUse !== null && budgetUse > 0.9 && budgetUse <= 1.1 && progress < 0.8) yellow.push(`Потрачено ${Math.round(budgetUse * 100)}% бюджета`);
  if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 7 && progress < 0.9) yellow.push(`До дедлайна ${daysLeft} дн.`);
  if (!total) yellow.push("Не расписан объём работ");
  const auto = red.length ? "red" : yellow.length ? "yellow" : "green";
  const level = p.manual && ["red", "yellow", "green"].includes(p.manual) ? p.manual : auto;
  return { level, reasons: red.length ? red : yellow, daysLeft };
}
