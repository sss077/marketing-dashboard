import { getStore } from "@netlify/blobs";
import { importLeads } from "../lib/leadparse.mjs";

// Лиды агентства: один blob на лид. Открыто всем, у кого есть ссылка на сайт (как проекты).
// GET /api/leads — все лиды, PUT /api/leads/:id — сохранить, DELETE /api/leads/:id — удалить,
// POST /api/leads/import {text, source, dryRun} — добавить заявки, вставленные текстом («Новая заявка: …»).

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BYTES = 20_000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export default async (req, context) => {
  const store = getStore({ name: "leads", consistency: "strong" });
  const id = context.params?.id;

  if (req.method === "GET" && !id) {
    const { blobs } = await store.list();
    const rows = await Promise.all(
      blobs.map(async ({ key }) => {
        const data = await store.get(key, { type: "json" });
        return data ? { ...data, id: key } : null;
      }),
    );
    return json(rows.filter(Boolean));
  }

  if (id === "import" && req.method === "POST") {
    const body = await req.json().catch(() => null);
    const text = String(body?.text || "");
    if (!text.trim() || text.length > 500_000) return json({ error: "Вставьте текст заявок" }, 400);
    const source = String(body?.source || "Реклама Meta").slice(0, 60);
    return json(await importLeads(store, text, { source, dryRun: !!body?.dryRun }));
  }

  if (!id || !ID_RE.test(id)) return json({ error: "Неверный id лида" }, 400);

  if (req.method === "PUT") {
    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ error: "Слишком много данных" }, 413);
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return json({ error: "Неверные данные" }, 400);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return json({ error: "Неверные данные" }, 400);
    delete data.id;
    await store.setJSON(id, data);
    return json({ ok: true });
  }

  if (req.method === "DELETE") {
    await store.delete(id);
    return json({ ok: true });
  }

  return json({ error: "Метод не поддерживается" }, 405);
};

export const config = { path: ["/api/leads", "/api/leads/:id"] };
