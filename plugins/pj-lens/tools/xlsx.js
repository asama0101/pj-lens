// 使い方:
//   node tools/xlsx.js doctor [--data <置き場>]            診断のみ（何も変更しない）。使う Python のパスと、読み取りに使うパッケージの場所を表示する
//   node tools/xlsx.js setup [--yes] [--data <置き場>]     専用フォルダ（<置き場>/lib）へ openpyxl を入れる。--yes なしは入れ先と内容を表示して終了コード 3
//   node tools/xlsx.js <ファイル.xlsx> [--yes] [--data <置き場>]  Excel を JSON（全シートの行）で標準出力へ出す
// 置き場は、環境変数 PJ_LENS_HOME が最優先、次に --data（${CLAUDE_PLUGIN_DATA}）。どちらもなければ終了コード 2。
// 読み取りは Python（openpyxl）で行う。使う openpyxl は、次の順で決める（venv は作らない）。
//   1. システムの Python に、固定した版と同じ 3.x.y 系の openpyxl と、et_xmlfile・defusedxml が入っていれば、それを使う（何も入れない）。
//   2. <置き場>/lib に、固定した版が入っていれば、それを PYTHONPATH で指して使う。
//   3. どちらもなければ、承認（--yes）が付くまで入れない。承認後に pip install --require-hashes --target <置き場>/lib で入れる（プロジェクトのフォルダは汚さない）。
// 版とハッシュは requirements.txt で固定する。
// 終了コード 0: 成功 / 1: 実行時のエラー / 2: 引数・設定のエラー / 3: 読み取りの環境が使えない（未作成・版のずれ・壊れている・承認待ち・Python が無い）。
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { takeData, pickHome, NO_HOME_MESSAGE } from "./home.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [["py", "-3"], ["python"], ["python3"]];

/** シェルを経由せず、引数は配列のまま渡す。env は、追加する環境変数 */
// maxBuffer: 横に長い WBS の JSON は 1MB を超えうる(既定のままだと途中で切れる)
export const realRun = (cmd, args, env = {}) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: "utf-8", ...env } });

/** 使える Python 3 の起動コマンド（配列）。無ければ null。run(cmd, args) は {status, stdout, stderr} を返す */
export function pickPython(run = realRun) {
  for (const c of CANDIDATES) {
    const r = run(c[0], [...c.slice(1), "--version"]);
    if (r.status === 0 && /Python 3/.test(`${r.stdout}${r.stderr}`)) return c;
  }
  return null;
}

/** 専用フォルダ（pip install --target の入れ先） */
export const libDir = (dir) => join(dir, "lib");

/** requirements.txt（ハッシュ付きで固定）の場所 */
export const REQUIREMENTS = join(HERE, "..", "requirements.txt");

/** requirements.txt が固定している openpyxl の版 */
export const readPin = () => /^openpyxl==(\S+)/m.exec(readFileSync(REQUIREMENTS, "utf8"))[1];

/** Python の最低版（openpyxl 3.1.5 の要件） */
export const MIN_PYTHON = [3, 8];
const PROBE = "import sys; print(sys.executable); sys.exit(0 if sys.version_info >= (" + MIN_PYTHON.join(", ") + ") else 4)";

/** 使う Python の実パスと、最低版を満たすか。{path, ready, note} */
export function probePython(python, run = realRun) {
  const r = run(python[0], [...python.slice(1), "-c", PROBE]);
  const path = (r.stdout ?? "").trim().split(/\r?\n/)[0] || python.join(" ");
  if (r.status === 0) return { path, ready: true, note: "" };
  return { path, ready: false, note: "Python " + MIN_PYTHON.join(".") + " 以上が必要です（この Python では足りません）。" };
}

/** 固定した版と同じ 3.x. の接頭辞（システムの openpyxl に許す範囲） */
const seriesPrefix = (pin) => pin.split(".").slice(0, 2).join(".") + ".";

/** defusedxml（細工した xlsx の XML 爆弾を防ぐ）と et_xmlfile も import できることを、版の検査と合わせて確かめる */
const importCode = (cond) => "import sys, openpyxl, et_xmlfile, defusedxml; sys.exit(0 if " + cond + " else 1)";

/** システムの Python が、同じ系の openpyxl を使えるか */
const systemUsable = (python, pin, run) => run(python[0], [...python.slice(1), "-c", importCode("openpyxl.__version__.startswith(" + JSON.stringify(seriesPrefix(pin)) + ")")]).status === 0;

/** 専用フォルダに、固定した版が入っているか */
const libUsable = (python, dir, pin, run, exists) => exists(libDir(dir)) && run(python[0], [...python.slice(1), "-c", importCode("openpyxl.__version__ == " + JSON.stringify(pin))], { PYTHONPATH: libDir(dir) }).status === 0;

/** 使うパッケージの場所。{source: "system" | "lib" | null, env}。env は読み取りの Python に足す環境変数 */
function locate(dir, python, pin, run, exists) {
  if (!python) return { source: null, env: {} };
  if (systemUsable(python, pin, run)) return { source: "system", env: {} };
  if (libUsable(python, dir, pin, run, exists)) return { source: "lib", env: { PYTHONPATH: libDir(dir) } };
  return { source: null, env: {} };
}

/**
 * 診断のみ（何も変更しない）。戻り値: {usable, lines}。usable は、読み取りに使える openpyxl があること
 */
