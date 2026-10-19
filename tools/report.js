// 使い方: node tools/report.js <data.json> <出力フォルダ> [YYYY-MM-DD]
// 進捗レポート(自己完結の HTML)と、Edge ヘッドレスによる PDF を出力する。Edge が見つからなければ HTML だけ出す。
import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { today as localToday, isDate } from "../src/core/dates.js";
import { buildReport as build } from "../src/ui/views/report.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EDGE_PATHS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

/** 自己完結の HTML を作る(スタイルは src/ui/theme.css を読む) */
export function buildReport(data, today) {
  return build(data, today, readFileSync(join(ROOT, "src/ui/theme.css"), "utf8"));
}

function findEdge() {
  return EDGE_PATHS.find((p) => existsSync(p));
}

function main() {
  const [dataPath, outArg, dayArg] = process.argv.slice(2);
  const day = dayArg ?? localToday();
  if (!dataPath || !outArg || !isDate(day)) { console.error("使い方: node tools/report.js <data.json> <出力フォルダ> [YYYY-MM-DD]"); process.exit(2); }
  const outDir = resolve(outArg);
  mkdirSync(outDir, { recursive: true });
  const htmlPath = join(outDir, "report.html");
  writeFileSync(htmlPath, buildReport(JSON.parse(readFileSync(dataPath, "utf8")), day));
  console.log(`HTML を出力しました: ${htmlPath}`);

  const edge = findEdge();
  if (!edge) { console.log("PDF は作れませんでした(Microsoft Edge が見つかりません)。HTML を Edge で開いて印刷から PDF にできます。"); return; }
  const pdfPath = join(outDir, "report.pdf");
  const profile = mkdtempSync(join(tmpdir(), "nwdash-edge-"));
  try {
    const r = spawnSync(edge, ["--headless", "--disable-gpu", "--no-pdf-header-footer", `--user-data-dir=${profile}`, `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href], { timeout: 90000, encoding: "utf8" });
    if (r.status !== 0 || !existsSync(pdfPath)) console.log(`PDF は作れませんでした(Edge の終了コード ${r.status})。HTML は出力済みです。`);
    else console.log(`PDF を出力しました: ${pdfPath}`);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
