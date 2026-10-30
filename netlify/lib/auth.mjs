import { getStore } from "@netlify/blobs";
import { createHmac, timingSafeEqual } from "node:crypto";

// Пароль «Финансов» открывает и задачи: токен = HMAC от секрета, созданного при установке пароля.
export const metaStore = () => getStore({ name: "finance-meta", consistency: "strong" });
export const tokenFor = (secret) => createHmac("sha256", secret).update("ddlv-finance").digest("hex");
export const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function authorized(req) {
  const auth = await metaStore().get("auth", { type: "json" });
  const token = req.headers.get("x-finance-token") || "";
  return !!auth && same(token, tokenFor(auth.secret));
}
