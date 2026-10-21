// データファイル(JSON)の読み書き。File System Access API を使い、選んだファイルのハンドルを IndexedDB に覚える。
// 保存前に更新日時を比べ、他（Claude Code など）が更新していたら上書きせず conflict を返す。
// 開き直しは、権限が許可済みなら restore（確認なし）、確認が必要なら reopen（ボタンの押下で確認だけ）。ファイル選択は choose だけが出す。

const KEY = "dataFileHandle";
const PICKER_TYPES = [{ description: "プロジェクトデータ (JSON)", accept: { "application/json": [".json"] } }];

/** 既定の IndexedDB 保存先。get は失敗を投げ（理由を画面に出すため）、set は失敗しても false を返すだけ（記憶できないだけで、使えなくはしない） */
function defaultIdb() {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open("pj-lens", 1);
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
    get: (k) => run("readonly", (s) => s.get(k)),
    set: (k, v) => run("readwrite", (s) => s.put(v, k)).then(() => true, () => false),
  };
}

export function createStore(deps = {}) {
  const picker = deps.showOpenFilePicker ?? (typeof window !== "undefined" ? (o) => window.showOpenFilePicker(o) : null);
  const idb = deps.idb ?? defaultIdb();
  let handle = null;
  let loadedAt = null; // 読み込み（または直近の保存）時点のファイル更新日時
  let rememberFailed = false; // choose で選んだファイルを記憶できなかった（次回も選び直しになる）

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

  /** 記憶したファイルの名前。なければ null、記憶を読めなければ { error } */
  async function lastFile() {
    try {
      const saved = await idb.get(KEY);
      return saved ? { name: saved.name ?? "" } : null;
    } catch (e) {
      return { error: e?.message ?? String(e) };
    }
  }

  /** 起動時の自動オープン。権限が許可済みのときだけ読み、確認もファイル選択も出さない。使えなければ null */
  async function restore() {
    let saved;
    try { saved = await idb.get(KEY); } catch { return null; }
    if (!saved || (await saved.queryPermission?.({ mode: "readwrite" })) !== "granted") return null;
    handle = saved;
    return load();
  }

  /** 「前回のファイルを開く」。権限の確認だけを出し（ボタン押下の中で呼ぶ）、拒否されてもファイル選択には切り替えない */
  async function reopen() {
    let saved;
    try { saved = await idb.get(KEY); } catch (e) { throw new Error(`前回のファイルの記憶を読めません: ${e?.message ?? e}`); }
    if (!saved) throw new Error("前回のファイルの記憶がありません。「別のファイルを開く」で選んでください");
    if (!(await ensureWritable(saved))) throw new Error("ファイルへの書き込みが許可されませんでした。もう一度押して許可するか、「別のファイルを開く」で選び直してください");
    handle = saved;
    return load();
  }

  /** 常にファイル選択を出す */
  async function choose() {
    if (!picker) throw new Error("このブラウザはファイルの直接保存に対応していません（Edge または Chrome を使ってください）");
    const [h] = await picker({ types: PICKER_TYPES, multiple: false });
    handle = h;
    await ensureWritable(h);
    rememberFailed = (await idb.set(KEY, h)) === false;
    return load();
  }

  /** ファイルの最新を読むだけ（読込時点は変えない。他の更新があるかの確認用） */
  async function peek() {
    if (!handle) throw new Error("ファイルが選ばれていません");
    return JSON.parse(await (await handle.getFile()).text());
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

  /**
   * 保存する。他（Claude Code など）がファイルを更新していて競合したときは、最新のファイルを読み直して、同じ編集（edit: data → data）を
   * 最新のデータに当て、もう一度だけ保存する（他の更新も、この編集も消さない）。成功したら、保存したデータを data で返す
   */
  async function saveMerged(edit, data) {
    const first = await save(data);
    if (first.ok || first.reason !== "conflict") return { ...first, data };
    let merged;
    try {
      merged = edit(await reload());
    } catch (e) {
      return { ok: false, reason: "error", message: e?.message ?? String(e), data };
    }
    const second = await save(merged);
    return second.ok ? { ok: true, data: merged } : { ...second, data };
  }

  return { restore, reopen, choose, lastFile, peek, reload, save, saveMerged, get hasFile() { return !!handle; }, get rememberFailed() { return rememberFailed; } };
}
