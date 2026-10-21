// 使い方: node tools/inbox.js <コマンド> <data.json> ...   （コマンドの一覧は引数なしで実行すると出る）
// HTML の「Claude Code に依頼する」の受信箱（data.json の inbox）を、Claude Code から扱う。結果は JSON で標準出力へ。
// list・get は data.json を書かない。それ以外は、書く直前にファイルを読み直して、検証に通ったときだけ書く。
import { readFileSync, writeFileSync } from "node:fs";
import { validate, CAUSES } from "../src/core/schema.js";
import { today } from "../src/core/dates.js";
import {
  submitRequest, claimRequest, askQuestion, setProposal, rejectRequest, markApplied, markFailed, touchWatching, getRequest,
} from "../src/core/inbox.js";
import { planOps, applyProposal } from "../src/ui/inboxops.js";

const USAGE = `使い方: node tools/inbox.js <コマンド> <data.json> ...
  submit  <data.json> <projectId|-> <text>        依頼を足す（テスト・手動用）
  list    <data.json>                             依頼の一覧
  get     <data.json> <id>                        依頼 1 件（やりとり・提案つき）
  wait    <data.json> [--timeout <秒>]            依頼を待つ。1 行 1 イベントの JSON を出し続ける
  claim   <data.json> <id>                        受け取る（pending → working）
  ask     <data.json> <id> <text>                 聞き返す（→ question）
  propose <data.json> <id> <ops.json> [--summary <文>] [--reason <文>] [--cause <原因>]   提案を書く（→ proposed）
  approve <data.json> <id>                        承認して適用する（proposed のときだけ）
  reject  <data.json> <id>                        却下する
  fail    <data.json> <id> <message>              できない・失敗として返す`;

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const out = (v) => console.log(JSON.stringify(v, null, 2));
const now = () => new Date().toISOString();
const usage = () => { console.error(USAGE); process.exit(2); };

/** 検証に通ったときだけ書く */
function save(path, data) {
  const { errors } = validate(data);
  if (errors.length) throw new Error(errors.join(" / "));
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

const counts = (sections) => ["due", "pred", "add"].map((k) => [k, sections.find((s) => s.kind === k)?.rows.filter((r) => r.action !== "same").length ?? 0]);
const summarize = (sections) => {
  const [due, pred, add] = counts(sections).map(([, n]) => n);
  return `期限 ${due} 件・先行 ${pred} 件・登録 ${add} 件`;
};

const COMMANDS = {
  submit: [3, (d, [path, pid, text]) => {
    const next = submitRequest(d, { text, projectId: pid === "-" ? null : pid, now: now() });
    save(path, next);
    const r = next.inbox.requests.at(-1);
    out({ ok: true, id: r.id, status: r.status });
  }],
  list: [1, (d) => out((d.inbox?.requests ?? []).map((r) => ({ id: r.id, at: r.at, status: r.status, projectId: r.projectId, text: (r.thread[0]?.text ?? "").slice(0, 80) })))],
  get: [2, (d, [, id]) => {
    const r = getRequest(d, id);
    if (!r) throw new Error(`依頼 ${id} がありません`);
    out(r);
  }],
  claim: [2, (d, [path, id]) => { save(path, claimRequest(d, id, now())); out(getRequest(readJson(path), id)); }],
  ask: [3, (d, [path, id, text]) => { save(path, askQuestion(d, id, text, now())); out({ ok: true, id, status: "question" }); }],
  propose: [3, (d, [path, id, opsFile], o) => {
    const cause = o.cause ?? "その他";
    if (!CAUSES.includes(cause)) throw new Error(`原因は ${CAUSES.join("・")} のいずれかにしてください`);
    const plan = planOps(d, readJson(opsFile), { today: today() });
    const summary = o.summary ?? `提案: ${summarize(plan.sections)}`;
    const proposal = { ...plan, summary, reason: o.reason ?? summary, cause };
    save(path, setProposal(d, id, proposal, now()));
    out({ ok: true, id, status: "proposed", sections: plan.sections, warnings: plan.warnings });
  }],
  approve: [2, (d, [path, id]) => {
    const r = getRequest(d, id);
    if (!r) throw new Error(`依頼 ${id} がありません`);
    if (r.status !== "proposed") throw new Error(`依頼 ${id} は ${r.status} なので、承認できません`);
    let applied;
    try {
      applied = applyProposal(d, r.proposal, { reason: r.proposal.reason, cause: r.proposal.cause, today: today() });
    } catch (e) {
      if (e.code === "stale") save(path, markFailed(d, id, e.message, now()));
      throw e;
    }
    save(path, markApplied(applied, id, { by: "claude", summary: `${summarize(r.proposal.sections)}を反映しました`, now: now() }));
    out({ ok: true, id, status: "applied" });
  }],
  reject: [2, (d, [path, id]) => { save(path, rejectRequest(d, id, now())); out({ ok: true, id, status: "rejected" }); }],
  fail: [3, (d, [path, id, message]) => { save(path, markFailed(d, id, message, now())); out({ ok: true, id, status: "failed" }); }],
};

/** 依頼を待つ。起動時に届いている pending、待っている間に届いた pending・返信・再提案、proposed が applied・rejected に変わったことを出す。30 秒ごとに「見ている印」を書く */
function wait(path, o) {
  const interval = Number(o.interval ?? 2000), timeoutMs = Number(o.timeout ?? 0) * 1000;
  const announced = new Set(), prev = new Map();
  const started = Date.now();
  let lastBeat = 0;
  const emit = (e) => console.log(JSON.stringify(e));
  const tick = () => {
    let d;
    try { d = readJson(path); } catch { return; } // 書き込みの途中などで読めないときは、次の回に
    if (Date.now() - lastBeat >= 30000) {
      lastBeat = Date.now();
      try { save(path, touchWatching(readJson(path), now())); } catch { /* 次の回にもう一度 */ }
    }
    for (const r of d.inbox?.requests ?? []) {
      const key = `${r.id}:${r.thread.length}`;
      if (r.status === "pending" && !announced.has(key)) { announced.add(key); emit({ event: "request", id: r.id, status: "pending" }); }
      const before = prev.get(r.id);
      if (before === "proposed" && (r.status === "applied" || r.status === "rejected")) emit({ event: "decision", id: r.id, status: r.status, by: r.result?.by ?? null });
      prev.set(r.id, r.status);
    }
    if (timeoutMs && Date.now() - started >= timeoutMs) { clearInterval(timer); emit({ event: "end" }); }
  };
  const timer = setInterval(tick, interval);
  tick();
}

// --flag 値 を取り除いて、残りを位置引数にする
const argv = process.argv.slice(2);
const FLAGS = ["summary", "reason", "cause", "timeout", "interval"];
const opts = {};
const rest = [];
for (let i = 0; i < argv.length; i++) {
  const f = /^--(\w+)$/.exec(argv[i])?.[1];
  if (f && FLAGS.includes(f)) { opts[f] = argv[++i]; } else rest.push(argv[i]);
}
const [cmd, ...args] = rest;
if (cmd === "wait") {
  if (!args[0]) usage();
  wait(args[0], opts);
} else {
  const spec = COMMANDS[cmd];
  if (!spec || args.length < spec[0]) usage();
  try {
    spec[1](readJson(args[0]), args, opts);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
