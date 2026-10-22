// 使い方:
//   node tools/xlsx.js doctor [--data <置き場>]            診断のみ（何も変更しない）。使う Python のパスと置き場を表示する
//   node tools/xlsx.js setup [--yes] [--data <置き場>]     専用環境（venv + openpyxl）を作る。--yes なしは作成先と内容を表示して終了コード 3
//   node tools/xlsx.js <置き場> <ファイル.xlsx> [--yes]    Excel を JSON（全シートの行）で標準出力へ出す（従来の呼び出し。--data <置き場> <ファイル> でもよい）
// 置き場は、環境変数 PJ_LENS_HOME が最優先、次に引数（${CLAUDE_PLUGIN_DATA}）。どちらもなければ終了コード 2。
// 読み取りは Python（openpyxl）で行い、openpyxl は置き場の venv に入れる（プロジェクトのフォルダは汚さない）。
// 版とハッシュは requirements.txt で固定する。環境が無い・版がずれているときは、承認（setup --yes）が付くまで作らない。
// 終了コード 0: 成功 / 1: 実行時のエラー / 2: 引数・設定のエラー / 3: 専用環境が使えない（未作成・版のずれ・壊れている・承認待ち・Python が無い）。
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { takeData, pickHome, NO_HOME_MESSAGE } from "./home.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [["py", "-3"], ["python"], ["python3"]];

/** シェルを経由せず、引数は配列のまま渡す */
// maxBuffer: 横に長い WBS の JSON は 1MB を超えうる(既定のままだと途中で切れる)
export const realRun = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });

/** 使える Python 3 の起動コマンド（配列）。無ければ null。run(cmd, args) は {status, stdout, stderr} を返す */
export function pickPython(run = realRun) {
  for (const c of CANDIDATES) {
    const r = run(c[0], [...c.slice(1), "--version"]);
    if (r.status === 0 && /Python 3/.test(`${r.stdout}${r.stderr}`)) return c;
  }
  return null;
}

/** venv の Python のパス */
export function venvPython(dir, platform = process.platform) {
  return platform === "win32" ? join(dir, "venv", "Scripts", "python.exe") : join(dir, "venv", "bin", "python");
}

/** requirements.txt（ハッシュ付きで固定）の場所 */
export const REQUIREMENTS = join(HERE, "..", "requirements.txt");

/** requirements.txt が固定している openpyxl の版 */
export const readPin = () => /^openpyxl==(\S+)/m.exec(readFileSync(REQUIREMENTS, "utf8"))[1];

/** 専用環境を作る元の Python の最低版（openpyxl 3.1.5 の要件）。venv・ensurepip が使えることも確かめる */
export const MIN_PYTHON = [3, 8];
const PROBE = "import sys, venv, ensurepip; print(sys.executable); sys.exit(0 if sys.version_info >= (" + MIN_PYTHON.join(", ") + ") else 4)";

/** 作成元の Python の実パスと、venv・ensurepip・最低版が足りているか。{path, ready, note} */
export function probePython(python, run = realRun) {
  const r = run(python[0], [...python.slice(1), "-c", PROBE]);
  const path = (r.stdout ?? "").trim().split(/\r?\n/)[0] || python.join(" ");
  if (r.status === 0) return { path, ready: true, note: "" };
  return { path, ready: false, note: "Python " + MIN_PYTHON.join(".") + " 以上、かつ venv・ensurepip が必要です（この Python では足りません）。" };
}

/** venv の openpyxl が固定した版か */
const isPinned = (py, pin, run, exists) => exists(py) && run(py, ["-c", "import sys, openpyxl; sys.exit(openpyxl.__version__ != " + JSON.stringify(pin) + ")"]).status === 0;

/**
 * 診断のみ（何も変更しない）。戻り値: {usable, lines}。usable は専用環境が固定した版で使えること
 */
export function diagnose(dir, { run = realRun, python, exists = existsSync, platform = process.platform, pin = readPin() } = {}) {
  const py = venvPython(dir, platform);
  const usable = isPinned(py, pin, run, exists);
  const probe = python ? probePython(python, run) : null;
  const lines = [
    "置き場: " + dir,
    "専用環境の Python: " + py + "（" + (exists(py) ? "あります" : "ありません") + "）",
    "openpyxl: " + (usable ? "==" + pin + " で使えます" : "==" + pin + " が入っていません（未作成・版のずれ・壊れている）"),
    "作成元の Python: " + (probe ? probe.path + (probe.ready ? "" : "（" + probe.note + "）") : "見つかりません（Python 3 を入れてください）"),
    "状態: " + (usable ? "使えます" : "専用環境が使えません。node tools/xlsx.js setup --data <置き場> で作成先と内容を確認し、承認後に --yes を付けて実行してください"),
  ];
  return { usable, lines };
}

