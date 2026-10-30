import { send, botToken } from "../lib/tg.mjs";
import { listTasks, saveTask, taskStore, botStore } from "../lib/tasks.mjs";
import { nextRepeat, repeatLabel } from "../lib/parse.mjs";
import { local, dayKey, monthKey } from "../lib/time.mjs";
import { digest, debtsMessage, loadProjects } from "../lib/digest.mjs";
import { assess } from "../lib/assess.mjs";

// Запускается Netlify каждую минуту: напоминания о задачах, утренняя сводка в 9:00,
// сообщение, когда проект стал красным, и долги клиентов 1-го числа в 10:00 (время Ташкента).

const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const buttons = (id) => [
  [{ text: "✅ Сделано", callback_data: `done:${id}` }],
  [{ text: "⏰ Через час", callback_data: `snz:${id}` }, { text: "📅 Завтра в 9", callback_data: `tmr:${id}` }],
];

export default async () => {
  if (!botToken()) return;
  const meta = botStore();
  const owner = await meta.get("owner", { type: "json" });
  if (!owner) return;
  const now = Date.now();
  const tasks = await listTasks();

  for (const t of tasks) {
    if (t.done && t.doneAt && now - t.doneAt > 30 * 864e5) { await taskStore().delete(t.id); continue; }
    if (t.done || !t.due || t.due > now || t.notifiedFor === t.due) continue;
    const r = await send(owner.chat, `🔔 <b>${esc(t.text)}</b>${t.repeat ? `\n🔁 ${repeatLabel(t.repeat)}` : ""}`, buttons(t.id));
    if (!r.ok) continue;
    t.notifiedFor = t.due;
    if (t.repeat) t.due = nextRepeat(t.repeat, now);
    await saveTask(t);
  }

  const l = local(now);
  const state = (await meta.get("state", { type: "json" })) || {};
  let changed = false;

  if (l.h >= 9 && state.digest !== dayKey(now)) {
    await send(owner.chat, await digest(tasks, now));
    state.digest = dayKey(now); changed = true;
  }

  if (l.mi % 10 === 0 || !state.levels) {
    const levels = {};
    for (const p of await loadProjects()) {
      if (p.example) continue;
      const a = assess(p, now);
      levels[p.id] = a.level;
      if (state.levels && a.level === "red" && state.levels[p.id] !== "red") {
        await send(owner.chat, `🔴 <b>${esc(p.name)}</b> стал красным\n${a.reasons.map(esc).join("\n")}`);
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
