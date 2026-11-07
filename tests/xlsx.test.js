import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pickPython, libDir, ensureEnv, readPin } from "../plugins/pj-lens/tools/xlsx.js";

const REPO = fileURLToPath(new URL("../plugins/pj-lens/", import.meta.url));
const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
const ng = { status: 1, stdout: "", stderr: "error" };

test("pickPython: py -3 が使えればそれを、なければ python、python3 の順。Python 2 は選ばない", () => {
  const calls = [];
  const mk = (table) => (cmd, args) => { calls.push([cmd, ...args]); return table[[cmd, ...args].join(" ")] ?? ng; };
  assert.deepEqual(pickPython(mk({ "py -3 --version": ok("Python 3.12.1\n") })), ["py", "-3"]);
  assert.deepEqual(pickPython(mk({ "python --version": ok("Python 3.11.0\n") })), ["python"]);
  assert.deepEqual(pickPython(mk({ "python --version": { status: 0, stdout: "", stderr: "Python 2.7.18\n" }, "python3 --version": ok("Python 3.9.0\n") })), ["python3"]);
  assert.equal(pickPython(mk({})), null);
});

const PIN = "3.1.5";
const calls_of = () => { const calls = []; return { calls, push: (c, a) => calls.push([c, ...a]) }; };
// -c の import 検査: システム側は系の接頭辞（startswith）、専用フォルダ側は固定した版との一致
const isSystemCheck = (a) => a[a.length - 2] === "-c" && a[a.length - 1].includes("startswith");
const isLibCheck = (a) => a[a.length - 2] === "-c" && a[a.length - 1].includes("__version__ ==");

test("libDir: 置き場の下の lib", () => {
  assert.equal(libDir("/d/x"), join("/d/x", "lib"));
});

test("ensureEnv: システムの Python に同じ系の openpyxl があれば、承認なしでも何も入れず、システムを使う", () => {
  const calls = [];
  const r = ensureEnv("/d", { run: (c, a) => { calls.push([c, ...a]); return ok(); }, python: ["python"], exists: () => false, pin: PIN });
  assert.equal(r.ok, true);
  assert.equal(r.source, "system");
  assert.deepEqual(r.env, {});
  assert.equal(calls.length, 1, "import の検査だけ");
  assert.match(calls[0][2], /defusedxml/);
  assert.match(calls[0][2], /et_xmlfile/);
  assert.match(calls[0][2], /startswith\("3\.1\."\)/, "固定した版と同じ系（3.1.x）を許す");
});

test("ensureEnv: システムの版が範囲外／defusedxml が無いなら使わず、専用フォルダに固定した版があればそれを PYTHONPATH で使う", () => {
  const seen = [];
  const run = (c, a, env) => { seen.push({ a, env }); return isSystemCheck(a) ? ng : ok(); };
  const r = ensureEnv("/d", { run, python: ["python"], exists: () => true, pin: PIN });
  assert.equal(r.ok, true);
  assert.equal(r.source, "lib");
  assert.deepEqual(r.env, { PYTHONPATH: libDir("/d") });
  const lib = seen.find((s) => isLibCheck(s.a));
  assert.ok(lib.a[lib.a.length - 1].includes(JSON.stringify(PIN)), "専用フォルダは固定した版と一致を見る");
  assert.deepEqual(lib.env, { PYTHONPATH: libDir("/d") });
});

test("ensureEnv: どちらも無く、承認(approve)なしのときは、何も入れず needsApproval で止まり、入れ先と内容を案内する", () => {
  const calls = [];
  const r = ensureEnv("/d/data dir", { run: (c, a) => { calls.push([c, ...a]); return ng; }, python: ["python"], exists: () => false, pin: PIN });
  assert.equal(r.ok, false);
  assert.equal(r.needsApproval, true);
  assert.match(r.message, /data dir/);
  assert.match(r.message, /lib/);
  assert.match(r.message, new RegExp(`openpyxl==${PIN}`));
  assert.match(r.message, /venv は作りません/);
  assert.match(r.message, /--yes/);
  assert.ok(calls.every(([, ...a]) => !a.includes("pip")), "承認前は pip を実行しない");
});

