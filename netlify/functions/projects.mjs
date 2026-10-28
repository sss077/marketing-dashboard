import { getStore } from "@netlify/blobs";
import seed from "./seed.mjs";

// Хранилище проектов светофора: один blob на проект.
// GET /api/projects — все проекты, PUT /api/projects/:id — сохранить, DELETE /api/projects/:id — удалить.

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BYTES = 100_000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

async function seedOnce(store, meta) {
  if (await meta.get("seeded")) return;
  const { blobs } = await store.list();
  if (!blobs.length) {
    for (const { id, ...data } of seed) await store.setJSON(id, data);
  }
  await meta.set("seeded", new Date().toISOString());
}

export default async (req, context) => {
  const store = getStore({ name: "projects", consistency: "strong" });
  const meta = getStore({ name: "projects-meta", consistency: "strong" });
  const id = context.params?.id;

  if (req.method === "GET" && !id) {
    await seedOnce(store, meta);
    const { blobs } = await store.list();
    const rows = await Promise.all(
      blobs.map(async ({ key }) => {
        const data = await store.get(key, { type: "json" });
        return data ? { ...data, id: key } : null;
      }),
    );
    return json(rows.filter(Boolean));
  }

  if (!id || !ID_RE.test(id)) return json({ error: "Неверный id проекта" }, 400);

  if (req.method === "PUT") {
    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ error: "Проект слишком большой" }, 413);
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

export const config = { path: ["/api/projects", "/api/projects/:id"] };
