import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pickPython, venvPython, ensureEnv, readPin } from "../plugins/pj-lens/tools/xlsx.js";

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

test("venvPython: win32 と linux でパスが違う", () => {
  assert.match(venvPython("C:\\d\\x", "win32"), /venv[\\/]Scripts[\\/]python\.exe$/);
  assert.match(venvPython("/d/x", "linux"), /venv[\\/]bin[\\/]python$/);
});

const PIN = "3.1.5";

test("ensureEnv: 承認(approve)なしで環境が足りないときは、何も作らず needsApproval で止まり、作成先と内容を案内する", () => {
  const calls = [];
  const r = ensureEnv("/d/data dir", { run: (c, a) => { calls.push([c, ...a]); return ng; }, python: ["python"], exists: () => false, platform: "linux", pin: PIN });
  assert.equal(r.ok, false);
  assert.equal(r.needsApproval, true);
  assert.match(r.message, /data dir/);
  assert.match(r.message, new RegExp(`openpyxl==${PIN}`));
  assert.match(r.message, /--yes/);
  assert.equal(calls.length, 0, "承認前は何も実行しない");
});

test("ensureEnv: 承認済みなら venv を作り、版を固定して pip install する（呼び出し順を検査）。dataDir の空白は1つの引数のまま", () => {
  const dir = join(tmpdir(), "pjl x", "data dir");
  const calls = [];
  let made = false;
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args.includes("venv")) made = true;
    return ok();
  };
  const r = ensureEnv(dir, { run, python: ["py", "-3"], exists: () => made, platform: "win32", approve: true, pin: PIN, requirements: "/req uirements.txt" });
  assert.equal(r.ok, true);
  assert.deepEqual(calls[0], ["py", "-3", "-m", "venv", join(dir, "venv")]);
  assert.deepEqual(calls[1].slice(1), ["-m", "pip", "install", "--quiet", "--require-hashes", "-r", "/req uirements.txt"], "ハッシュ付きの requirements.txt から入れる");
  assert.equal(r.python, venvPython(dir, "win32"));
});

test("ensureEnv: venv と固定した版の openpyxl があれば、承認なしでも何も作らず入れない", () => {
  const calls = [];
  const r = ensureEnv("/d", { run: (c, a) => { calls.push([c, ...a]); return ok(); }, python: ["python"], exists: () => true, platform: "linux", pin: PIN });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0][2].includes(PIN), "固定した版を照合する");
});

test("ensureEnv: 版がずれた openpyxl は、承認なしでは needsApproval で止まる", () => {
  const r = ensureEnv("/d", { run: (c, a) => (a[0] === "-c" ? ng : ok()), python: ["python"], exists: () => true, platform: "linux", pin: PIN });
  assert.equal(r.needsApproval, true);
  assert.doesNotMatch(r.message, /環境がありません/, "venv はあるので、入れ直すのは openpyxl だけと案内する");
  assert.match(r.message, new RegExp(`openpyxl==${PIN}`));
});

test("ensureEnv: 承認済みでも venv を作れない／pip が失敗したら ok:false（needsApproval でない）で CSV を案内する", () => {
  const a = ensureEnv("/d", { run: () => ng, python: ["python"], exists: () => false, platform: "linux", approve: true, pin: PIN });
  assert.equal(a.ok, false);
  assert.notEqual(a.needsApproval, true);
  assert.match(a.message, /venv/);
  const b = ensureEnv("/d", { run: (c, args) => (args.includes("pip") || args[0] === "-c" ? ng : ok()), python: ["python"], exists: () => true, platform: "linux", approve: true, pin: PIN });
  assert.equal(b.ok, false);
  assert.match(b.message, /CSV/);
  assert.match(b.message, /openpyxl/);
});

test("requirements.txt: openpyxl と et_xmlfile を == で固定し、すべてハッシュ付き", () => {
  const text = readFileSync(join(REPO, "requirements.txt"), "utf8");
  assert.match(text, /^openpyxl==\d+\.\d+\.\d+ \\\r?\n\s+--hash=sha256:[0-9a-f]{64}/m);
  assert.match(text, /^et_xmlfile==\d+\.\d+\.\d+ \\\r?\n\s+--hash=sha256:[0-9a-f]{64}/m);
  assert.equal(readPin(), /^openpyxl==(\S+)/m.exec(text)[1]);
});