test("ensureEnv: 承認済みなら pip で専用フォルダへ入れる（--require-hashes・--target）。空白を含む置き場も1つの引数のまま", () => {
  const dir = join(tmpdir(), "pjl x", "data dir");
  const calls = [];
  const run = (cmd, args) => { calls.push([cmd, ...args]); return isSystemCheck(args) || isLibCheck(args) ? ng : ok(); };
  const r = ensureEnv(dir, { run, python: ["py", "-3"], exists: () => false, approve: true, pin: PIN, requirements: "/req uirements.txt" });
  assert.equal(r.ok, true);
  assert.equal(r.source, "lib");
  assert.deepEqual(r.env, { PYTHONPATH: libDir(dir) });
  const install = calls.find((c) => c.includes("install"));
  assert.deepEqual(install, ["py", "-3", "-m", "pip", "install", "--quiet", "--require-hashes", "--target", libDir(dir), "-r", "/req uirements.txt"]);
  assert.ok(!calls.some((c) => c.includes("venv")), "venv は作らない");
});

test("ensureEnv: 版のずれた専用フォルダは、消してから入れ直す。消せなければ、消せなかったと案内して ok:false", () => {
  const removed = [];
  const run = (c, a) => (isSystemCheck(a) || isLibCheck(a) ? ng : ok());
  const r = ensureEnv("/d", { run, python: ["python"], exists: () => true, approve: true, pin: PIN, remove: (p) => removed.push(p) });
  assert.equal(r.ok, true);
  assert.deepEqual(removed, [libDir("/d")]);
  const b = ensureEnv("/d", { run, python: ["python"], exists: () => true, approve: true, pin: PIN, remove: () => { throw new Error("EBUSY"); } });
  assert.equal(b.ok, false);
  assert.match(b.message, /消せませんでした/);
  assert.match(b.message, /EBUSY/);
});

test("ensureEnv: 承認済みでも pip が使えない／pip install が失敗したら ok:false（needsApproval でない）で CSV を案内する", () => {
  const noPip = (c, a) => (a.includes("pip") || isSystemCheck(a) || isLibCheck(a) ? ng : ok());
  const a = ensureEnv("/d", { run: noPip, python: ["python"], exists: () => false, approve: true, pin: PIN });
  assert.equal(a.ok, false);
  assert.notEqual(a.needsApproval, true);
  assert.match(a.message, /pip が使えません/);
  assert.match(a.message, /CSV/);
  const offline = (c, a) => (a.includes("install") || isSystemCheck(a) || isLibCheck(a) ? ng : ok());
  const b = ensureEnv("/d", { run: offline, python: ["python"], exists: () => false, approve: true, pin: PIN });
  assert.equal(b.ok, false);
  assert.match(b.message, /CSV/);
  assert.match(b.message, /openpyxl/);
});

test("ensureEnv: Python が無いときは、承認なしなら needsApproval、承認済みなら Python が無いと案内して失敗する", () => {
  const run = () => ng;
  assert.equal(ensureEnv("/d", { run, python: null, exists: () => false, approve: false, pin: PIN }).needsApproval, true);
  const b = ensureEnv("/d", { run, python: null, exists: () => false, approve: true, pin: PIN });
  assert.equal(b.ok, false);
  assert.match(b.message, /Python 3 が見つかりません/);
});

test("requirements.txt: openpyxl と et_xmlfile を == で固定し、すべてハッシュ付き", () => {
  const text = readFileSync(join(REPO, "requirements.txt"), "utf8");
  assert.match(text, /^openpyxl==\d+\.\d+\.\d+ \\\r?\n\s+--hash=sha256:[0-9a-f]{64}/m);
  assert.match(text, /^et_xmlfile==\d+\.\d+\.\d+ \\\r?\n\s+--hash=sha256:[0-9a-f]{64}/m);
  assert.match(text, /^defusedxml==\d+\.\d+\.\d+ \\\r?\n\s+--hash=sha256:[0-9a-f]{64}/m, "細工した xlsx の XML 爆弾を防ぐ（openpyxl は、入っているときだけ使う）");
  assert.equal(readPin(), /^openpyxl==(\S+)/m.exec(text)[1]);
});

