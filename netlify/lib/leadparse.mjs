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

// Подпись поля в любом месте текста: «Имя:», «📞 Номер телефона:», «Реклама - 3» …
const LABEL = /(?<![\p{L}])(номер\s+телефона|номер|телефон|тел\.?|phone|raqam|telefon|имя|ism|name|город|shahar|city|регион|viloyat|реклама|reklama)\s*[:\-–—]/giu;

export function parseLeads(text) {
  // Переносы строк любого вида (Windows, старый Mac, iPhone U+2028) → \n; убираем звёздочки жирного шрифта.
  let t = String(text || "").replace(/\r\n|\r|\u2028|\u2029|\u0085/g, "\n").replace(/\*+/g, "");
  // Каждая подпись поля, заголовок и дата — с новой строки, даже если всё слиплось в одну строку.
  t = t.replace(LABEL, "\n$&").replace(/нов(?:ая|ые)\s+заявк[аи]\s*:?/giu, "\n#ЗАЯВКА\n").replace(/(\d{1,2}[./]\d{1,2}[./]\d{4}(?:\s*[-–—,]?\s*\d{1,2}:\d{2})?)/g, "\n$1\n");
  const out = [];
  let lead = null;
  const fresh = () => ({ name: "", contact: "", city: "", ad: "", date: null, time: null });
  const hasData = (l) => l && (l.name || l.contact);
  const flush = () => { if (hasData(lead)) out.push(lead); lead = fresh(); };
  lead = fresh();
  for (const raw of t.split("\n")) {
    const line = raw.replace(/^[^\p{L}\p{N}+#]+/u, "").trim(); // эмодзи, точки, тире в начале строки
    if (!line) continue;
    if (line === "#ЗАЯВКА") { flush(); continue; }
    let m;
    if ((m = DATE.exec(line)) && m.index === 0) {
      if (hasData(lead)) flush(); // дата перед следующей заявкой
      if (!lead.date) { lead.date = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; if (m[4]) lead.time = `${m[4].padStart(2, "0")}:${m[5]}`; }
      continue;
    }
    for (const [k, re] of Object.entries(FIELD)) {
      if ((m = re.exec(line))) {
        const key = k === "phone" ? "contact" : k;
        if (lead[key]) flush(); // поле повторилось — началась следующая заявка (текст без «Новая заявка»)
        const v = m[1].trim();
        lead[key] = k === "phone" ? normPhone(v) : v;
        break;
      }
    }
  }
  flush();
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

import { local } from "./time.mjs";

// Заявка из полей (то, что присылает Make): ключи на русском, узбекском или английском,
// в том числе сырой формат Meta Lead Ads — field_data: [{name, values: [...]}].
const KEYS = {
  name: ["name", "fullname", "имя", "ism", "фио", "fio", "ismfamiliya"],
  firstName: ["firstname"],
  lastName: ["lastname"],
  contact: ["phone", "phonenumber", "tel", "telephone", "номер", "номертелефона", "телефон", "raqam", "telefon", "contact", "контакт"],
  city: ["city", "город", "shahar", "region", "регион", "viloyat"],
  ad: ["ad", "adname", "реклама", "reklama", "campaign", "campaignname", "adsetname", "объявление"],
  date: ["createdtime", "date", "дата", "time", "datetime"],
  source: ["source", "источник", "platform"],
  client: ["client", "клиент", "project", "проект"],
  note: ["note", "comment", "комментарий"],
  form: ["form", "formname", "форма"],
};
const norm = (k) => String(k).toLowerCase().replace(/[\s_\-.:]/g, "");
const IGNORE = new Set(["key", "text", "id", "leadgenid", "pageid", "formid", "adid", "adsetid", "campaignid", "isorganic"]);

export function leadFromFields(obj) {
  const flat = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (k === "field_data" && Array.isArray(v)) {
      for (const f of v) if (f?.name) flat[f.name] = Array.isArray(f.values) ? f.values.join(", ") : f.values;
    } else if (v !== null && typeof v !== "object") flat[k] = v;
  }
  const lead = {}, extra = [];
  for (const [k, v] of Object.entries(flat)) {
    const nk = norm(k), val = String(v).trim();
    if (!val || IGNORE.has(nk)) continue;
    const field = Object.keys(KEYS).find((f) => KEYS[f].includes(nk));
    if (field && !lead[field]) lead[field] = val;
    else if (!field) extra.push(`${k}: ${val}`);
  }
  if (!lead.name && (lead.firstName || lead.lastName)) lead.name = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
  let date = null, time = null;
  if (lead.date) {
    const m = DATE.exec(lead.date);
    if (m) { date = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; if (m[4]) time = `${m[4].padStart(2, "0")}:${m[5]}`; }
    else {
      const ms = Date.parse(lead.date.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
      if (!Number.isNaN(ms)) { const l = local(ms); date = `${l.y}-${String(l.mo + 1).padStart(2, "0")}-${String(l.d).padStart(2, "0")}`; time = `${String(l.h).padStart(2, "0")}:${String(l.mi).padStart(2, "0")}`; }
    }
  }
  const noteParts = [lead.note, lead.form && `Форма: ${lead.form}`, ...extra].filter(Boolean);
  return {
    name: lead.name || "", contact: normPhone(lead.contact || ""), city: lead.city || "", ad: lead.ad || "",
    date, time, client: lead.client || "", note: noteParts.join("\n"),
    source: lead.source ? (/^(fb|facebook|ig|instagram|meta)$/i.test(lead.source) ? "Реклама Meta" : lead.source) : "",
  };
}

async function existingPhones(store) {
  const { blobs } = await store.list();
  const set = new Set();
  await Promise.all(blobs.map(async ({ key }) => {
    const l = await store.get(key, { type: "json" });
    const k = l && phoneKey(l.contact);
    if (k) set.add(k);
  }));
  return set;
}

// Сохранить заявки, пропуская номера, которые уже есть. Без даты — ставим сейчас (по Ташкенту).
export async function addLeads(store, list, { source = "Реклама Meta", dryRun = false, src = "import" } = {}) {
  const existing = await existingPhones(store);
  const fresh = list.filter((l) => !phoneKey(l.contact) || !existing.has(phoneKey(l.contact)));
  const odd = fresh.filter((l) => { const d = l.contact.replace(/\D/g, ""); return d && !(d.length === 12 && d.startsWith("998")); });
  if (!dryRun) {
    const nowIso = new Date().toISOString();
    const n = local();
    let i = 0;
    for (const l of fresh) {
      const id = Date.now().toString(36) + (i++).toString(36) + Math.random().toString(36).slice(2, 6);
      await store.setJSON(id, {
        ...l,
        date: l.date || `${n.y}-${String(n.mo + 1).padStart(2, "0")}-${String(n.d).padStart(2, "0")}`,
        time: l.time || (l.date ? null : `${String(n.h).padStart(2, "0")}:${String(n.mi).padStart(2, "0")}`),
        source: l.source || source, service: "", budget: null, status: "new", note: l.note || "",
        createdAt: nowIso, updatedAt: nowIso, src,
      });
    }
  }
  return { found: list.length, added: fresh.length, duplicates: list.length - fresh.length, sample: fresh.slice(0, 5).map((l) => l.name || l.contact), odd: odd.map((l) => `${l.name || "Без имени"}: ${l.contact}`), months: [...new Set(fresh.map((l) => (l.date || "").slice(0, 7)).filter(Boolean))] };
}

// Добавить заявки, вставленные текстом («Новая заявка: …»). dryRun — только посчитать.
export const importLeads = (store, text, opts = {}) => addLeads(store, parseLeads(text), opts);
