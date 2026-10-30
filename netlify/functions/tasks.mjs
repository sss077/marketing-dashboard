import { authorized } from "../lib/auth.mjs";
import { listTasks, saveTask, taskStore, botStore, newId } from "../lib/tasks.mjs";
import { parse, nextRepeat, repeatLabel } from "../lib/parse.mjs";
import { human } from "../lib/time.mjs";

// Задачи для вкладки «Задачи» на сайте. Те же задачи, что в Telegram-боте; доступ по паролю «Финансов».
// GET /api/tasks — список; POST /api/tasks {text} — добавить (время разбирается из текста);
// PUT /api/tasks/:id {done} — отметить; DELETE /api/tasks/:id — удалить.

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

const view = (t, now) => ({ ...t, when: t.due ? human(t.due, now) : null, repeatText: t.repeat ? repeatLabel(t.repeat) : null, nagText: t.nagEvery ? `повтор каждые ${t.nagEvery} ч` : null });

export default async (req, context) => {
  if (!(await authorized(req))) return json({ error: "Нужен пароль" }, 401);
  const id = context.params?.id;
  const now = Date.now();

  if (req.method === "GET" && !id) {
    const owner = await botStore().get("owner", { type: "json" });
    return json({ tasks: (await listTasks()).map((t) => view(t, now)), botLinked: !!owner });
  }

  if (req.method === "POST" && !id) {
    const body = await req.json().catch(() => null);
    const text = String(body?.text || "").trim().slice(0, 500);
    if (!text) return json({ error: "Пустая задача" }, 400);
    const p = parse(text, now);
    const t = { id: newId(), text: p.text, due: p.due, repeat: p.repeat, nagEvery: p.nagEvery, done: false, createdAt: now, src: "web" };
    await saveTask(t);
    return json(view(t, now));
  }

  if (!id || !ID_RE.test(id)) return json({ error: "Неверный id" }, 400);
  const store = taskStore();

  if (req.method === "PUT") {
    const data = await store.get(id, { type: "json" });
    if (!data) return json({ error: "Задача не найдена" }, 404);
    const body = await req.json().catch(() => ({}));
    const t = { ...data, id, nag: null };
    if (body.done === true && t.repeat) {
      t.notifiedFor = t.due;
      t.due = nextRepeat(t.repeat, Math.max(now, t.due || 0));
    } else if (typeof body.done === "boolean") {
      t.done = body.done;
      t.doneAt = body.done ? now : null;
    }
    await saveTask(t);
    return json(view(t, now));
  }

  if (req.method === "DELETE") {
    await store.delete(id);
    return json({ ok: true });
  }

  return json({ error: "Метод не поддерживается" }, 405);
};

export const config = { path: ["/api/tasks", "/api/tasks/:id"] };