test("統合: fixtures/wbs-merged.xlsx を読むと結合セルが展開され、日付が YYYY-MM-DD になる（Python 3 が無い環境だけ skip）", (t) => {
  const real = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });
  if (!pickPython(real)) return t.skip("Python 3 が見つかりません");
  const fixture = fileURLToPath(new URL("fixtures/wbs-merged.xlsx", import.meta.url));
  assert.ok(existsSync(fixture), "fixture がありません");
  const dataDir = join(tmpdir(), "pjlens-test-xlsx"); // 2回目以降は venv を使い回す
  const r = spawnSync(process.execPath, [join(REPO, "tools/xlsx.js"), "--data", dataDir, fixture, "--yes"], { encoding: "utf8", timeout: 300000 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.sheets.length, 3);
  const rows = out.sheets[0].rows;
  const flat = rows.flat();
  assert.ok(flat.includes("設計"), "大項目");
  assert.equal(rows.filter((row) => row.includes("設計")).length, 3, "結合セルの大項目が縦に展開される");
  assert.ok(flat.some((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)), "日付は YYYY-MM-DD");
  assert.ok(flat.includes("機器選定"), "前後の全角スペースが除かれる");
  assert.deepEqual(out.sheets[1].indents, [0, 0, 2, 4, 4, 0, 2], "インデントで階層を表す行は、先頭の空白の数を indents で返す");
  assert.deepEqual(out.sheets[1].rows[2], ["要件", null], "文字列は空白を除いて返す");
});

import { realRun } from "../plugins/pj-lens/tools/xlsx.js";

test("realRun: 1MB を超える標準出力でも切れずに受け取れる（横に長い WBS の JSON を想定）", () => {
  const r = realRun(process.execPath, ["-e", "process.stdout.write('x'.repeat(5 * 1024 * 1024))"]);
  assert.equal(r.status, 0, String(r.error));
  assert.equal(r.stdout.length, 5 * 1024 * 1024);
});

test("統合: 非表示の行・列は読み取らず、件数を hiddenRows・hiddenColumns で返す", (t) => {
  const real = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });
  if (!pickPython(real)) return t.skip("Python 3 が見つかりません");
  const dataDir = join(tmpdir(), "pjlens-test-xlsx");
  const r = spawnSync(process.execPath, [join(REPO, "tools/xlsx.js"), "--data", dataDir, fileURLToPath(new URL("fixtures/wbs-merged.xlsx", import.meta.url)), "--yes"], { encoding: "utf8", timeout: 300000 });
  assert.equal(r.status, 0, r.stderr);
  const sh = JSON.parse(r.stdout).sheets[2];
  const flat = sh.rows.flat();
  assert.ok(flat.includes("表示される行") && flat.includes("表示される列"));
  assert.ok(!flat.includes("隠れた行") && !flat.includes("隠れた列") && !flat.includes("隠れた行の期限"));
  assert.deepEqual([sh.hiddenRows, sh.hiddenColumns], [1, 1]);
  assert.deepEqual(sh.rows[0], ["項目", "期限"], "非表示の列を除いて詰める");
  assert.equal(JSON.parse(r.stdout).sheets[0].hiddenRows, 0);
});

// --- doctor / setup / 置き場の優先順 (A6・A7・H5) ---
import { mkdtempSync, rmSync } from "node:fs";
import { after } from "node:test";
import { diagnose } from "../plugins/pj-lens/tools/xlsx.js";

