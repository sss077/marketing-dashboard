import { tg, send, botToken, hookSecret } from "../lib/tg.mjs";
import { parse, nextRepeat, repeatLabel } from "../lib/parse.mjs";
import { human, local, fromLocal } from "../lib/time.mjs";
import { listTasks, saveTask, taskStore, botStore, newId } from "../lib/tasks.mjs";
import { digest } from "../lib/digest.mjs";
import { nextNag, nagRow } from "../lib/nag.mjs";

// Telegram-бот DDL V.
// GET  /api/telegram/check — проверить токен из переменной окружения TELEGRAM_BOT_TOKEN (сам токен не выводится).
// GET  /api/telegram/setup — подключить бота к сайту (webhook) и задать команды.
// POST /api/telegram/hook  — сюда Telegram присылает сообщения и нажатия кнопок.

const page = (title, lines, ok) =>
  new Response(
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>body{font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:24px 16px;background:#f3f5f7;color:#17202a}
main{max-width:520px;margin:auto;background:#fff;border:1px solid #dde3e9;border-radius:12px;padding:20px}
h1{font-size:20px;margin:0 0 12px;color:${ok ? "#1f9a55" : "#d33b2c"}}p{margin:8px 0}code{background:#eef1f4;padding:1px 6px;border-radius:4px}
@media (prefers-color-scheme:dark){body{background:#11161b;color:#e8edf2}main{background:#182029;border-color:#2a3541}code{background:#26313c}}</style>
</head><body><main><h1>${title}</h1>${lines.map((l) => `<p>${l}</p>`).join("")}</main></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function check() {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) {
    return page("Токен не найден", [
      "В настройках Netlify нет переменной <code>TELEGRAM_BOT_TOKEN</code>.",
      "Добавьте её: Project configuration → Environment variables → Add a variable. Имя: <code>TELEGRAM_BOT_TOKEN</code>, значение: токен от @BotFather.",
      "После этого нажмите Deploys → Trigger deploy → Deploy site, чтобы сайт увидел новую переменную, и откройте эту страницу снова.",
    ], false);
  }
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) {
    return page("Токен выглядит неправильно", [
      "Переменная <code>TELEGRAM_BOT_TOKEN</code> есть, но не похожа на токен Telegram. Он выглядит так: <code>123456789:AA…</code> (цифры, двоеточие, буквы).",
      "Проверьте, что скопировали токен целиком, без пробелов и кавычек.",
    ], false);
  }
  let me;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    me = await r.json();
  } catch {
    return page("Не удалось связаться с Telegram", ["Попробуйте открыть страницу ещё раз через минуту."], false);
  }
  if (!me.ok) {
    return page("Telegram не принял токен", [
      "Скорее всего, токен устарел или скопирован с ошибкой.",
      "Получите токен заново: @BotFather → <code>/mybots</code> → ваш бот → API Token. Замените значение переменной в Netlify и перезапустите публикацию.",
    ], false);
  }
  let hook = null;
  try {
    hook = await (await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`)).json();
  } catch {}
  const url = hook?.result?.url;
  return page("Токен работает ✅", [
    `Бот: <b>${esc(me.result.first_name)}</b> (@${esc(me.result.username)})`,
    url ? `Бот уже подключён к адресу: <code>${esc(url)}</code>` : "Бот пока ни к чему не подключён. Это нормально: подключим, когда будет готова тудушка.",
    "Токен на этой странице не показывается и никуда не сохраняется.",
  ], true);
}

const HELP = [
  "Пишите задачи обычным текстом, я сам пойму, когда напомнить:",
  "",
  "• <i>завтра в 10 позвонить автошколе</i>",
  "• <i>через 2 часа проверить кампанию</i>",
  "• <i>в пятницу в 15:00 отчёт клиенту</i>",
  "• <i>5 ноября в 12 встреча</i>",
  "• <i>каждый понедельник в 9 планёрка</i>",
  "• <i>по будням в 10 проверить заявки</i>",
  "• <i>купить домен</i> (без времени — просто в список)",
  "",
  "🔁 Чтобы я повторял напоминание, пока не нажмёте «Сделано», выберите под ним «1 ч · 2 ч · 3 ч · 4 ч» или напишите: <i>каждые 2 часа выпить воды</i>. Ночью, с 22:00 до 9:00, повторы ждут утра.",
  "",
  "Команды:",
  "/list — все задачи",
  "/today — на сегодня и просроченные",
  "/digest — утренняя сводка прямо сейчас",
  "",
  "Каждое утро в 9:00 — сводка: задачи на день, дедлайны проектов и красные проекты. 1-го числа — долги клиентов.",
].join("\n");

const ok = () => new Response("ok");
const short = (s, n = 32) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function taskLine(t, now) {
  const when = t.due ? (t.due < now ? "⚠️ " : "") + human(t.due, now) : "без срока";
  return `• ${esc(t.text)} — <i>${when}</i>${t.repeat ? " 🔁" : ""}${t.nagEvery ? ` (повтор каждые ${t.nagEvery} ч)` : ""}`;
}

export function listMessage(tasks, mode, now = Date.now()) {
  const open = tasks.filter((t) => !t.done).sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity));
  const l = local(now);
  const endToday = fromLocal(l.y, l.mo, l.d + 1);
  const endTomorrow = fromLocal(l.y, l.mo, l.d + 2);
  const groups = [
    ["⚠️ Просрочено", open.filter((t) => t.due && t.due < now)],
    ["📅 Сегодня", open.filter((t) => t.due && t.due >= now && t.due < endToday)],
  ];
  if (mode !== "today") {
    groups.push(["Завтра", open.filter((t) => t.due && t.due >= endToday && t.due < endTomorrow)]);
    groups.push(["Позже", open.filter((t) => t.due && t.due >= endTomorrow)]);
    groups.push(["Без срока", open.filter((t) => !t.due)]);
  }
  const shown = [];
  const parts = [];
  for (const [title, list] of groups) {
    if (!list.length) continue;
    parts.push(`<b>${title}</b>\n` + list.map((t) => taskLine(t, now)).join("\n"));
    shown.push(...list);
  }
  if (!parts.length) {
    return { text: mode === "today" ? "На сегодня задач нет 🎉" : "Задач нет. Напишите мне, что нужно сделать.", buttons: null };
  }
  const buttons = shown.slice(0, 20).map((t) => [{ text: "✅ " + short(t.text), callback_data: `ldone:${mode === "today" ? "t" : "a"}:${t.id}` }]);
  const more = shown.length > 20 ? `\n\nКнопки показаны для первых 20 из ${shown.length}.` : "";
  return { text: parts.join("\n\n") + "\n\nНажмите на задачу, чтобы отметить её сделанной." + more, buttons };
}

async function createTask(chat, text) {
  const now = Date.now();
  const p = parse(text, now);
  const t = { id: newId(), text: p.text, due: p.due, repeat: p.repeat, nagEvery: p.nagEvery, done: false, createdAt: now, src: "tg" };
  await saveTask(t);
  const lines = [`✅ Записал: <b>${esc(t.text)}</b>`];
  if (t.repeat) lines.push(`🔁 ${repeatLabel(t.repeat)}`, `⏰ Первое напоминание: ${human(t.due, now)}`);
  else if (t.due && t.due <= now + 30_000) lines.push(t.nagEvery ? "⏰ Первое напоминание — прямо сейчас." : "⏰ Это время уже прошло, напомню прямо сейчас.");
  else if (t.due) lines.push(`⏰ Напомню ${human(t.due, now)}`);
  else lines.push("Без напоминания. Чтобы я напомнил, добавьте время: «завтра в 10 …» или нажмите кнопку.");
  if (t.nagEvery) lines.push(`🔁 Буду повторять каждые ${t.nagEvery} ч, пока не нажмёте «Сделано».`);
  else if (t.due) lines.push("Повторять напоминание, пока не сделано? Выберите интервал:");
  const buttons = t.due
    ? [nagRow(t), [{ text: "↩️ Отменить", callback_data: `del:${t.id}` }]]
    : [[{ text: "⏰ Через час", callback_data: `snz:${t.id}` }, { text: "📅 Завтра в 9", callback_data: `tmr:${t.id}` }], [{ text: "↩️ Отменить", callback_data: `del:${t.id}` }]];
  await send(chat, lines.join("\n"), buttons);
}

async function onMessage(msg, owner) {
  const chat = msg.chat.id;
  const text = (msg.text || "").trim();
  if (msg.chat.type !== "private") return;
  const meta = botStore();
  if (!owner) {
    if (/^\/start/.test(text)) {
      await meta.setJSON("owner", { chat, name: msg.from?.first_name || "", at: Date.now() });
      await send(chat, `Привет${msg.from?.first_name ? ", " + esc(msg.from.first_name) : ""}! Теперь я ваш личный бот DDL V и отвечаю только вам.\n\n` + HELP);
    } else await send(chat, "Нажмите /start, чтобы начать.");
    return;
  }
  if (owner.chat !== chat) {
    await send(chat, "Это личный бот, он отвечает только своему владельцу.");
    return;
  }
  if (!text) return send(chat, "Я понимаю только текст. Напишите задачу, например: «завтра в 10 позвонить клиенту».");
  if (/^\/(start|help)/.test(text)) return send(chat, HELP);
  if (/^\/(list|tasks)/.test(text)) { const m = listMessage(await listTasks(), "all"); return send(chat, m.text, m.buttons); }
  if (/^\/today/.test(text)) { const m = listMessage(await listTasks(), "today"); return send(chat, m.text, m.buttons); }
  if (/^\/digest/.test(text)) return send(chat, await digest(await listTasks()));
  if (text.startsWith("/")) return send(chat, "Не знаю такой команды.\n\n" + HELP);
  return createTask(chat, text);
}

async function onCallback(q, owner) {
  const answer = (text) => tg("answerCallbackQuery", { callback_query_id: q.id, ...(text ? { text } : {}) });
  if (!owner || q.message?.chat?.id !== owner.chat) return answer("Это личный бот.");
  const [action, ...rest] = String(q.data || "").split(":");
  const id = rest[rest.length - 1];
  const store = taskStore();
  const data = await store.get(id, { type: "json" });
  const edit = (text, buttons) => tg("editMessageText", { chat_id: q.message.chat.id, message_id: q.message.message_id, text, parse_mode: "HTML", reply_markup: { inline_keyboard: buttons || [] } });
  if (!data) { await answer("Задача уже удалена"); return edit(q.message.text ? esc(q.message.text) : "Задача удалена"); }
  const t = { ...data, id };
  const now = Date.now();
  const title = `<b>${esc(t.text)}</b>`;

  if (action === "nag") {
    t.nagEvery = Number(rest[0]) || 1;
    // Если напоминание уже было, следующий повтор — через выбранный интервал; иначе повторы начнутся после первого напоминания.
    t.nag = t.notifiedFor ? { ...(t.nag || {}), at: nextNag(t, now), msg: q.message.message_id } : null;
    await saveTask(t);
    await answer(`Буду повторять каждые ${t.nagEvery} ч`);
    const keep = (q.message.reply_markup?.inline_keyboard || []).filter((row) => !row.some((b) => /^(nag|stop):/.test(b.callback_data)));
    return tg("editMessageReplyMarkup", { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [...keep, nagRow(t)] } });
  }
  t.nag = null;
  if (action === "done" || action === "ldone") {
    if (t.repeat) {
      if (t.due && t.due <= now + 60_000 && t.notifiedFor !== t.due) { t.notifiedFor = t.due; t.due = nextRepeat(t.repeat, now); }
      await saveTask(t);
      await answer("Отмечено");
      if (action === "done") return edit(`✅ ${title}\n🔁 Следующее напоминание: ${human(t.due, now)}`);
    } else {
      t.done = true; t.doneAt = now;
      await saveTask(t);
      await answer("Сделано ✅");
      if (action === "done") return edit(`✅ <s>${esc(t.text)}</s>\nСделано`);
    }
    const m = listMessage(await listTasks(), rest[0] === "t" ? "today" : "all", now);
    return edit(m.text, m.buttons);
  }
  if (action === "snz" || action === "tmr") {
    const l = local(now);
    t.due = action === "snz" ? now + 3_600_000 : fromLocal(l.y, l.mo, l.d + 1, 9, 0);
    t.notifiedFor = null;
    await saveTask(t);
    await answer("Перенесено");
    return edit(`⏰ ${title}\nНапомню ${human(t.due, now)}`);
  }
  if (action === "stop") {
    t.nagEvery = null;
    await saveTask(t);
    await answer("Повтор выключен");
    const keep = (q.message.reply_markup?.inline_keyboard || []).filter((row) => !row.some((b) => /^(nag|stop):/.test(b.callback_data)));
    return tg("editMessageReplyMarkup", { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [...keep, nagRow(t)] } });
  }
  if (action === "del") {
    await store.delete(id);
    await answer("Удалено");
    return edit(`🗑 <s>${esc(t.text)}</s>\nУдалено`);
  }
  return answer();
}

async function hook(req) {
  if (!botToken() || req.headers.get("x-telegram-bot-api-secret-token") !== hookSecret()) return new Response("forbidden", { status: 403 });
  const u = await req.json().catch(() => null);
  if (!u) return ok();
  const owner = await botStore().get("owner", { type: "json" });
  try {
    if (u.message) await onMessage(u.message, owner);
    else if (u.callback_query) await onCallback(u.callback_query, owner);
  } catch (e) {
    console.error(e);
    const chat = u.message?.chat?.id ?? u.callback_query?.message?.chat?.id;
    if (chat && owner?.chat === chat) await send(chat, "Что-то пошло не так, попробуйте ещё раз.");
  }
  return ok();
}

async function setup(req) {
  if (!botToken()) return check();
  const base = new URL(req.url).origin;
  const me = await tg("getMe");
  if (!me.ok) return check();
  const r = await tg("setWebhook", { url: `${base}/api/telegram/hook`, secret_token: hookSecret(), allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
  await tg("setMyCommands", { commands: [
    { command: "list", description: "Все задачи" },
    { command: "today", description: "На сегодня и просроченные" },
    { command: "digest", description: "Сводка: задачи, дедлайны, красные проекты" },
    { command: "help", description: "Как писать задачи" },
  ] });
  const owner = await botStore().get("owner", { type: "json" });
  if (!r.ok) return page("Не удалось подключить бота", [`Telegram ответил: ${esc(r.description || "ошибка")}. Откройте эту страницу ещё раз через минуту.`], false);
  return page("Бот подключён ✅", [
    `Бот: <b>${esc(me.result.first_name)}</b> (@${esc(me.result.username)})`,
    owner
      ? "Владелец уже назначен. Бот отвечает только ему."
      : `Теперь откройте <a href="https://t.me/${esc(me.result.username)}">@${esc(me.result.username)}</a> и нажмите <b>Start</b>. Кто нажмёт первым, тот и станет владельцем, поэтому сделайте это сразу.`,
  ], true);
}

export default async (req, context) => {
  const action = context.params?.action;
  if (action === "check" && req.method === "GET") return check();
  if (action === "setup" && req.method === "GET") return setup(req);
  if (action === "hook" && req.method === "POST") return hook(req);
  return new Response("Not found", { status: 404 });
};

export const config = { path: "/api/telegram/:action" };
