import { send, tg, botToken } from "../lib/tg.mjs";
import { nextNag, nagRow } from "../lib/nag.mjs";
import { listTasks, saveTask, taskStore, botStore, loadTeam, taskChat } from "../lib/tasks.mjs";
import { nextRepeat, repeatLabel } from "../lib/parse.mjs";
import { local, dayKey, monthKey } from "../lib/time.mjs";
import { digest, debtsMessage, loadProjects } from "../lib/digest.mjs";
import { assess } from "../lib/assess.mjs";

// Запускается Netlify каждую минуту: напоминания о задачах (и повторы каждые 1–4 часа, если их включили),
// утренняя сводка в 9:00, сообщение, когда проект стал красным, и долги клиентов 1-го числа в 10:00 (время Ташкента).

const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const buttons = (t) => [
  [{ text: "✅ Сделано", callback_data: `done:${t.id}` }],
  [{ text: "⏰ Через час", callback_data: `snz:${t.id}` }, { text: "📅 Завтра в 9", callback_data: `tmr:${t.id}` }],
  nagRow(t),
];

async function remind(chat, t, now, again) {
  if (t.nag?.msg) await tg("deleteMessage", { chat_id: chat, message_id: t.nag.msg });
  const count = again ? (t.nag?.count || 1) + 1 : 1;
  const head = again ? `🔔 Напоминаю ещё раз${count > 2 ? ` (${count}-й раз)` : ""}` : "🔔";
  const tail = t.nagEvery ? `\nПовторю через ${t.nagEvery} ч, если не отметите.` : "\nПовторять, пока не сделано? Выберите интервал:";
  const r = await send(chat, `${head} <b>${esc(t.text)}</b>${t.repeat ? `\n🔁 ${repeatLabel(t.repeat)}` : ""}${tail}`, buttons(t));
  if (!r.ok) return false;
  t.nag = { at: t.nagEvery ? nextNag(t, now) : null, count, msg: r.result?.message_id };
  return true;
}

export default async () => {
  if (!botToken()) return;
  const meta = botStore();
  const owner = await meta.get("owner", { type: "json" });
  if (!owner) return;
  const now = Date.now();
  const tasks = await listTasks();
  const team = await loadTeam();
  // Кому писать: владелец и сотрудники. Задачи убранных сотрудников молчат.
  const people = [owner.chat, ...Object.keys(team.members || {}).map(Number)];

  for (const t of tasks) {
    if (t.done && t.doneAt && now - t.doneAt > 30 * 864e5) { await taskStore().delete(t.id); continue; }
    if (t.done) continue;
    const chat = taskChat(t, owner);
    if (!people.includes(chat)) continue;
    if (t.due && t.due <= now && t.notifiedFor !== t.due) {
      // Подошло время напоминания
      if (!(await remind(chat, t, now, false))) continue;
      t.notifiedFor = t.due;
      if (t.repeat) t.due = nextRepeat(t.repeat, now);
      await saveTask(t);
    } else if (t.nag?.at && t.nag.at <= now) {
      // Включён повтор, а задачу ещё не отметили — повторяем
      if (await remind(chat, t, now, true)) await saveTask(t);
    }
  }

  const l = local(now);
  const state = (await meta.get("state", { type: "json" })) || {};
  let changed = false;

  if (l.h >= 9) {
    state.digests = state.digests || {};
    if (state.digest === dayKey(now)) state.digests[owner.chat] = state.digest; // со старой версии
    for (const chat of people) {
      if (state.digests[chat] === dayKey(now)) continue;
      const teamView = chat === owner.chat ? Object.entries(team.members || {}).map(([id, m]) => ({ name: m.name, tasks: tasks.filter((t) => String(taskChat(t, owner)) === id) })) : null;
      await send(chat, await digest(tasks.filter((t) => taskChat(t, owner) === chat), now, teamView));
      state.digests[chat] = dayKey(now); changed = true;
    }
  }

  if (l.mi % 10 === 0 || !state.levels) {
    const levels = {};
    for (const p of await loadProjects()) {
      if (p.example) continue;
      const a = assess(p, now);
      levels[p.id] = a.level;
      if (state.levels && a.level === "red" && state.levels[p.id] !== "red") {
        for (const chat of people) await send(chat, `🔴 <b>${esc(p.name)}</b> стал красным\n${a.reasons.map(esc).join("\n")}`);
      }
    }
    state.levels = levels; changed = true;
  }

  if (l.d === 1 && l.h >= 10 && state.debts !== monthKey(now)) {
    const msg = await debtsMessage(now);
    if (msg) await send(owner.chat, msg);
    state.debts = monthKey(now); changed = true;
  }

  if (changed) await meta.setJSON("state", state);
};

export const config = { schedule: "* * * * *" };