const XLSX_JS = join(REPO, "tools/xlsx.js");
const scratch = mkdtempSync(join(tmpdir(), "pjl-xlsx-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
// PJ_LENS_HOME が開発者の環境に残っていても影響しないよう、テストごとに明示する
const cli = (args, env = {}) => spawnSync(process.execPath, [XLSX_JS, ...args], { encoding: "utf8", timeout: 300000, env: { ...process.env, PJ_LENS_HOME: "", ...env } });

test("置き場が決まらないときは終了コード 2（doctor・setup・読み取り）", () => {
  for (const args of [["doctor"], ["setup"], ["x.xlsx"]]) {
    const r = cli(args);
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, /PJ_LENS_HOME/);
    assert.match(r.stderr, /--data/);
  }
});

test("引数の誤りは終了コード 2（引数なし・サブコマンドに余分な引数）", () => {
  assert.equal(cli([]).status, 2);
  assert.equal(cli(["doctor", "余分", "--data", join(scratch, "a")]).status, 2);
});

test("置き場の優先順: PJ_LENS_HOME が --data に勝つ。位置引数では渡せない（終了コード 2）", () => {
  const home = join(scratch, "env home");
  const r = cli(["doctor", "--data", join(scratch, "arg")], { PJ_LENS_HOME: home });
  assert.equal(r.status, 3);
  assert.ok(r.stdout.includes(home), r.stdout);
  assert.ok(!r.stdout.includes(join(scratch, "arg")));
  assert.ok(cli(["doctor", "--data", join(scratch, "arg")]).stdout.includes(join(scratch, "arg")), "環境変数がなければ --data");
  assert.equal(cli([join(scratch, "arg"), "doctor"]).status, 2);
  assert.equal(cli([join(scratch, "arg"), "x.xlsx"]).status, 2);
});

test("diagnose: システムに同じ系があれば使える。無く専用フォルダに固定した版があれば使える。どちらも無ければ usable:false で案内。何も入れない", () => {
  const calls = [];
  const mk = (sys, lib) => (c, a) => { calls.push([c, ...a]); if (a.includes("-c") && a[a.length - 1].includes("openpyxl")) return (isSystemCheck(a) ? sys : lib) ? ok() : ng; return { status: 0, stdout: "C:\\Python\\python.exe\n", stderr: "" }; };
  const sys = diagnose("/d", { run: mk(true, false), python: ["py", "-3"], exists: () => false, pin: PIN });
  assert.equal(sys.usable, true);
  assert.match(sys.lines.join("\n"), /システムの Python/);
  const lib = diagnose("/d", { run: mk(false, true), python: ["py", "-3"], exists: () => true, pin: PIN });
  assert.equal(lib.usable, true);
  assert.match(lib.lines.join("\n"), /専用フォルダ/);
  const none = diagnose("/d", { run: mk(false, false), python: ["py", "-3"], exists: () => false, pin: PIN });
  assert.equal(none.usable, false);
  assert.match(none.lines.join("\n"), /setup/);
  assert.match(none.lines.join("\n"), /C:\\Python\\python\.exe/, "使う Python のパス");
  assert.ok(calls.every(([, ...a]) => !a.includes("pip") && !a.includes("install")), "診断は何も入れない");
});

test("統合: 空白と日本語を含む置き場で doctor が動き、setup は --yes なしでは何も作らない。--yes で入れ、doctor が 0 になる（Python 3 が無い環境、またはシステムに使える openpyxl がある環境は skip）", (t) => {
  const real = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });
  if (!pickPython(real)) return t.skip("Python 3 が見つかりません");
  const home = join(scratch, "利用者 名", "データ 置き場");
  let r = cli(["doctor", "--data", home]);
  if (r.status === 0) return t.skip("システムの Python に使える openpyxl があるため、専用フォルダへ入れる経路を試せません");
  assert.equal(r.status, 3, r.stderr);
  assert.ok(r.stdout.includes(home), r.stdout);
  assert.match(r.stdout, /Python: .+/);
  assert.equal(existsSync(home), false, "doctor は何も作らない");
  r = cli(["setup", "--data", home]);
  assert.equal(r.status, 3);
  assert.ok(r.stderr.includes(home) && /openpyxl==/.test(r.stderr) && /--yes/.test(r.stderr), r.stderr);
  assert.equal(existsSync(home), false, "承認なしでは作らない");
  r = cli(["setup", "--yes", "--data", home]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(join(home, "venv")), false, "venv は作らない");
  assert.equal(existsSync(libDir(home)), true);
  r = cli(["doctor"], { PJ_LENS_HOME: home });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /使えます/);
  const fixture = fileURLToPath(new URL("fixtures/wbs-merged.xlsx", import.meta.url));
  r = cli([fixture, "--data", home]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).sheets.length, 3);
});

test("統合: fixtures/wbs-stray-cell.xlsx（範囲が A1:XFD1048576 まで広がる、遠い隅のセル）でも、止まらずに 2 行を読む（Python 3 が無い環境だけ skip）", (t) => {
  const real = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });
  if (!pickPython(real)) return t.skip("Python 3 が見つかりません");
  const fixture = fileURLToPath(new URL("fixtures/wbs-stray-cell.xlsx", import.meta.url));
  const dataDir = join(tmpdir(), "pjlens-test-xlsx");
  const r = spawnSync(process.execPath, [join(REPO, "tools/xlsx.js"), "--data", dataDir, fixture, "--yes"], { encoding: "utf8", timeout: 300000 });
  assert.equal(r.status, 0, `${r.error ?? ""}${r.stderr}`);
  const sheet = JSON.parse(r.stdout).sheets[0];
  assert.deepEqual(sheet.rows[0].slice(0, 2), ["件名", "期限"]);
  assert.deepEqual(sheet.rows[1].slice(0, 2), ["A", "2026-11-01"]);
  assert.equal(sheet.rows.length, 2, "遠い隅の空のセルだけの行は、末尾の空行として除く");
  assert.equal(sheet.truncated, true, "読む範囲（5000 行 × 200 列）を超えて切ったことを知らせる");
});
