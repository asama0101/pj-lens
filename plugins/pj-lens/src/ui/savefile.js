// HTML ファイルの保存。保存ダイアログが使えるブラウザ（File System Access API）では、保存先を選ばせる（初期の場所はダウンロードフォルダ。前回の場所は覚えない）。
// 使えないブラウザや、取り消し以外で失敗したときは、ブラウザのダウンロードとして規約のファイル名で保存する（保存先はブラウザのダウンロード先）。

function download(file, html, w) {
  const url = w.URL.createObjectURL(new w.Blob([html], { type: "text/html" }));
  const a = w.document.createElement("a");
  a.href = url;
  a.download = file;
  a.click();
  w.setTimeout(() => w.URL.revokeObjectURL(url), 60000);
  return { ok: true, name: file, picked: false };
}

/**
 * @param file 規約のファイル名（保存ダイアログの初期の名前）
 * @param w ブラウザの window（テストでは差し替える）
 * @returns { ok: true, name, picked }（picked は保存ダイアログで選んだか。選んだ場所に書けずにダウンロードへ落としたときは fallback: true も付く）、
 *          または利用者が保存ダイアログを閉じたときの { ok: false, cancelled: true }
 */
export async function saveHtmlFile(file, html, w = window) {
  if (typeof w.showSaveFilePicker !== "function") return download(file, html, w);
  let handle;
  try {
    handle = await w.showSaveFilePicker({ suggestedName: file, startIn: "downloads", types: [{ description: "HTML", accept: { "text/html": [".html"] } }] });
  } catch (e) {
    // 取り消しは、ダイアログを閉じたときだけ。権限がない・使えないなどは、何も作られていないので、ダウンロードに落とす
    return e?.name === "AbortError" ? { ok: false, cancelled: true } : download(file, html, w);
  }
  let out;
  try {
    out = await handle.createWritable();
    await out.write(html);
    await out.close();
    return { ok: true, name: handle.name ?? file, picked: true };
  } catch {
    // 選んだ場所に書けなかった（共有フォルダの権限・切断など）。書きかけを破棄して、ダウンロードに落とす（呼び出し側が利用者に知らせる）
    try { await out?.abort?.(); } catch { /* 破棄できなくても続ける */ }
    return { ...download(file, html, w), fallback: true };
  }
}
