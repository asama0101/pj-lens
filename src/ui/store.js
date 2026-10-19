// データファイル(JSON)の読み書き。File System Access API を使い、選んだファイルのハンドルを IndexedDB に覚える。
// 保存前に更新日時を比べ、他（Claude Code など）が更新していたら上書きせず conflict を返す。

const KEY = "dataFileHandle";
const PICKER_TYPES = [{ description: "プロジェクトデータ (JSON)", accept: { "application/json": [".json"] } }];

/** 既定の IndexedDB 保存先（使えない環境では記憶しないだけ） */
function defaultIdb() {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open("compass", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = fn(db.transaction("kv", mode).objectStore("kv"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };
  return {
    get: (k) => run("readonly", (s) => s.get(k)).catch(() => undefined),
    set: (k, v) => run("readwrite", (s) => s.put(v, k)).catch(() => undefined),
  };
}

export function createStore(deps = {}) {
  const picker = deps.showOpenFilePicker ?? (typeof window !== "undefined" ? (o) => window.showOpenFilePicker(o) : null);
  const idb = deps.idb ?? defaultIdb();
  let handle = null;
  let loadedAt = null; // 読み込み（または直近の保存）時点のファイル更新日時

  async function ensureWritable(h) {
    try {
      if ((await h.queryPermission?.({ mode: "readwrite" })) === "granted") return true;
      return (await h.requestPermission?.({ mode: "readwrite" })) === "granted";
    } catch {
      return false;
    }
  }

  async function load() {
    const file = await handle.getFile();
    const data = JSON.parse(await file.text());
    loadedAt = file.lastModified;
    return data;
  }

  /** 保存済みのハンドルがあれば再利用し、なければファイル選択を出す */
  async function open() {
    const saved = await idb.get(KEY);
    if (saved && (await ensureWritable(saved))) {
      handle = saved;
    } else {
      return choose();
    }
    return load();
  }

  /** 常にファイル選択を出す */
  async function choose() {
    if (!picker) throw new Error("このブラウザはファイルの直接保存に対応していません（Edge または Chrome を使ってください）");
    const [h] = await picker({ types: PICKER_TYPES, multiple: false });
    handle = h;
    await ensureWritable(h);
    await idb.set(KEY, h);
    return load();
  }

  async function reload() {
    if (!handle) throw new Error("ファイルが選ばれていません");
    return load();
  }

  async function save(data) {
    if (!handle) return { ok: false, reason: "error", message: "ファイルが選ばれていません" };
    try {
      const current = await handle.getFile();
      if (current.lastModified !== loadedAt) {
        return { ok: false, reason: "conflict", message: "他で更新されました。再読込してください" };
      }
      const w = await handle.createWritable();
      await w.write(JSON.stringify(data, null, 2) + "\n");
      await w.close();
      loadedAt = (await handle.getFile()).lastModified;
      return { ok: true };
    } catch (e) {
      const denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
      return { ok: false, reason: denied ? "denied" : "error", message: denied ? "書き込みが許可されていません" : `保存に失敗しました: ${e?.message ?? e}` };
    }
  }

  return { open, choose, reload, save, get hasFile() { return !!handle; } };
}
