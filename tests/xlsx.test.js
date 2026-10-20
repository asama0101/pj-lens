import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pickPython, venvPython, ensureEnv } from "../tools/xlsx.js";

const REPO = fileURLToPath(new URL("../", import.meta.url));
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

test("ensureEnv: venv が無ければ作り、openpyxl が無ければ pip install する（run の呼び出し順を検査）。dataDir の空白は1つの引数のまま", () => {
  const dir = join(tmpdir(), "pjl x", "data dir");
  const calls = [];
  let made = false;
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args.includes("venv")) made = true;
    if (args[0] === "-c") return calls.filter((c) => c[1] === "-c").length === 1 ? ng : ok();
    return ok();
  };
  const r = ensureEnv(dir, { run, python: ["py", "-3"], exists: () => made, platform: "win32" });
  assert.equal(r.ok, true);
  assert.deepEqual(calls[0], ["py", "-3", "-m", "venv", join(dir, "venv")]);
  assert.deepEqual(calls[1].slice(1), ["-c", "import openpyxl"]);
  assert.deepEqual(calls[2].slice(1), ["-m", "pip", "install", "--quiet", "openpyxl"]);
  assert.equal(r.python, venvPython(dir, "win32"));
});

test("ensureEnv: すでに venv と openpyxl があれば何も作らず入れない", () => {
  const calls = [];
  const r = ensureEnv("/d", { run: (c, a) => { calls.push([c, ...a]); return ok(); }, python: ["python"], exists: () => true, platform: "linux" });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
});

test("ensureEnv: venv を作れない／pip が失敗したら ok:false で CSV を案内するメッセージ", () => {
  const a = ensureEnv("/d", { run: () => ng, python: ["python"], exists: () => false, platform: "linux" });
  assert.equal(a.ok, false);
  assert.match(a.message, /venv/);
  const b = ensureEnv("/d", { run: (c, args) => (args.includes("pip") || args[0] === "-c" ? ng : ok()), python: ["python"], exists: () => true, platform: "linux" });
  assert.equal(b.ok, false);
  assert.match(b.message, /CSV/);
  assert.match(b.message, /openpyxl/);
});

test("統合: fixtures/wbs-merged.xlsx を読むと結合セルが展開され、日付が YYYY-MM-DD になる（Python 3 が無い環境だけ skip）", (t) => {
  const real = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });
  if (!pickPython(real)) return t.skip("Python 3 が見つかりません");
  const fixture = join(REPO, "tests/fixtures/wbs-merged.xlsx");
  assert.ok(existsSync(fixture), "fixture がありません");
  const dataDir = join(tmpdir(), "pjlens-test-xlsx"); // 2回目以降は venv を使い回す
  const r = spawnSync(process.execPath, [join(REPO, "tools/xlsx.js"), dataDir, fixture], { encoding: "utf8", timeout: 300000 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.sheets.length, 2);
  const rows = out.sheets[0].rows;
  const flat = rows.flat();
  assert.ok(flat.includes("設計"), "大項目");
  assert.equal(rows.filter((row) => row.includes("設計")).length, 3, "結合セルの大項目が縦に展開される");
  assert.ok(flat.some((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)), "日付は YYYY-MM-DD");
  assert.ok(flat.includes("機器選定"), "前後の全角スペースが除かれる");
  assert.deepEqual(out.sheets[1].indents, [0, 0, 2, 4, 4, 0, 2], "インデントで階層を表す行は、先頭の空白の数を indents で返す");
  assert.deepEqual(out.sheets[1].rows[2], ["要件", null], "文字列は空白を除いて返す");
});

import { realRun } from "../tools/xlsx.js";

test("realRun: 1MB を超える標準出力でも切れずに受け取れる（横に長い WBS の JSON を想定）", () => {
  const r = realRun(process.execPath, ["-e", "process.stdout.write('x'.repeat(5 * 1024 * 1024))"]);
  assert.equal(r.status, 0, String(r.error));
  assert.equal(r.stdout.length, 5 * 1024 * 1024);
});
