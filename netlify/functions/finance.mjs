import { getStore } from "@netlify/blobs";
import { randomBytes, scryptSync, createHmac, timingSafeEqual } from "node:crypto";

// Финансы: оплаты клиентов по месяцам, доступ только по паролю.
// GET  /api/finance/status  — задан ли пароль
// POST /api/finance/setup   — задать пароль (только если ещё не задан), вернуть токен
// POST /api/finance/login   — войти по паролю, вернуть токен
// GET  /api/finance         — все записи (нужен заголовок x-finance-token)
// PUT  /api/finance/:id     — обновить запись проекта: name, client, fee, startMonth, payments (сливается с сохранённой)
// DELETE /api/finance/:id   — удалить запись

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATES = new Set(["open", "closed", "left"]);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const tokenFor = (secret) => createHmac("sha256", secret).update("ddlv-finance").digest("hex");
const hashOf = (password, salt) => scryptSync(password, salt, 32).toString("hex");
const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readBody(req) {
  try {
    const text = await req.text();
    if (text.length > 50_000) return null;
    const data = JSON.parse(text);
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function clean(patch, prev) {
  const out = { ...prev };
  if (typeof patch.name === "string") out.name = patch.name.slice(0, 200);
  if (typeof patch.client === "string") out.client = patch.client.slice(0, 200);
  if ("fee" in patch) out.fee = Number(patch.fee) >= 0 ? Number(patch.fee) : 0;
  if ("startMonth" in patch) out.startMonth = MONTH_RE.test(patch.startMonth) ? patch.startMonth : null;
  if (patch.payments && typeof patch.payments === "object") {
    const pay = { ...(prev.payments || {}) };
    for (const [m, v] of Object.entries(patch.payments)) {
      if (!MONTH_RE.test(m)) continue;
      if (v === null) delete pay[m];
      else if (v && typeof v === "object") {
        // Месяц клиента: сколько договорились (due), полученные платежи (got) и состояние:
        // open — ждём деньги, closed — закрыт с недоплатой, left — клиент ушёл.
        const got = (Array.isArray(v.got) ? v.got : [])
          .slice(0, 50)
          .map((x) => ({ a: Math.round(Number(x?.a) * 100) / 100, d: DATE_RE.test(x?.d) ? x.d : null }))
          .filter((x) => x.a > 0);
        pay[m] = { due: Number(v.due) >= 0 ? Number(v.due) : 0, got, s: STATES.has(v.s) ? v.s : "open" };
      }
    }
    out.payments = pay;
  }
  return out;
}

export default async (req, context) => {
  const store = getStore({ name: "finance", consistency: "strong" });
  const meta = getStore({ name: "finance-meta", consistency: "strong" });
  const id = context.params?.id;
  const auth = await meta.get("auth", { type: "json" });

  if (id === "status" && req.method === "GET") return json({ configured: !!auth });

  if (id === "setup" && req.method === "POST") {
    if (auth) return json({ error: "Пароль уже задан" }, 409);
    const body = await readBody(req);
    const password = String(body?.password || "");
    if (password.length < 4) return json({ error: "Пароль должен быть не короче 4 символов" }, 400);
    const salt = randomBytes(16).toString("hex");
    const secret = randomBytes(32).toString("hex");
    await meta.setJSON("auth", { salt, hash: hashOf(password, salt), secret });
    return json({ token: tokenFor(secret) });
  }

  if (id === "login" && req.method === "POST") {
    if (!auth) return json({ error: "Пароль ещё не задан" }, 409);
    const body = await readBody(req);
    if (!same(hashOf(String(body?.password || ""), auth.salt), auth.hash)) {
      await sleep(800);
      return json({ error: "Неверный пароль" }, 401);
    }
    return json({ token: tokenFor(auth.secret) });
  }

  const token = req.headers.get("x-finance-token") || "";
  if (!auth || !same(token, tokenFor(auth.secret))) return json({ error: "Нужен пароль" }, 401);

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

  if (!id || !ID_RE.test(id)) return json({ error: "Неверный id" }, 400);

  if (req.method === "PUT") {
    const body = await readBody(req);
    if (!body) return json({ error: "Неверные данные" }, 400);
    const prev = (await store.get(id, { type: "json" })) || {};
    const next = clean(body, prev);
    await store.setJSON(id, next);
    return json({ ...next, id });
  }

  if (req.method === "DELETE") {
    await store.delete(id);
    return json({ ok: true });
  }

  return json({ error: "Метод не поддерживается" }, 405);
};

export const config = { path: ["/api/finance", "/api/finance/:id"] };
