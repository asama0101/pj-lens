import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { markApplied } from "../src/core/inbox.js";

const REPO = fileURLToPath(new URL("../", import.meta.url));
const base = mkdtempSync(join(tmpdir(), "pjl-inbox-"));
after(() => rmSync(base, { recursive: true, force: true }));

let n = 0;
function work() {
  const dir = join(base, String(++n));
  mkdirSync(dir, { recursive: true });
  const data = join(dir, "data.json");
  copyFileSync(join(REPO, "data/sample.json"), data);
  const put = (name, obj) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(obj)); return p; };
  return { data, put, read: () => readFileSync(data, "utf8"), json: () => JSON.parse(readFileSync(data, "utf8")), write: (d) => writeFileSync(data, JSON.stringify(d, null, 2) + "\n") };
}
const CLI = join(REPO, "tools/inbox.js");
const run = (...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* 出力が JSON でないこともある */ }
  return { status: r.status, out, err: r.stderr, raw: r.stdout };
};
const OPS = [
  { op: "moveDue", taskId: "A3", deltaDays: 45 },
  { op: "addPred", taskId: "A5", predId: "A3" },
  { op: "addTask", ref: "t1", projectId: "A", title: "疎通確認テスト", due: "2026-12-10", predecessors: ["A4"] },
];
/** 依頼 R1 を proposed まで進める */
function proposed(w) {
  assert.equal(run("submit", w.data, "A", "A3 が 45 日遅れた。A5 を A3 の後にして。疎通確認テストを登録して").status, 0);
  assert.equal(run("claim", w.data, "R1").status, 0);
  const r = run("propose", w.data, "R1", w.put("ops.json", OPS), "--summary", "3 種類の変更案", "--reason", "ベンダーX の納期回答が遅れた", "--cause", "ベンダー");
  assert.equal(r.status, 0, r.err);
  return r;
}

test("submit → list → claim → propose: 提案が書かれ、承認するまで tasks と changeLog は変わらない", () => {
  const w = work();
  const tasksBefore = JSON.stringify(w.json().tasks), logBefore = w.json().changeLog.length;
  const s = run("submit", w.data, "A", "A3 が 45 日遅れた");
  assert.deepEqual([s.status, s.out.id, s.out.status], [0, "R1", "pending"]);
  assert.deepEqual(run("list", w.data).out.map((r) => [r.id, r.status, r.projectId, r.text]), [["R1", "pending", "A", "A3 が 45 日遅れた"]]);
  const c = run("claim", w.data, "R1");
  assert.equal(c.out.status, "working");
  const p = proposed(work());
  assert.equal(p.out.status, "proposed");
  assert.deepEqual(p.out.sections.map((x) => x.kind).sort(), ["add", "due", "pred"]);
  const w2 = work(); proposed(w2);
  const got = run("get", w2.data, "R1").out;
  assert.deepEqual([got.status, got.proposal.reason, got.proposal.cause, got.proposal.summary], ["proposed", "ベンダーX の納期回答が遅れた", "ベンダー", "3 種類の変更案"]);
  assert.equal(JSON.stringify(w2.json().tasks), tasksBefore);
  assert.equal(w2.json().changeLog.length, logBefore);
});

test("approve: 変更が書かれ、applied（by: claude）。2 回目は終了コード 1 でデータ不変", () => {
  const w = work(); proposed(w);
  const a = run("approve", w.data, "R1");
  assert.equal(a.status, 0, a.err);
  const d = w.json();
  assert.equal(d.tasks.find((t) => t.id === "A3").due, "2026-11-30");
  assert.deepEqual(d.tasks.find((t) => t.id === "A5").predecessors, ["A3"]);
  assert.ok(d.tasks.some((t) => t.title === "疎通確認テスト"));
  assert.deepEqual([d.inbox.requests[0].status, d.inbox.requests[0].result.by], ["applied", "claude"]);
  assert.equal(d.changeLog.at(-1).source, "inbox");
  const before = w.read();
  const again = run("approve", w.data, "R1");
  assert.equal(again.status, 1);
  assert.match(again.err, /applied/);
  assert.equal(w.read(), before);
});

