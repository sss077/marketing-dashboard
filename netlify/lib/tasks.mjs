import { getStore } from "@netlify/blobs";

// Задачи: один blob на задачу в хранилище «tasks».
// { text, due (ms|null), repeat, done, doneAt, createdAt, notifiedFor (due, о котором уже напомнили), src }
export const taskStore = () => getStore({ name: "tasks", consistency: "strong" });
export const botStore = () => getStore({ name: "bot-meta", consistency: "strong" });

export async function listTasks() {
  const store = taskStore();
  const { blobs } = await store.list();
  const rows = await Promise.all(blobs.map(async ({ key }) => {
    const t = await store.get(key, { type: "json" });
    return t ? { ...t, id: key } : null;
  }));
  return rows.filter(Boolean);
}

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export async function saveTask(t) {
  const { id, ...data } = t;
  await taskStore().setJSON(id, data);
  return t;
}
