// 使い方: node tools/xlsx.js <保存先フォルダ> <ファイル.xlsx> [--yes]
// Excel を読み取って JSON（全シートの行）を標準出力へ出す。読み取りは Python（openpyxl）で行い、
// openpyxl は保存先フォルダ（${CLAUDE_PLUGIN_DATA}）の venv に入れる（プロジェクトのフォルダは汚さない）。
// 版は requirements.txt で固定する。環境が無い・版がずれているときは、--yes（利用者の承認）が付くまで作らない。
// 終了コード 2: 引数の誤り。3: 環境が使えない（承認待ち、Python が無い、openpyxl を入れられない。メッセージに案内を出す）。
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

/** requirements.txt が固定している openpyxl の版 */
export const readPin = () => /^openpyxl==(\S+)$/m.exec(readFileSync(join(HERE, "..", "requirements.txt"), "utf8"))[1];

/**
 * venv と固定した版の openpyxl を用意する。無いものだけ作る・入れる。
 * 足りないのに approve が無いときは、何もせず {ok:false, needsApproval:true, message}。
 * 戻り値: {ok, python} か {ok:false, message}
 */
export function ensureEnv(dir, { run = realRun, python, exists = existsSync, platform = process.platform, approve = false, pin = readPin() } = {}) {
  const py = venvPython(dir, platform);
  const pinned = exists(py) && run(py, ["-c", `import sys, openpyxl; sys.exit(openpyxl.__version__ != ${JSON.stringify(pin)})`]).status === 0;
  if (pinned) return { ok: true, python: py };
  if (!approve) {
    return { ok: false, needsApproval: true, message: `${exists(py) ? "Excel を読むための openpyxl の版が違います。入れ直してよいか" : "Excel を読むための環境がありません。次を作ってよいか"}、利用者に確認してください。
  場所: ${join(dir, "venv")}
  内容: ${exists(py) ? "" : "Python の venv と "}openpyxl==${pin}（約 20 MB、ネットワークが必要）
承認されたら、同じコマンドに --yes を付けて実行します。承認されないときは、Excel を CSV に保存すれば Python なしで取り込めます。` };
  }
  if (!exists(py)) {
    const r = run(python[0], [...python.slice(1), "-m", "venv", join(dir, "venv")]);
    if (r.status !== 0 || !exists(py)) return { ok: false, message: `venv を作れませんでした（${join(dir, "venv")}）。${(r.stderr ?? "").trim()}` };
  }
  const r = run(py, ["-m", "pip", "install", "--quiet", `openpyxl==${pin}`]);
  if (r.status !== 0) {
    return { ok: false, message: `openpyxl を入れられませんでした（ネットワークかプロキシを確認してください）。Excel を CSV に保存すれば、Python なしで取り込めます。${(r.stderr ?? "").trim()}` };
  }
  return { ok: true, python: py };
}

function main() {
  const args = process.argv.slice(2);
  const approve = args.includes("--yes");
  const [dir, file] = args.filter((a) => a !== "--yes");
  if (!dir || !file) { console.error("使い方: node tools/xlsx.js <保存先フォルダ> <ファイル.xlsx> [--yes]"); process.exit(2); }
  const python = pickPython();
  if (!python) { console.error("Python 3 が見つかりません。導入するか、Excel を CSV に保存して取り込んでください。"); process.exit(3); }
  const env = ensureEnv(resolve(dir), { python, approve });
  if (!env.ok) { console.error(env.message); process.exit(3); }
  const r = realRun(env.python, [join(HERE, "xlsx_dump.py"), resolve(file)]);
  if (r.error) { console.error(`読み取りに失敗しました: ${r.error.message}`); process.exit(1); }
  process.stdout.write(r.stdout ?? "");
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
