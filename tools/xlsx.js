// 使い方: node tools/xlsx.js <保存先フォルダ> <ファイル.xlsx>
// Excel を読み取って JSON（全シートの行）を標準出力へ出す。読み取りは Python（openpyxl）で行い、
// openpyxl は保存先フォルダ（${CLAUDE_PLUGIN_DATA}）の venv に入れる（プロジェクトのフォルダは汚さない）。
// 終了コード 3: Python が無い、または openpyxl を入れられない（メッセージに CSV での取り込みを案内する）。
import { existsSync } from "node:fs";
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

/** venv と openpyxl を用意する。無いものだけ作る・入れる。戻り値: {ok, python} か {ok:false, message} */
export function ensureEnv(dir, { run = realRun, python, exists = existsSync, platform = process.platform } = {}) {
  const py = venvPython(dir, platform);
  if (!exists(py)) {
    const r = run(python[0], [...python.slice(1), "-m", "venv", join(dir, "venv")]);
    if (r.status !== 0 || !exists(py)) return { ok: false, message: `venv を作れませんでした（${join(dir, "venv")}）。${(r.stderr ?? "").trim()}` };
  }
  if (run(py, ["-c", "import openpyxl"]).status !== 0) {
    const r = run(py, ["-m", "pip", "install", "--quiet", "openpyxl"]);
    if (r.status !== 0) {
      return { ok: false, message: `openpyxl を入れられませんでした（ネットワークかプロキシを確認してください）。Excel を CSV に保存すれば、Python なしで取り込めます。${(r.stderr ?? "").trim()}` };
    }
  }
  return { ok: true, python: py };
}

function main() {
  const [dir, file] = process.argv.slice(2);
  if (!dir || !file) { console.error("使い方: node tools/xlsx.js <保存先フォルダ> <ファイル.xlsx>"); process.exit(2); }
  const python = pickPython();
  if (!python) { console.error("Python 3 が見つかりません。導入するか、Excel を CSV に保存して取り込んでください。"); process.exit(3); }
  const env = ensureEnv(resolve(dir), { python });
  if (!env.ok) { console.error(env.message); process.exit(3); }
  const r = realRun(env.python, [join(HERE, "xlsx_dump.py"), resolve(file)]);
  if (r.error) { console.error(`読み取りに失敗しました: ${r.error.message}`); process.exit(1); }
  process.stdout.write(r.stdout ?? "");
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
