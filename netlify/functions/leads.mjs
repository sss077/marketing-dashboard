import { getStore } from "@netlify/blobs";
import { importLeads, addLeads, leadFromFields, parseLeads, looksLikeLeads } from "../lib/leadparse.mjs";
import { timingSafeEqual } from "node:crypto";

// Лиды агентства: один blob на лид. Открыто всем, у кого есть ссылка на сайт (как проекты).
// GET /api/leads — все лиды, PUT /api/leads/:id — сохранить, DELETE /api/leads/:id — удалить,
// POST /api/leads/import {text, source, dryRun} — добавить заявки, вставленные текстом («Новая заявка: …»).
// POST /api/leads/hook?key=… — приём заявок из Make (поля или текст), ключ — переменная LEADS_WEBHOOK_KEY.
// GET  /api/leads/hook?key=… — проверить адрес в браузере.

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

  if (id === "hook") return hook(req, store);

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

const page = (title, text, ok) =>
  new Response(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:24px 16px;background:#f3f5f7;color:#17202a}main{max-width:520px;margin:auto;background:#fff;border:1px solid #dde3e9;border-radius:12px;padding:20px}h1{font-size:20px;margin:0 0 10px;color:${ok ? "#1f9a55" : "#d33b2c"}}@media (prefers-color-scheme:dark){body{background:#11161b;color:#e8edf2}main{background:#182029;border-color:#2a3541}}</style>
</head><body><main><h1>${title}</h1><p>${text}</p></main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

const keyOk = (given) => {
  const key = (process.env.LEADS_WEBHOOK_KEY || "").trim();
  const g = String(given || "");
  return key && g.length === key.length && timingSafeEqual(Buffer.from(g), Buffer.from(key));
};

async function readPayload(req) {
  const type = req.headers.get("content-type") || "";
  const raw = await req.text();
  if (raw.length > 200_000) return null;
  if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
  try { return JSON.parse(raw); } catch { return raw.trim() ? { text: raw } : null; }
}

async function hook(req, store) {
  const url = new URL(req.url);
  const configured = !!(process.env.LEADS_WEBHOOK_KEY || "").trim();
  const given = url.searchParams.get("key") || req.headers.get("x-key");
  if (req.method === "GET") {
    if (!configured) return page("Ключ не задан", "В Netlify нет переменной <b>LEADS_WEBHOOK_KEY</b>. Добавьте её (Project configuration → Environment variables), перезапустите публикацию и откройте эту страницу снова.", false);
    if (!keyOk(given)) return page("Неверный ключ", "Ключ в адресе (после <b>?key=</b>) не совпадает со значением переменной LEADS_WEBHOOK_KEY в Netlify.", false);
    return page("Адрес работает ✅", "Вставьте этот же адрес в модуль HTTP в Make. Заявки будут появляться во вкладке «Лиды».", true);
  }
  if (req.method !== "POST") return json({ error: "Метод не поддерживается" }, 405);
  if (!configured) return json({ ok: false, error: "LEADS_WEBHOOK_KEY не задан в Netlify" }, 503);
  if (!keyOk(given)) return json({ ok: false, error: "Неверный ключ" }, 401);
  const body = await readPayload(req);
  if (!body) return json({ ok: false, error: "Пустая заявка" }, 400);
  const items = Array.isArray(body) ? body : [body];
  const list = [];
  for (const it of items) {
    if (typeof it?.text === "string" && looksLikeLeads(it.text) && !it.phone && !it.name) list.push(...parseLeads(it.text));
    else {
      const l = leadFromFields(it);
      if (l.name || l.contact) list.push(l);
    }
  }
  if (!list.length) return json({ ok: false, error: "Не нашёл в заявке имя или телефон" }, 400);
  const r = await addLeads(store, list, { src: "make" });
  return json({ ok: true, added: r.added, duplicates: r.duplicates });
}

export const config = { path: ["/api/leads", "/api/leads/:id"] };
