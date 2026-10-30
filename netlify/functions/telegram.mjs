// Telegram-бот DDL V.
// GET /api/telegram/check — проверить токен из переменной окружения TELEGRAM_BOT_TOKEN.
// Сам токен никогда не выводится.

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

export default async (req, context) => {
  if (context.params?.action === "check" && req.method === "GET") return check();
  return new Response("Not found", { status: 404 });
};

export const config = { path: "/api/telegram/:action" };
