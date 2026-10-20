// HTML ファイルの保存。保存ダイアログ(Edge・Chrome)が使えれば、名前と場所を利用者に選ばせる。使えなければダウンロードする。

/**
 * @param file 規約のファイル名（提案する名前）
 * @param w ブラウザの window（テストでは差し替える）
 * @returns { ok: true, how: "picker"|"download", name } か、保存ダイアログでやめたときの { ok: false, cancelled: true }
 */
export async function saveHtmlFile(file, html, w = window) {
  if (typeof w.showSaveFilePicker === "function") {
    try {
      const h = await w.showSaveFilePicker({ suggestedName: file, types: [{ description: "HTML ファイル", accept: { "text/html": [".html"] } }] });
      const out = await h.createWritable();
      await out.write(html);
      await out.close();
      return { ok: true, how: "picker", name: h.name };
    } catch (e) {
      if (e?.name === "AbortError") return { ok: false, cancelled: true };
      // ダイアログが使えない・書き込めないときは、ダウンロードに切り替える
    }
  }
  const url = w.URL.createObjectURL(new w.Blob([html], { type: "text/html" }));
  const a = w.document.createElement("a");
  a.href = url;
  a.download = file;
  a.click();
  w.setTimeout(() => w.URL.revokeObjectURL(url), 60000);
  return { ok: true, how: "download", name: file };
}