test("approve: HTML で先に applied になっていたら、何も変えず終了コード 1", () => {
  const w = work(); proposed(w);
  w.write(markApplied(w.json(), "R1", { by: "html", summary: "反映しました", now: "2026-10-21T10:00:00.000Z" }));
  const before = w.read();
  const r = run("approve", w.data, "R1");
  assert.equal(r.status, 1);
  assert.equal(w.read(), before);
});

test("propose: 循環する先行の ops は終了コード 1 で、データは変わらない", () => {
  const w = work();
  run("submit", w.data, "A", "x"); run("claim", w.data, "R1");
  const before = w.read();
  const r = run("propose", w.data, "R1", w.put("bad.json", [{ op: "addPred", taskId: "A3", predId: "A4" }]));
  assert.equal(r.status, 1);
  assert.match(r.err, /循環/);
  assert.equal(w.read(), before);
});

test("approve: 提案のあとに対象のタスクが変わっていたら、failed にして終了コード 1。再提案で pending に戻せる", () => {
  const w = work(); proposed(w);
  const d = w.json(); d.tasks.find((t) => t.id === "A3").due = "2026-10-20"; w.write(d);
  const r = run("approve", w.data, "R1");
  assert.equal(r.status, 1);
  assert.match(r.err, /データが変わりました/);
  assert.equal(w.json().inbox.requests[0].status, "failed");
  assert.equal(w.json().tasks.find((t) => t.id === "A5").predecessors.length, 0, "適用されていない");
});

test("ask・reject・fail の遷移と、状態違い・不明な ID の終了コード", () => {
  const w = work();
  run("submit", w.data, "-", "どれか分からない依頼"); run("claim", w.data, "R1");
  assert.equal(run("ask", w.data, "R1", "どのプロジェクトですか").out.status, "question");
  assert.equal(run("reject", w.data, "R1").out.status, "rejected");
  run("submit", w.data, "A", "削除して"); run("claim", w.data, "R2");
  assert.equal(run("fail", w.data, "R2", "削除は依頼できません").out.status, "failed");
  assert.equal(run("claim", w.data, "R1").status, 1, "rejected は claim できない");
  assert.equal(run("get", w.data, "R9").status, 1);
  assert.equal(run("nope", w.data).status, 2);
  assert.equal(run().status, 2);
});

/** wait を起動して、終了まで標準出力の JSON 行を集める */
function startWait(w, extra = []) {
  const child = spawn(process.execPath, [CLI, "wait", w.data, "--interval", "150", ...extra], { encoding: "utf8" });
  let buf = "";
  child.stdout.on("data", (c) => { buf += c; });
  const done = new Promise((res) => child.on("exit", () => res(buf.split("\n").filter(Boolean).map((l) => JSON.parse(l)))));
  return { child, done };
}

test("wait: 起動時に pending の依頼を request イベントで出し、見ている印（watching.at）を書き、timeout で終わる", async () => {
  const w = work();
  run("submit", w.data, "A", "先に届いていた依頼");
  const ev = await startWait(w, ["--timeout", "2"]).done;
  assert.ok(ev.some((e) => e.event === "request" && e.id === "R1" && e.status === "pending"), JSON.stringify(ev));
  assert.equal(ev.at(-1).event, "end");
  assert.ok(Date.now() - Date.parse(w.json().inbox.watching.at) < 30000);
});

test("wait: 待っている間に届いた依頼と、提案の承認（decision）も出す", async () => {
  const w = work();
  const { done } = startWait(w, ["--timeout", "5"]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(700);
  assert.equal(run("submit", w.data, "A", "A3 が 45 日遅れた").status, 0);
  await sleep(600); // pending のまま、wait の確認の間隔（150ms）を越える
  assert.equal(run("claim", w.data, "R1").status, 0);
  assert.equal(run("propose", w.data, "R1", w.put("ops.json", OPS), "--cause", "ベンダー").status, 0);
  await sleep(600); // proposed のまま、確認の間隔を越える
  assert.equal(run("approve", w.data, "R1").status, 0);
  const ev = await done;
  assert.ok(ev.some((e) => e.event === "request" && e.id === "R1"), JSON.stringify(ev));
  assert.ok(ev.some((e) => e.event === "decision" && e.id === "R1" && e.status === "applied" && e.by === "claude"), JSON.stringify(ev));
});