export function diagnose(dir, { run = realRun, python, exists = existsSync, pin = readPin() } = {}) {
  const probe = python ? probePython(python, run) : null;
  const found = locate(dir, probe?.ready ? python : null, pin, run, exists);
  const usable = found.source !== null;
  const where = found.source === "system" ? "システムの Python にあります（" + seriesPrefix(pin) + "x 系）" : found.source === "lib" ? "専用フォルダにあります（" + libDir(dir) + "）" : "使える openpyxl がありません（システムにも専用フォルダにも、版が合うものが無い。defusedxml も必要）";
  const lines = [
    "置き場: " + dir,
    "Python: " + (probe ? probe.path + (probe.ready ? "" : "（" + probe.note + "）") : "見つかりません（Python 3 を入れてください）"),
    "openpyxl: " + where,
    "状態: " + (usable ? "使えます" : "読み取りの環境が使えません。node tools/xlsx.js setup --data <置き場> で入れ先と内容を確認し、承認後に --yes を付けて実行してください"),
  ];
  return { usable, lines };
}

/**
 * 読み取りに使う openpyxl を用意する。システムにあればそれを、なければ専用フォルダを使い、無いときだけ入れる。
 * 足りないのに approve が無いときは、何もせず {ok:false, needsApproval:true, message}。
 * 戻り値: {ok, python（起動コマンドの配列）, env, source} か {ok:false, message}
 */
export function ensureEnv(dir, { run = realRun, python, exists = existsSync, approve = false, pin = readPin(), requirements = REQUIREMENTS, pythonLabel = python?.join(" "), remove = (p) => rmSync(p, { recursive: true, force: true }) } = {}) {
  const found = locate(dir, python, pin, run, exists);
  if (found.source) return { ok: true, python, env: found.env, source: found.source };
  const lib = libDir(dir);
  if (!approve) {
    return { ok: false, needsApproval: true, message: "Excel を読むための openpyxl が、システムの Python にも専用フォルダにもありません（版が違う、または defusedxml が無い場合を含みます）。次を入れてよいか、利用者に確認してください。\n" +
      "  場所: " + lib + "\n" +
      "  内容: openpyxl==" + pin + "（依存の et_xmlfile と、細工した Excel の XML の爆弾を防ぐ defusedxml も、ハッシュを固定して入れます。約 20 MB、ネットワークが必要）。venv は作りません\n" +
      "  使う Python: " + (pythonLabel ?? "見つかりません") + "（" + MIN_PYTHON.join(".") + " 以上、pip が必要）\n" +
      "承認されたら、setup に --yes を付けて実行します（node tools/xlsx.js setup --yes --data <置き場>）。承認されないときは、Excel を CSV に保存すれば Python なしで取り込めます。" };
  }
  if (!python) return { ok: false, message: "Python 3 が見つかりません。導入するか、Excel を CSV に保存して取り込んでください。" };
  if (run(python[0], [...python.slice(1), "-m", "pip", "--version"]).status !== 0) {
    return { ok: false, message: "pip が使えません。" + MIN_PYTHON.join(".") + " 以上の Python と pip が必要です。pip を使える状態にするか、Excel を CSV に保存して取り込んでください。" };
  }
  if (exists(lib)) { // 版のずれた・壊れた専用フォルダは、消して入れ直す（--target は、既にあるものを上書きしない）
    try { remove(lib); } catch (e) {
      return { ok: false, message: "古い専用フォルダを消せませんでした（" + lib + "）。使用中のプログラムを閉じるか、フォルダを手で消してから、もう一度実行してください。" + e.message };
    }
  }
  const r = run(python[0], [...python.slice(1), "-m", "pip", "install", "--quiet", "--require-hashes", "--target", lib, "-r", requirements]);
  if (r.status !== 0) {
    return { ok: false, message: "openpyxl を入れられませんでした（ネットワークかプロキシを確認してください）。Excel を CSV に保存すれば、Python なしで取り込めます。" + (r.stderr ?? "").trim() };
  }
  return { ok: true, python, env: { PYTHONPATH: lib }, source: "lib" };
}

const SUBCOMMANDS = ["doctor", "setup"];
const USAGE = "使い方: node tools/xlsx.js doctor | setup [--yes] | <ファイル.xlsx> [--yes]（置き場は PJ_LENS_HOME か --data <置き場>）";

function main() {
  const { data, rest: all } = takeData(process.argv.slice(2));
  const approve = all.includes("--yes");
  const rest = all.filter((a) => a !== "--yes");
  const sub = SUBCOMMANDS.includes(rest[0]) ? rest.shift() : null;
  const file = sub ? null : rest[0];
  if (rest.length !== (sub ? 0 : 1)) { console.error(USAGE); process.exit(2); }
  const home = pickHome(data);
  if (!home) { console.error(NO_HOME_MESSAGE); process.exit(2); }
  const dir = resolve(home);
  const python = pickPython();

  if (sub === "doctor") {
    const d = diagnose(dir, { python });
    console.log(d.lines.join("\n"));
    process.exitCode = d.usable ? 0 : 3;
    return;
  }
  // システムか専用フォルダにあれば、承認は要らない。入れるときだけ、Python が最低版を満たし、pip が使える必要がある
  const probe = python ? probePython(python) : null;
  const env = ensureEnv(dir, { python: probe?.ready ? python : null, approve, pythonLabel: probe?.path });
  if (!env.ok) { console.error(env.message + (probe && !probe.ready ? "\n" + probe.note : "")); process.exit(3); }
  if (sub === "setup") { console.log("読み取りの環境を使えます（" + (env.source === "system" ? "システムの Python" : libDir(dir)) + "）"); return; }
  const r = realRun(env.python[0], [...env.python.slice(1), join(HERE, "xlsx_dump.py"), resolve(file)], env.env);
  if (r.error) { console.error("読み取りに失敗しました: " + r.error.message); process.exit(1); }
  process.stdout.write(r.stdout ?? "");
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
