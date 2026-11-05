// Разбор заявок, пришедших текстом:
//   Новая заявка:
//   05.11.2026 - 07:12
//   Имя: Madina
//   Номер телефона: +998500760622
//   Город: Samarqand viloyati
//   Реклама - 3
// В одном тексте может быть сколько угодно заявок.

const FIELD = {
  name: /^(?:имя|ism|name)\s*[:\-–—]\s*(.*)$/i,
  phone: /^(?:номер(?:\s+телефона)?|телефон|тел\.?|phone|raqam|telefon)\s*[:\-–—]\s*(.*)$/i,
  city: /^(?:город|shahar|city|регион|viloyat)\s*[:\-–—]\s*(.*)$/i,
  ad: /^(?:реклама|reklama|ad|объявление)\s*[:\-–—]?\s*(.*)$/i,
};
const DATE = /(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s*[-–—,]?\s*(\d{1,2}):(\d{2}))?/;

export const phoneKey = (p) => String(p || "").replace(/\D/g, "").slice(-9);

// Узбекский номер из 9 цифр дополняем кодом +998; остальное оставляем как есть.
export function normPhone(p) {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length === 9) return "+998" + d;
  if (d.length === 12 && d.startsWith("998")) return "+" + d;
  return String(p || "").trim();
}

export function looksLikeLeads(text) {
  return /нов(ая|ые)\s+заявк/i.test(text) || (/^\s*(имя|ism)\s*[:\-]/im.test(text) && /(номер|телефон|raqam)/i.test(text));
}

export function parseLeads(text) {
  const blocks = String(text || "").split(/нов(?:ая|ые)\s+заявк[аи]\s*:?/i).map((b) => b.trim()).filter(Boolean);
  const out = [];
  for (const b of blocks) {
    const lead = { name: "", contact: "", city: "", ad: "", date: null, time: null };
    for (const raw of b.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      let m;
      if (!lead.date && (m = DATE.exec(line)) && !FIELD.phone.test(line)) {
        lead.date = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
        if (m[4]) lead.time = `${m[4].padStart(2, "0")}:${m[5]}`;
        continue;
      }
      for (const [k, re] of Object.entries(FIELD)) {
        if ((m = re.exec(line))) {
          const v = m[1].trim();
          if (k === "phone") lead.contact = normPhone(v);
          else lead[k] = v;
          break;
        }
      }
    }
    if (lead.name || lead.contact) out.push(lead);
  }
  // Одинаковые номера в одном тексте — одна заявка; пустые поля берём из повтора.
  const byPhone = new Map();
  const merged = [];
  for (const l of out) {
    const k = phoneKey(l.contact);
    const prev = k && byPhone.get(k);
    if (prev) {
      for (const f of ["name", "city", "ad", "date", "time"]) if (!prev[f] && l[f]) prev[f] = l[f];
      continue;
    }
    if (k) byPhone.set(k, l);
    merged.push(l);
  }
  return merged;
}

// Добавить заявки из текста в хранилище «leads», пропуская номера, которые уже есть.
// dryRun — только посчитать, ничего не сохранять.
export async function importLeads(store, text, { source = "Реклама Meta", dryRun = false } = {}) {
  const parsed = parseLeads(text);
  const { blobs } = await store.list();
  const existing = new Set();
  await Promise.all(blobs.map(async ({ key }) => {
    const l = await store.get(key, { type: "json" });
    const k = l && phoneKey(l.contact);
    if (k) existing.add(k);
  }));
  const fresh = parsed.filter((l) => !phoneKey(l.contact) || !existing.has(phoneKey(l.contact)));
  const odd = fresh.filter((l) => { const d = l.contact.replace(/\D/g, ""); return d && !(d.length === 12 && d.startsWith("998")); });
  if (!dryRun) {
    const now = new Date().toISOString();
    let i = 0;
    for (const l of fresh) {
      const id = Date.now().toString(36) + (i++).toString(36) + Math.random().toString(36).slice(2, 6);
      await store.setJSON(id, { ...l, source, service: "", budget: null, status: "new", note: "", createdAt: now, updatedAt: now, src: "import" });
    }
  }
  return { found: parsed.length, added: fresh.length, duplicates: parsed.length - fresh.length, odd: odd.map((l) => `${l.name || "Без имени"}: ${l.contact}`), months: [...new Set(fresh.map((l) => (l.date || "").slice(0, 7)).filter(Boolean))] };
}
