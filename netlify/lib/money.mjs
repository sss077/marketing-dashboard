// Долги клиентов — та же логика, что в разделе «Финансы» на сайте.
export function entry(r, m) {
  const e = r.payments?.[m], fee = Number(r.fee) || 0;
  if (!e) return { due: fee, got: [], s: "open" };
  if ("due" in e || "got" in e) return { due: Number(e.due) || 0, got: Array.isArray(e.got) ? e.got : [], s: e.s || "open" };
  const f = Number(e.fee ?? fee) || 0;
  if (e.s === "paid") return { due: f, got: [{ a: f }], s: "open" };
  return { due: f, got: [], s: e.s === "left" ? "left" : "open" };
}
export const gotSum = (e) => e.got.reduce((a, x) => a + (Number(x.a) || 0), 0);
export function activeIn(r, m) {
  if (!r.startMonth || m < r.startMonth) return false;
  const leftAt = Object.keys(r.payments || {}).filter((k) => entry(r, k).s === "left").sort()[0];
  return !(leftAt && m > leftAt);
}
const shift = (m, n) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

// Все недоплаты за месяцы до curMonth (не включая), плюс ожидаемые оплаты за curMonth.
export function debts(records, curMonth) {
  const owed = [], expected = [];
  for (const r of records) {
    let m = r.startMonth;
    if (!m) continue;
    for (let i = 0; m <= curMonth && i < 120; i++, m = shift(m, 1)) {
      if (!activeIn(r, m)) continue;
      const e = entry(r, m);
      if (e.s !== "open") continue;
      const rest = e.due - gotSum(e);
      if (rest <= 0) continue;
      (m < curMonth ? owed : expected).push({ name: r.name || "Без названия", month: m, rest });
    }
  }
  return { owed, expected };
}