test("統合: fixtures/wbs-merged.xlsx を読むと結合セルが展開され、日付が YYYY-MM-DD になる（Python 3 が無い環境だけ skip）", (t) => {
  const real = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });
  if (!pickPython(real)) return t.skip("Python 3 が見つかりません");
  const fixture = fileURLToPath(new URL("fixtures/wbs-merged.xlsx", import.meta.url));
  assert.ok(existsSync(fixture), "fixture がありません");
  const dataDir = join(tmpdir(), "pjlens-test-xlsx"); // 2回目以降は venv を使い回す
  const r = spawnSync(process.execPath, [join(REPO, "tools/xlsx.js"), dataDir, fixture, "--yes"], { encoding: "utf8", timeout: 300000 });
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
  const r = spawnSync(process.execPath, [join(REPO, "tools/xlsx.js"), dataDir, fileURLToPath(new URL("fixtures/wbs-merged.xlsx", import.meta.url)), "--yes"], { encoding: "utf8", timeout: 300000 });
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

test("置き場の優先順: PJ_LENS_HOME が --data と従来の位置引数に勝つ", () => {
  const home = join(scratch, "env home");
  for (const args of [["doctor", "--data", join(scratch, "arg")], [join(scratch, "arg"), "doctor"]]) {
    const r = cli(args, { PJ_LENS_HOME: home });
    assert.equal(r.status, 3);
    assert.ok(r.stdout.includes(home), r.stdout);
    assert.ok(!r.stdout.includes(join(scratch, "arg")));
  }
  const r = cli(["doctor", "--data", join(scratch, "arg")]);
  assert.ok(r.stdout.includes(join(scratch, "arg")), "環境変数がなければ --data");
});

test("diagnose: 環境がなければ usable:false で案内、固定した版が入っていれば usable:true。何も実行・変更しない", () => {
  const calls = [];
  const run = (c, a) => { calls.push([c, ...a]); return a.includes("-c") && a[a.length - 1].includes("openpyxl") ? ok() : { status: 0, stdout: "C:\Python\python.exe\n", stderr: "" }; };
  const none = diagnose("/d", { run, python: ["py", "-3"], exists: () => false, platform: "linux", pin: PIN });
  assert.equal(none.usable, false);
  assert.match(none.lines.join("\n"), /setup/);
  assert.match(none.lines.join("\n"), /C:\Python\python\.exe/, "作成元の Python のパス");
  assert.equal(diagnose("/d", { run, python: ["py", "-3"], exists: () => true, platform: "linux", pin: PIN }).usable, true);
  assert.ok(calls.every(([, ...a]) => !a.includes("venv") && !a.includes("pip")), "診断は環境を作らない");
});

test("統合: 空白と日本語を含む置き場で doctor が動き、setup は --yes なしでは何も作らない。--yes で作り、doctor が 0 になる（Python 3 が無い環境だけ skip）", (t) => {
  const real = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });
  if (!pickPython(real)) return t.skip("Python 3 が見つかりません");
  const home = join(scratch, "利用者 名", "データ 置き場");
  let r = cli(["doctor", "--data", home]);
  assert.equal(r.status, 3, r.stderr);
  assert.ok(r.stdout.includes(home) && r.stdout.includes(venvPython(home)), r.stdout);
  assert.match(r.stdout, /作成元の Python: .+/);
  assert.equal(existsSync(home), false, "doctor は何も作らない");
  r = cli(["setup", "--data", home]);
  assert.equal(r.status, 3);
  assert.ok(r.stderr.includes(home) && /openpyxl==/.test(r.stderr) && /--yes/.test(r.stderr), r.stderr);
  assert.equal(existsSync(home), false, "承認なしでは作らない");
  r = cli(["setup", "--yes", "--data", home]);
  assert.equal(r.status, 0, r.stderr);
  r = cli(["doctor"], { PJ_LENS_HOME: home });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /使えます/);
  const fixture = fileURLToPath(new URL("fixtures/wbs-merged.xlsx", import.meta.url));
  r = cli([home, fixture]); // 従来の呼び出し（<置き場> <ファイル>）
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).sheets.length, 3);
});
