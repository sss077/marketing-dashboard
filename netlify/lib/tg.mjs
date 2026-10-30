import { createHmac } from "node:crypto";

export const botToken = () => (process.env.TELEGRAM_BOT_TOKEN || "").trim();
// Секрет, который Telegram присылает в заголовке каждого запроса к боту.
export const hookSecret = () => createHmac("sha256", botToken()).update("ddlv-webhook").digest("hex");

export async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!data.ok) console.error("telegram", method, data.description);
  return data;
}

export const send = (chat_id, text, buttons) =>
  tg("sendMessage", { chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}) });

export const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
