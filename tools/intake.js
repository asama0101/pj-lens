// 使い方: node tools/intake.js <コマンド> <data.json> ...   （コマンドの一覧は引数なしで実行すると出る）
// 取り込み（WBS・メール・予定表）と、会議のプロジェクト規則、WBS の列の対応を扱う。結果は JSON で標準出力へ。
// *-plan・processed・*-list・*-get は data.json を書かない。*-apply・*-set・*-remove は検証に通ったときだけ書く。
import { readFileSync, writeFileSync } from "node:fs";
import { validate } from "../src/core/schema.js";
import { today, isDate } from "../src/core/dates.js";
import { assignMeetingProjects, setProjectRule, removeProjectRule } from "../src/core/rules.js";
import { planWbsImport, applyWbsImport, getWbsMapping, setWbsMapping } from "../src/import/wbs.js";
import { planMailImport, applyMailImport, processedMessageIds, lastMailDate } from "../src/import/mail.js";
import { planCalendarSync, applyCalendarSync } from "../src/import/calendar.js";

const USAGE = `使い方: node tools/intake.js <コマンド> <data.json> ...
  wbs-plan | wbs-apply   <data.json> <projectId> <rows.json> [--source <取り込んだファイル名>]   (--source は wbs-apply の取り込み記録用)
  mail-plan | mail-apply <data.json> <items.json> [--compress]
  processed              <data.json>
  calendar-plan | calendar-apply <data.json> <fetched.json> <開始日> <終了日>
  rules-list | rules-apply <data.json>
  rules-set              <data.json> <keyword> <projectId>
  rules-remove           <data.json> <keyword>
  mapping-get            <data.json> <projectId>
  mapping-set            <data.json> <projectId> <mapping.json>`;

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const out = (v) => console.log(JSON.stringify(v, null, 2));
const usage = () => { console.error(USAGE); process.exit(2); };

/** 検証に通ったときだけ書く */
function save(path, data) {
  const { errors } = validate(data);
  if (errors.length) throw new Error(errors.join(" / "));
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

// コマンド名 → [必要な引数の数(コマンド名を除く), 実行]
const COMMANDS = {
  "wbs-plan": [3, (d, [, pid, rows]) => out(planWbsImport(d, pid, readJson(rows)))],
  "wbs-apply": [3, (d, [path, pid, rows], o) => {
    const plan = planWbsImport(d, pid, readJson(rows));
    save(path, applyWbsImport(d, pid, plan, { today: today(), source: o.source }));
    out({ ok: true, summary: { added: plan.add.length, updated: plan.update.length }, rejected: plan.rejected, warnings: plan.warnings });
  }],
  "mail-plan": [2, (d, [, items], o) => out(planMailImport(d, readJson(items), { today: today(), compress: o.compress }))],
  "mail-apply": [2, (d, [path, items], o) => {
    const plan = planMailImport(d, readJson(items), { today: today(), compress: o.compress });
    save(path, applyMailImport(d, plan, { today: today() }));
    out({ ok: true, summary: { changes: plan.changes.length, noop: plan.noop.length, skipped: plan.skipped.length, rejected: plan.rejected.length }, rejected: plan.rejected });
  }],
  processed: [1, (d) => out({ messageIds: processedMessageIds(d), lastMailDate: lastMailDate(d) })],
  "calendar-plan": [4, (d, [, f, s, e]) => {
    const { added, updated, removed } = planCalendarSync(d, readJson(f), { start: s, end: e });
    out({ added, updated, removed });
  }],
  "calendar-apply": [4, (d, [path, f, s, e]) => {
    const plan = planCalendarSync(d, readJson(f), { start: s, end: e });
    save(path, applyCalendarSync(d, readJson(f), { start: s, end: e }));
    out({ ok: true, summary: { added: plan.added.length, updated: plan.updated.length, removed: plan.removed.length } });
  }],
  "rules-list": [1, (d) => out(d.settings?.projectRules ?? [])],
  "rules-apply": [1, (d, [path]) => { save(path, assignMeetingProjects(d)); out({ ok: true }); }],
  "rules-set": [3, (d, [path, k, pid]) => { save(path, setProjectRule(d, k, pid)); out({ ok: true }); }],
  "rules-remove": [2, (d, [path, k]) => { save(path, removeProjectRule(d, k)); out({ ok: true }); }],
  "mapping-get": [2, (d, [, pid]) => out(getWbsMapping(d, pid))],
  "mapping-set": [3, (d, [path, pid, m]) => { save(path, setWbsMapping(d, pid, readJson(m))); out({ ok: true }); }],
};

const argv = process.argv.slice(2);
const si = argv.indexOf("--source"); // wbs-apply の取り込み記録に残す、取り込んだファイル名
const opts = { compress: argv.includes("--compress"), source: si >= 0 ? argv[si + 1] ?? null : null };
const [cmd, ...args] = argv.filter((a, i) => a !== "--compress" && a !== "--source" && !(si >= 0 && i === si + 1));
const spec = COMMANDS[cmd];
if (!spec || args.length < spec[0]) usage();
if (cmd.startsWith("calendar-") && !(isDate(args[2]) && isDate(args[3]))) usage();
try {
  spec[1](readJson(args[0]), args, opts);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