/**
 * venv と固定した版の openpyxl を用意する。無いものだけ作る・入れる。
 * 足りないのに approve が無いときは、何もせず {ok:false, needsApproval:true, message}。
 * 戻り値: {ok, python} か {ok:false, message}
 */
export function ensureEnv(dir, { run = realRun, python, exists = existsSync, platform = process.platform, approve = false, pin = readPin(), requirements = REQUIREMENTS, pythonLabel = python?.join(" ") } = {}) {
  const py = venvPython(dir, platform);
  if (isPinned(py, pin, run, exists)) return { ok: true, python: py };
  if (!approve) {
    return { ok: false, needsApproval: true, message: (exists(py) ? "Excel を読むための openpyxl の版が違います。入れ直してよいか" : "Excel を読むための環境がありません。次を作ってよいか") + "、利用者に確認してください。\n" +
      "  場所: " + join(dir, "venv") + "\n" +
      "  内容: " + (exists(py) ? "" : "Python の venv と ") + "openpyxl==" + pin + "（依存の et_xmlfile も、ハッシュを固定して入れます。約 20 MB、ネットワークが必要）\n" +
      "  作成元の Python: " + (pythonLabel ?? "見つかりません") + "（" + MIN_PYTHON.join(".") + " 以上、venv・ensurepip が必要）\n" +
      "承認されたら、setup に --yes を付けて実行します（node tools/xlsx.js setup --yes --data <置き場>）。承認されないときは、Excel を CSV に保存すれば Python なしで取り込めます。" };
  }
  if (!exists(py)) {
    if (!python) return { ok: false, message: "Python 3 が見つかりません。導入するか、Excel を CSV に保存して取り込んでください。" };
    const r = run(python[0], [...python.slice(1), "-m", "venv", join(dir, "venv")]);
    if (r.status !== 0 || !exists(py)) return { ok: false, message: "venv を作れませんでした（" + join(dir, "venv") + "）。" + MIN_PYTHON.join(".") + " 以上の Python と、venv・ensurepip が必要です。" + (r.stderr ?? "").trim() };
  }
  const r = run(py, ["-m", "pip", "install", "--quiet", "--require-hashes", "-r", requirements]);
  if (r.status !== 0) {
    return { ok: false, message: "openpyxl を入れられませんでした（ネットワークかプロキシを確認してください）。Excel を CSV に保存すれば、Python なしで取り込めます。" + (r.stderr ?? "").trim() };
  }
  return { ok: true, python: py };
}

const SUBCOMMANDS = ["doctor", "setup"];
const USAGE = "使い方: node tools/xlsx.js doctor | setup [--yes] | <置き場> <ファイル.xlsx> [--yes]（置き場は PJ_LENS_HOME か --data <置き場>）";

function main() {
  const { data, rest: all } = takeData(process.argv.slice(2));
  const approve = all.includes("--yes");
  const rest = all.filter((a) => a !== "--yes");
  let sub = SUBCOMMANDS.includes(rest[0]) ? rest.shift() : null;
  let legacyDir = null;
  if (!sub && rest.length === 2 && SUBCOMMANDS.includes(rest[1])) { legacyDir = rest.shift(); sub = rest.shift(); } // <置き場> doctor
  else if (!sub && rest.length >= 2) legacyDir = rest.shift(); // 従来の「<置き場> <ファイル>」
  const file = sub ? null : rest[0];
  if (sub && rest.length) { console.error(USAGE); process.exit(2); }
  if (!sub && !file) { console.error(USAGE); process.exit(2); }
  const home = pickHome(data || legacyDir);
  if (!home) { console.error(NO_HOME_MESSAGE); process.exit(2); }
  const dir = resolve(home);
  const python = pickPython();

  if (sub === "doctor") {
    const d = diagnose(dir, { python });
    console.log(d.lines.join("\n"));
    process.exitCode = d.usable ? 0 : 3;
    return;
  }
  // 環境が既にあれば Python は要らない。作る・入れ直すときだけ、作成元の Python が最低版・venv・ensurepip を満たす必要がある
  const probe = python ? probePython(python) : null;
  const env = ensureEnv(dir, { python: probe?.ready ? python : null, approve, pythonLabel: probe?.path });
  if (!env.ok) { console.error(env.message + (probe && !probe.ready ? "\n" + probe.note : "")); process.exit(3); }
  if (sub === "setup") { console.log("専用環境を使えます: " + env.python); return; }
  const r = realRun(env.python, [join(HERE, "xlsx_dump.py"), resolve(file)]);
  if (r.error) { console.error("読み取りに失敗しました: " + r.error.message); process.exit(1); }
  process.stdout.write(r.stdout ?? "");
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
