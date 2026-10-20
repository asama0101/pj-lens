// HTML ファイルの保存。ブラウザのダウンロードとして、規約のファイル名で保存する（保存先はブラウザのダウンロード先のフォルダ）。

/**
 * @param file 規約のファイル名
 * @param w ブラウザの window（テストでは差し替える）
 */
export async function saveHtmlFile(file, html, w = window) {
  const url = w.URL.createObjectURL(new w.Blob([html], { type: "text/html" }));
  const a = w.document.createElement("a");
  a.href = url;
  a.download = file;
  a.click();
  w.setTimeout(() => w.URL.revokeObjectURL(url), 60000);
  return { ok: true, name: file };
}
