import { getStore } from "@netlify/blobs";
import { esc } from "./tg.mjs";
import { local, fromLocal, human, monthKey } from "./time.mjs";
import { assess } from "./assess.mjs";
import { debts } from "./money.mjs";

const WEEKDAY = ["воскресенье", "понедельник", "вторник", "среду", "четверг", "пятницу", "субботу"];
const usd = (v) => "$" + new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(v);
const monthName = (m) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("ru-RU", { timeZone: "UTC", month: "long" });
};

async function all(name) {
  const store = getStore({ name, consistency: "strong" });
  const { blobs } = await store.list();
  const rows = await Promise.all(blobs.map(async ({ key }) => ({ ...(await store.get(key, { type: "json" })), id: key })));
  return rows.filter((r) => r && Object.keys(r).length > 1);
}
export const loadProjects = () => all("projects");
export const loadFinance = () => all("finance");

// Утренняя сводка: задачи на сегодня и просроченные, дедлайны проектов (сегодня, завтра, через 3 дня, просрочены), красные проекты.
export async function digest(tasks, now = Date.now()) {
  const l = local(now);
  const endToday = fromLocal(l.y, l.mo, l.d + 1);
  const open = tasks.filter((t) => !t.done && t.due).sort((a, b) => a.due - b.due);
  const overdue = open.filter((t) => t.due < now);
  const today = open.filter((t) => t.due >= now && t.due < endToday);
  const projects = (await loadProjects()).filter((p) => !p.example).map((p) => ({ p, a: assess(p, now) }));
  const deadlines = projects.filter(({ a }) => a.level !== "done" && a.daysLeft !== null && (a.daysLeft < 0 || [0, 1, 3].includes(a.daysLeft)))
    .sort((x, y) => x.a.daysLeft - y.a.daysLeft);
  const red = projects.filter(({ a }) => a.level === "red");

  const dateStr = new Date(Date.UTC(l.y, l.mo, l.d)).toLocaleDateString("ru-RU", { timeZone: "UTC", day: "numeric", month: "long" });
  const out = [`☀️ <b>План на ${WEEKDAY[l.dow]}, ${dateStr}</b>`];
  if (overdue.length) out.push("⚠️ <b>Просрочено</b>\n" + overdue.map((t) => `• ${esc(t.text)} — <i>${human(t.due, now)}</i>`).join("\n"));
  if (today.length) out.push("📅 <b>Сегодня</b>\n" + today.map((t) => `• ${esc(t.text)} — <i>${human(t.due, now).replace("сегодня в ", "")}</i>`).join("\n"));
  if (deadlines.length) {
    out.push("⏳ <b>Дедлайны проектов</b>\n" + deadlines.map(({ p, a }) => {
      const d = a.daysLeft;
      const when = d < 0 ? `просрочен на ${-d} дн.` : d === 0 ? "сегодня" : d === 1 ? "завтра" : `через ${d} дня`;
      return `• ${esc(p.name)} — <b>${when}</b>`;
    }).join("\n"));
  }
  if (red.length) out.push("🔴 <b>Красные проекты</b>\n" + red.map(({ p, a }) => `• ${esc(p.name)} — ${esc(a.reasons[0] || "")}`).join("\n"));
  if (out.length === 1) out.push("Задач и срочных дедлайнов на сегодня нет. Хорошего дня!");
  return out.join("\n\n");
}

// Сообщение 1-го числа: долги за прошлые месяцы и кого ждём в этом месяце.
export async function debtsMessage(now = Date.now()) {
  const cur = monthKey(now);
  const { owed, expected } = debts(await loadFinance(), cur);
  if (!owed.length && !expected.length) return null;
  const out = [`💰 <b>Оплаты на ${monthName(cur)}</b>`];
  if (owed.length) {
    const total = owed.reduce((a, x) => a + x.rest, 0);
    out.push("<b>Долги за прошлые месяцы</b>\n" + owed.map((x) => `• ${esc(x.name)} — ${monthName(x.month)}: <b>${usd(x.rest)}</b>`).join("\n") + `\nИтого долгов: <b>${usd(total)}</b>`);
  }
  if (expected.length) {
    const total = expected.reduce((a, x) => a + x.rest, 0);
    out.push("<b>Ждём в этом месяце</b>\n" + expected.map((x) => `• ${esc(x.name)} — ${usd(x.rest)}`).join("\n") + `\nВсего: <b>${usd(total)}</b>`);
  }
  out.push("Отмечайте оплаты в разделе «Финансы» на сайте.");
  return out.join("\n\n");
}
