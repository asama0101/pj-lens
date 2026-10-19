# NW プロジェクト管理ダッシュボード Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ネットワーク設備管理者が、複数プロジェクトとタスクを JSON 1ファイルで管理し、静的 HTML ダッシュボードで俯瞰・編集し、3つのサブエージェントで日程見直し・今日の計画・取り込みを支援し、HTML／PDF レポートで共有できるようにする。

**Architecture:** データの正本は `data.json`。判断ロジック（進捗・遅延・影響範囲・空き時間・優先順位）は `src/core/*.js` の純関数（ESM）に集約し、(a) `node --test` で検証、(b) CLI（`tools/*.js`）経由でサブエージェントが使用、(c) `tools/build.js` が `export` を除去して単一の `dist/dashboard.html` にインライン化（`file://` では ES module が読めないため）、(d) レポートも同じ関数を使う。画面の保存は File System Access API。

**Tech Stack:** Node 24（`node --test`、依存パッケージなし）、素の HTML/CSS/JS、Edge ヘッドレス（PDF）。Windows 専用。

**Spec:** `C:\Users\sioay\OneDrive\github\xxx\grill-specs\2026-10-20_0005_nw-project-dashboard\SPEC.md`

## Global Constraints

- ローカルサーバー・常駐プロセス・SQLite は使わない。外部パッケージ（npm）を追加しない。
- MCP をリポジトリに同梱しない（`.mcp.json` を作らない）。予定の取得は利用者が用意した MCP 経由、未接続時は手入力。
- タスク状態の値は `To Do` / `In Progress` / `Waiting` / `Done` / `Cancelled`（JSON・画面・レポートで同一表記）。
- プロジェクト状態の値は `計画中` / `進行中` / `保留` / `完了` / `中止`。
- 遅延・リスクは状態にせず自動判定で表示する（期限超過、`Waiting` の長期化）。
- 進捗率 = `Done` 数 ÷（`Cancelled` を除く全タスク数）。
- 見積時間は持たない。重要度（`high`/`mid`/`low`/`null`）は任意で、`null` は `mid` 扱い。
- プロジェクトの `start`（開始日）は必須で `due` 以前。マイルストーン（`milestones`: 名前と日付）は複数持てる。
- 作業枠（`sessions`）は 1 タスクに複数。`kind` は `"planned"`（予定）か `"actual"`（実績）。過ぎた予定は「未確認」（保存値は `planned` のまま、表示時に判定し、実績時間には含めない）。見積時間は持たず、予実の差は日付で見る。
- タスクの開始日: 先行タスクがあれば「先行タスクの期限の最大値」で固定（`start` は無視）。先行がなければ `start`（任意）、なければ期限の1点（バーなし）。
- 日付は `YYYY-MM-DD`、時刻は `HH:MM`（ローカル時刻）の文字列で持ち、`Date` の UTC 変換による日付ずれを起こさない。
- レポートに会議の件名は載せない（`settings.reportShowMeetingTitles` が `true` のときのみ載せる）。
- 承認なしにデータを更新しない（サブエージェントは変更案を提示し、承認後に更新する）。
- デザインは Task 6 の Artifact 承認後に実装する。UI 実装前に `frontend-design:frontend-design` を使う。
- 色（互いに区別できること）: 会議＝紫系、予定の枠＝青緑、実績の枠＝緑、未確認＝橙の点線、空き時間＝緑の点線。ライト・ダークの両方で同じ関係を保つ。
- 一時ファイルは OS の一時フォルダ（`os.tmpdir()`）に作る。プロジェクト内に置かない。
- コード内のコメントは日本語。README.md を更新する（Task 11）。

## Review Focus

1. 先行タスクが循環している、または存在しない ID を参照している → `validate` がエラーにし、`computeImpact` は無限ループせず終了する。
2. `data.json` が空（プロジェクト 0 件・タスク 0 件）→ ダッシュボードとレポートが落ちず、空状態を表示する。
3. 会議が重なる、日をまたぐ、勤務時間外にある → `freeSlots` が重複を統合し、勤務時間内に切り詰める。
4. `Waiting` なのに `waitingOn` が `null`、または `Done`/`Cancelled` なのに未来の予定枠が残っている → `validate` が警告する（保存は止めない）。画面で `Done` にするときは、未来の予定枠の解除を確認する。
5. 他の人（Claude Code）が `data.json` を更新した後に画面から保存 → 上書きせず衝突を警告する。
6. 他のタスクの先行になっているタスクを画面から削除 → 警告を出し、承認時は参照も取り除く。
7. 月末・年末をまたぐ日付計算（`2026-12-31` + 1日）→ `2027-01-01`。
8. `start` が `due` より後、または先行タスクの期限が自分の期限より後 → ガントはバーを反転させず点で表示し、`validate` が警告する。
9. タスク 0 件のプロジェクトでガントを開く → 空状態を表示して落ちない。
10. 1年以上のプロジェクト（約 550 日）で、表示期間が「3か月」でも「全期間」でも、ページ全体は横スクロールせず（ガントの領域だけがスクロール）、今日の位置から開く。
11. 画面幅が約 400px のとき、リストはカード表示になり、ガントの左列は縮み、ページ全体は横スクロールしない。
15. MCP の取得結果に、利用者が「参加しない」にした会議と同じ `externalId` が含まれる → `skip` を保持したまま内容だけ更新する。取得結果から消えた MCP の会議は削除するが、手入力の会議は残す。
16. 勤務時間の外（8:00-9:30 など）にまたがる会議 → カレンダーには範囲に入る部分だけ表示し、完全に外なら表示しない。空き時間の計算は `freeSlots` が切り詰める。
17. 欄外クリックで選択を外すとき、枠・会議・削除ボタン・会議の編集欄・「実績にする」のクリックでは外さない。会議の入力中に編集欄が再描画されない（入力欄を作り直すと、直後のボタンのクリックが失われる）。
13. 過ぎたのに確認していない予定の枠 → 「未確認」と表示し、実績時間には含めない。未来の枠は実績にできない（`confirmSession` が拒否）。
14. 今が枠の途中（14:00-16:00 の枠で今 15:00）→ 終了が過ぎるまでは予定。`sessionKind` は現在時刻 `now` を引数に取り、テストで固定する。
12. ドラッグ＆ドロップで勤務時間外（9:00 前・18:00 後）、土日、他の配置と重なる位置にドロップ → 配置せず理由を表示する。会議と重なる場合は警告つきで配置する。

---

## ファイル構成

| パス | 責務 |
|---|---|
| `package.json` | `"type":"module"`、scripts: `test`, `build`, `report` |
| `data/sample.json` | ダミーデータ（デザイン確認・テスト・デモ用。実データではない） |
| `src/core/dates.js` | 日付・時刻の文字列演算 |
| `src/core/schema.js` | `validate` |
| `src/core/metrics.js` | 進捗率・遅延判定 |
| `src/core/impact.js` | 影響範囲の算出 |
| `src/core/schedule.js` | 空き時間・優先順位 |
| `tools/*.js` | サブエージェント用 CLI（`validate`/`impact`/`rank`/`free`）、`build.js`、`report.js` |
| `src/ui/*` | ダッシュボード（`index.html` テンプレート、`theme.css`、`store.js`、`app.js`、`views/*.js`） |
| `.claude/agents/{replan,daily-planner,intake}.md` | サブエージェント定義 |
| `tests/*.test.js` | `node --test` |
| `README.md` | 導入・使い方 |

### Task 1: データモデルと検証

**Files:**
- Create: `package.json`, `src/core/dates.js`, `src/core/schema.js`, `data/sample.json`, `tools/validate.js`, `tests/schema.test.js`

**Interfaces:**
- Produces（`dates.js`）: `addDays(date: string, n: number): string`、`diffDays(a: string, b: string): number`（`a - b`）、`toMin(hhmm: string): number`、`toHHMM(min: number): string`、`today(): string`（ローカル日付）
- Produces（`schema.js`）: `validate(data: object): { errors: string[], warnings: string[] }`
- データ形（`data/sample.json` が実例。プロジェクト 3・タスク 12 以上・イベント数件を入れる）:

```
{ version: 1,
  settings: { workday: {start:"09:00", end:"18:00"}, waitingLongDays: 7, reportShowMeetingTitles: false },
  projects: [{ id, name, type: "増設|更改|改善|不具合対処|その他", status, start, due, milestones: [{name, date}] }],
  tasks: [{ id, projectId, title, due, start: date|null, status, memo, predecessors: [id], waitingOn: {party, since}|null, importance: "high|mid|low"|null, doneAt: date|null, sessions: [{ id, date, start, end, kind: "planned|actual" }] }],
  events: [{ id, date, start, end, title, source: "mcp"|"manual", skip: boolean, externalId: string|null }],
  changeLog: [{ at, taskIds: [id], reason, cause: "ベンダー|社内|自分|その他", deltaDays }] }
```

- [ ] **Step 1: 失敗するテストを書く** — `tests/schema.test.js`: `validate(sample)` が `errors: []`。不正ケース: 不明な状態値、`predecessors` が存在しない ID、先行の循環（T1→T2→T1）、`projectId` 不明、日付形式不正、プロジェクトの `start` が `due` より後、枠の終了が開始以前、同じ日に重なる枠はそれぞれ `errors` に入る。`Waiting` で `waitingOn: null`、先行ありなのに `start` がある（無視される旨）、`Done`/`Cancelled` で未来の予定枠あり、`start` が `due` より後は `warnings`。`addDays("2026-12-31", 1) === "2027-01-01"`、`diffDays("2026-03-01","2026-02-28") === 1`。
- [ ] **Step 2: 実行して失敗を確認** — `node --test tests/schema.test.js` → FAIL（モジュールなし）
- [ ] **Step 3: 実装** — `dates.js` は `Date.UTC` でなく数値分解で日付演算（ローカル時刻のずれを避ける）。`validate` は循環を DFS で検出。`tools/validate.js <path>` は結果を JSON で出力し、`errors` があれば exit 1。
- [ ] **Step 4: 成功を確認** — `node --test tests/schema.test.js` → PASS
- [ ] **Step 5: Commit** — `git init` 済みでなければ初期化し、`feat: データモデルと検証`

### Task 2: 進捗率・遅延判定・ガント用の算出（実績の線を含む）

**Files:** Create: `src/core/metrics.js`, `tests/metrics.test.js`

**Interfaces:**
- Consumes: `diffDays`（Task 1）
- Produces: `taskStart(data, taskId): string`（先行があれば先行の期限の最大値。先行がなければ `start`、それもなければ `due`）、`ganttRows(data, projectId): { range: {start: string, end: string}, rows: {taskId: string, start: string, end: string, point: boolean, actual: {start: string, end: string} | null}[], milestones: {name: string, date: string}[] }`（`range` は全タスクの開始・期限とプロジェクトの開始日・期限を含み前後に余白。`actual` は最初の実績枠の日〜完了日（`doneAt`）、未完了なら `today`、実績枠がなければ `null`。`start >= end` の行は `point: true`）、`ganttLayout(range: {start: string, end: string}, window: "m1"|"m3"|"m6"|"y1"|"all"): { visibleDays: number, ratio: number, scale: "day"|"week"|"month"|"quarter" }`（表示期間の日数は m1=31／m3=92／m6=183／y1=365／all=範囲の全日数。`visibleDays = min(その日数, 範囲の日数)`、`ratio = 範囲の日数 / visibleDays`（1以上。ガント全体の幅が画面幅の何倍か）。目盛りの種類は `visibleDays <= 40` で日、`<= 100` で週、`<= 420` で月、それより長ければ四半期）、`timeTicks(range, scale): {date: string, label: string, yearStart: boolean, weekend: boolean}[]`（日=毎日（`label` は日、月初は `M/D`。曜日は呼出し側が表示）、土日は `weekend: true`、週=月曜ごとに `M/D`、月=毎月1日（最初と1月は `YYYY/M`、他は `M月`）、四半期=1・4・7・10月の1日に `YYYY Qn`。1月1日は `yearStart: true`）、`projectProgress(data, projectId): { done: number, total: number, rate: number }`（`total` は `Cancelled` 除外、0 件なら `rate: 0`）、`taskFlags(task, today, settings): string[]`（`"overdue"`：`Done`/`Cancelled` 以外で `due < today`、`"waiting-long"`：`Waiting` で `today - waitingOn.since >= waitingLongDays`）、`projectFlags(data, projectId, today): string[]`（`"overdue-tasks"`, `"waiting-long"`, `"past-due"`＝プロジェクト期限超過で未完了）

- [ ] **Step 1: 失敗するテストを書く** — `ganttLayout`: 範囲 580 日で `m6` → `visibleDays 183`・`ratio ≈ 3.17`・`scale "month"`、`all` → `ratio 1`・`scale "quarter"`、`m1` → `scale "day"`（範囲が 30 日の短いプロジェクトで `y1` でも日）、`m3` → `scale "week"`、範囲が 60 日で `y1` → `visibleDays 60`・`ratio 1`。`timeTicks`: 日目盛りは範囲の日数と同じ件数で、土日だけ `weekend: true`、月初のラベルは `11/1`。`2026-10-05〜2027-02-10` の月目盛りが `10月`/`11月`/`12月`/`2027/1`（`yearStart`）/`2月`、四半期は `2026 Q4`/`2027 Q1`、週は全て月曜。1年半の範囲でも件数が目盛り数の期待どおり。`taskStart`: 先行 2 件（期限 10/10 と 10/14）なら 10/14（`start` を持っていても無視）／先行なしで `start` ありならそれ／先行なしで `start` なしなら `due`。`ganttRows`: 先行から開始を導出した行は `point: false`、`start > due` の行は `point: true`、タスク 0 件で `rows: []`。4 タスク（`Done`×1, `Cancelled`×1, `In Progress`×2）で `rate === 1/3`。タスク 0 件で `rate === 0`。`due:"2026-10-19"`・今日 `2026-10-20` で `overdue`。`since` が 7 日前でちょうど `waiting-long`、6 日前は付かない。
- [ ] **Step 2: 失敗を確認** — `node --test tests/metrics.test.js`
- [ ] **Step 3: 実装** — 上記シグネチャどおり。
- [ ] **Step 4: 成功を確認**
- [ ] **Step 5: Commit** — `feat: 進捗率・遅延判定・ガント算出`

### Task 2b: 作業枠（予定／実績）の規則

**Files:** Create: `src/core/sessions.js`, `tests/sessions.test.js`

**Interfaces:**
- Consumes: `toMin`, `toHHMM`, `freeSlots`（Task 4 より前に必要なら、勤務時間の判定は `settings.workday` を直接使う）
- Produces: `sessionKind(session, now: {date: string, time: string}): "planned" | "actual" | "unconfirmed"`（`kind:"actual"` は実績。`planned` で終了が `now` 以前なら `unconfirmed`、それ以外は `planned`）、`addSession(data, taskId, slot: {date,start,end}, now): { data, error?: string, warning?: string }`（過去の枠は `kind:"actual"`、未来は `"planned"`。勤務時間内・土日以外・同日の他の枠と重ならないこと。会議と重なる場合は成功して `warning`。`id` は重複しない連番）、`moveSession(data, sessionId, slot, now): { data, error?, warning? }`（元の長さを保つ。自分自身の旧枠とは重なり扱いにしない）、`resizeSession(data, sessionId, end: string): { data, error? }`（終了は開始より後・勤務時間内・他の枠と重ならない）、`confirmSession(data, sessionId, now): { data, error? }`（過ぎた `planned` を `actual` にする。未来の枠は `error`）、`removeSession(data, sessionId): data`、`taskActual(data, taskId): { hours: number, firstDate: string | null, count: number }`（`hours` は `actual` の合計。`count` は全枠数）、`projectActualHours(data, projectId): number`、`futurePlanned(data, taskId, now): string[]`（未来の `planned` 枠の ID）

- [ ] **Step 1: 失敗するテストを書く** — `sessionKind`: 実績は常に `actual`、10:00-11:00 の予定は `now=11:00` で `unconfirmed`、`now=10:30` で `planned`。`addSession`: 昨日の枠は `actual`、明日の枠は `planned`、勤務時間外・土曜・重なり・終了≦開始は `error`、会議と重なると `warning`、同じタスクに 2 回置ける。`moveSession`: 別の日へ移動でき、自分の旧枠とは重ならない。`resizeSession`: 15 分未満・18:00 超過・他の枠との重なりは `error`。`confirmSession`: 過去の予定は `actual` になり、未来は `error`。`removeSession` は予定・実績のどちらの枠も削除し、他の枠とタスクの `status` は変わらない。`taskActual`: 実績 1.5h＋2h＋予定 1h で `hours === 3.5`、`firstDate` が最小の実績日、実績なしで `null`。`projectActualHours` が配下タスクの合計。`futurePlanned` が未来の予定だけを返す。`addSession`/`moveSession`/`resizeSession`/`confirmSession`/`removeSession` のどれを実行しても、タスクの `status` と `doneAt` は変わらない（枠は時間の記録だけ）。
- [ ] **Step 2: 失敗を確認** — `node --test tests/sessions.test.js`
- [ ] **Step 3: 実装** — 変更は不変更新。分への変換は `toMin`。
- [ ] **Step 4: 成功を確認**
- [ ] **Step 5: Commit** — `feat: 作業枠の規則`

### Task 3: 影響範囲の算出（replan の中核）

**Files:** Create: `src/core/impact.js`, `tools/impact.js`, `tests/impact.test.js`

**Interfaces:**
- Consumes: `addDays`, `diffDays`
- Produces: `computeImpact(data, taskId, deltaDays): { changes: {taskId, oldDue, newDue, reason}[], projectDueExceeded: {projectId, due, latestTaskDue}[] }`。`changes` の先頭は指定タスク自身（`due + deltaDays`）。後続タスク（`predecessors` に含む、推移的）は `newDue = max(due, 先行の newDue)` で、変わる場合のみ `changes` に入れる（最小限だけ動かす。`Done`/`Cancelled` は動かさない）。`reason` は `"先行 T3 の遅れ"` 形式。
- CLI: `node tools/impact.js <data.json> <taskId> <deltaDays>` → JSON を出力。`deltaDays` は負も可（前倒し）。

- [ ] **Step 1: 失敗するテストを書く** — T1(due 10/10)→T2(10/12)→T3(10/20)。T1 を +5 日：T1 は 10/15、T2 は 10/15、T3 は据え置き（T3 は `changes` に入らない）。T1 を +12 日：T3 まで動く。後続が `Done` なら動かさない。循環データ（T1⇄T2）でも終了する。変更後のタスク期限がプロジェクト期限を超えたら `projectDueExceeded` に入る。存在しない `taskId` は例外。
- [ ] **Step 2: 失敗を確認**
- [ ] **Step 3: 実装** — 後続を先行 ID から逆引きするマップで幅優先探索。訪問済みセットで循環を止める。
- [ ] **Step 4: 成功を確認**
- [ ] **Step 5: Commit** — `feat: 影響範囲の算出`

### Task 4: 空き時間と優先順位

**Files:** Create: `src/core/schedule.js`, `tools/rank.js`, `tools/free.js`, `tests/schedule.test.js`

**Interfaces:**
- Consumes: `toMin`, `toHHMM`, `diffDays`, `taskFlags`
- Produces: `freeSlots(events, date, workday): {start: string, end: string}[]`（対象日の会議のうち `skip: true` を除いて統合し、勤務時間内の空きを昇順で返す。勤務時間外の会議は切り詰める。空きが 0 分の区間は返さない）、`rankTasks(data, today): {taskId, score, reasons: string[], action: "work"|"chase"}[]`、会議の操作 `addMeeting(data, m: {title, date, start, end, skip?}): { data, id: string }`（`source: "manual"`、`title` が空白なら「会議」、終了≦開始は例外、`id` は `m<連番>` で重複しない）、`updateMeeting(data, id, patch): data`（手入力は件名・日付・時間・`skip`、MCP 由来は `skip` だけ。MCP 由来の件名・日付・時間を変える patch は例外。終了≦開始は例外）、`deleteMeeting(data, id): data`（手入力のみ。MCP 由来は例外）、`syncMcpEvents(data, fetched: {externalId, title, date, start, end}[], range: {start: string, end: string}): data`（`range` 内の MCP 由来だけを、`externalId` で追加・更新・削除（取得結果から消えたもの）し、既存の `skip` は保持する。`source: "manual"` は触らない）（降順、同点は `due` 昇順→`id` 昇順）
- スコア定義（SPEC の優先基準）: 対象は `Done`/`Cancelled` 以外。先行に未完了があるタスクは除外（着手不可）。`score = (期限超過なら 100) + max(0, 14 - 期限までの日数) * 3 + 10 * (このタスクを先行とする未完了タスク数、推移的) + (importance: high 12 / mid・null 4 / low 0) + (Waiting なら 15)`。`Waiting` は `action:"chase"`（催促・確認連絡）、他は `"work"`。`reasons` は日本語の短文（例 `"期限超過 2日"`, `"後続 3 件を止めている"`, `"ベンダーA に確認待ち 9日"`, `"重要度: 高"`）。
- CLI: `node tools/rank.js <data.json> [today]`、`node tools/free.js <data.json> <date>` → JSON。

- [ ] **Step 1: 失敗するテストを書く** — 会議 10:00-11:00 と 10:30-12:00 と 8:00-9:30 の日 → 空きは `09:30-10:00`, `12:00-18:00`。会議 0 件 → `09:00-18:00`。終日会議 → `[]`。会議: `updateMeeting` で手入力の会議の日付・開始・終了を変えられ、長さを変えずに別の日・別の時刻へ移す場合も通る。`freeSlots` が `skip: true` の会議を無視する。`addMeeting` が `source:"manual"` を付け、空白の件名は「会議」、終了≦開始は例外。`updateMeeting` が MCP 由来の件名変更を拒否し `skip` は通す。`deleteMeeting` が MCP 由来を拒否。`syncMcpEvents` が、新規の追加・既存の更新・消えた MCP 会議の削除をし、`skip` を保持し、手入力の会議と範囲外の MCP 会議を残す。ランキング（SPEC の「優先順位の算出」と同じ式）: 手計算で、期限超過 4 日・後続 4 件・`Waiting`・重要度なしのタスクが 100+54+40+4+15=213、期限 3 日後・後続 6 件・重要度高が 33+60+12=105、期限が明日・後続 3 件・重要度高が 39+30+12=81、期限が 2 日後・後続 4 件・重要度なしが 36+40+4=80 になる。先行が未完了のタスクは含まれない。期限超過が期限先のタスクより上、後続 3 件を止めるタスクが後続 0 件より上、先行が未完了のタスクは含まれない、`Waiting` は `action:"chase"` で `reasons` に待ち先名を含む、同点は `due` 昇順。
- [ ] **Step 2: 失敗を確認**
- [ ] **Step 3: 実装**
- [ ] **Step 4: 成功を確認**
- [ ] **Step 5: Commit** — `feat: 空き時間と優先順位`

### Task 5: サブエージェント定義

**Files:** Create: `.claude/agents/replan.md`, `.claude/agents/daily-planner.md`, `.claude/agents/intake.md`, `tests/agents.test.js`

**Interfaces:**
- Consumes: `tools/impact.js`, `tools/rank.js`, `tools/free.js`, `tools/validate.js`（CLI）
- 各ファイルは frontmatter（`name`, `description`, `tools`）＋日本語の手順。共通ルール: データファイルのパスは README の既定（`data/data.json`）を使う、変更案を提示して承認を得てから書き込む、書き込み後に必ず `tools/validate.js` を実行し `errors` があれば元に戻す、`changeLog` に理由と原因（`ベンダー|社内|自分|その他`）を追記する。
  - `replan`: 「〇〇が△日遅れた」から対象タスクと日数を特定→`impact` 実行→変更前後の表で提示→承認後に更新。
  - `daily-planner`: 利用者が用意した予定表 MCP のツールで当日・当週の会議を取得し、取得結果を `syncMcpEvents` の規則（MCP 由来だけを `externalId` で更新、`skip` と手入力の会議は保持）で `events` に反映（MCP が見つからない場合は、スケジュール画面で会議を手入力できることを案内する）→`free`・`rank` を実行→空き時間と優先タスクを理由付きで提示。作業枠（`sessions`）は書き込まない（枠は利用者が画面で置く）。
  - `intake`: メール・議事録・メモからタスク／日程変更／待ち先を抽出し、登録案（JSON 差分）として提示。重要度は推定せず、明記されたときのみ入れる。
- [ ] **Step 1: 失敗するテストを書く** — `tests/agents.test.js`: 3 ファイルが存在し、frontmatter に `name` が一致する値と `description` がある。本文に `tools/validate.js` と「承認」の語がある。`.mcp.json` がリポジトリに存在しない。
- [ ] **Step 2: 失敗を確認**
- [ ] **Step 3: 3 ファイルを作成**
- [ ] **Step 4: 成功を確認**
- [ ] **Step 5: 手動確認** — サンプルデータで `replan` に「T1 が 5 日遅れた」と依頼し、Task 3 の出力と同じ変更案が提示されること、承認前に `data.json` が変わらないことを確認して結果を記録する。
- [ ] **Step 6: Commit** — `feat: サブエージェント定義`

### Task 6: デザイン確認（実装前の関門）

**Files:** Create: `docs/design/tokens.md`（承認後のトークン記録）

- [x] **Step 1:** `frontend-design:frontend-design` に従い、ダミーデータで 2 画面（プロジェクト・スケジュール）を Artifact として公開した（https://claude.ai/artifact/18JhDFxhxGVu1vJ1Qs1NkA、非公開）。
- [x] **Step 2:** 利用者の確認。最新版（v12）を2026-10-20に承認済み。
- [x] **Step 3:** 承認デザインのトークンを `docs/design/tokens.md` に記録し、見た目の実物を `docs/design/dashboard-design.html` に保存した。**Task 7 以降の UI は、この値に従う（Web フォントは使わない）。**

### Task 7: ビルドと保存層の試作（リスク 2 の検証）

**Files:** Create: `tools/build.js`, `src/ui/index.html`, `src/ui/theme.css`, `src/ui/store.js`, `src/ui/app.js`, `tests/store.test.js`, `tests/build.test.js`

**Interfaces:**
- Produces（`store.js`）: `createStore(deps?: { showOpenFilePicker, idb }): { open(): Promise<Data>, reload(): Promise<Data>, save(data): Promise<{ ok: true } | { ok: false, reason: "conflict" | "denied" | "error", message: string }> }`。`open` はファイルハンドルを IndexedDB に保存して次回再利用する。`save` は読込時の `lastModified` と現在値を比べ、異なれば `conflict` を返して書かない。
- Produces（`build.js`）: `node tools/build.js` → `dist/dashboard.html`（`src/core/*.js` の `export` を除去してインライン、`theme.css`・`store.js`・`app.js`・`views/*.js` も同様に1ファイル化）。

- [ ] **Step 1: 失敗するテストを書く** — `store.test.js`: 偽ハンドルで、`save` 成功／`lastModified` 変更後の `save` が `conflict` で書込み 0 回／書込み例外が `error` で `message` を持つ。`build.test.js`: `dist/dashboard.html` に `import ` / `export ` が残らず、`<script src=` や外部 URL を含まない。
- [ ] **Step 2: 失敗を確認**
- [ ] **Step 3: 実装** — `index.html` は「ファイルを開く」ボタンと、読込済みデータのタスク件数を出すだけの最小画面。
- [ ] **Step 4: 成功を確認** — `node --test`
- [ ] **Step 5: 実機で検証（未検証事項の解消）** — `dist/dashboard.html` を Edge で `file://` から開き、`data/sample.json` を選んで読込み、1項目を変更して保存し、`data.json` に反映されることを確認する。**動かない場合は作業を止め、SPEC のリスク 2 に従い「画面は閲覧専用」への切替を利用者に確認する。**
- [ ] **Step 6: Commit** — `feat: ビルドと保存層`

### Task 8: プロジェクト画面（ガント／リスト）と画面幅への追従

**Files:** Create: `src/ui/views/overview.js`, `src/ui/views/project.js`; Modify: `src/ui/app.js`, `src/ui/theme.css`, `tests/views.test.js`

**Interfaces:**
- Consumes: `projectProgress`, `projectFlags`, `taskFlags`, `store`
- Produces: `renderProjects(data, today, opts: { filter: "all" | projectId, view: "gantt" | "list", window: "m1"|"m3"|"m6"|"y1"|"all", hideDone: boolean }): string`（HTML 文字列。`filter` が `"all"` なら全プロジェクトを共通の時間軸で縦に並べる。右側に「今日の優先」上位4件と理由を置く）、`renderGantt(data, projectIds: string[], today, opts): string`（ガント部分。画面とレポートで共用）。データ 0 件では「プロジェクトがありません。追加してください」、タスク 0 件のガントでは「タスクがありません」の空状態を返す。
- Consumes（追加）: `ganttRows`, `taskStart`, `ganttLayout`, `timeTicks`（Task 2）
- ガントの描画（幅に追従）: 位置と幅はすべて範囲に対する `%` で表す。1行は「左の列（固定幅、`position: sticky; left: 0`）＋ レーン」で、レーンの幅は `calc((100cqw - 左列幅 - 余白) * ratio)`（`.gscroll` に `container-type: inline-size` を付け、`cqw` は表示領域の幅を指す）。これで `ratio = 1` なら画面幅いっぱいに収まり、`ratio > 1` なら横スクロールになる。幅 640px 以下では左列を約 110px に縮める。各プロジェクトの見出しも `sticky` で幅 `100cqw`。最初の描画と表示期間の変更時は、レイアウト確定後（`requestAnimationFrame` を2回待つ）に、今日が左から約120pxになる位置へスクロールする（**確定前は `cqw` が解決されず、位置がずれる**）。先頭行は全体バー（最小の開始〜プロジェクト期限、完了率で塗る）。「完了を隠す」は `Done` の行だけを除く（全体バーの進捗には影響しない）。
- 各タスク行は、計画のバーの下に実績の線（`ganttRows` の `actual`。左と幅は同じ `%` 指定）を重ねる。プロジェクトの全体バーは `project.start`〜`project.due`。マイルストーンは、プロジェクトごとの専用行に◆と「名前 日付」のラベル（近接して重なる場合は2段）を描き、その日付にプロジェクトの全行を貫く点線を引く。日付はプロジェクトの `milestones` から。1か月（日目盛り）では、日付と曜日を2段で表示し、土日を薄く着色し、今日の目盛りを強調する（「今日」のタグは出さない）。
- リスト: プロジェクトの状態・開始日・期限、各タスクの実績（`taskActual`: 時間・初回の作業日・回数、読み取り専用）、マイルストーンの一覧（名前・日付の編集、削除、追加）、「日程変更の履歴」（日付・対象・動いた日数・理由・原因）を表示する。
- ガントの操作用の属性を描画する（動作は Task 10）: タスクのバーと点に `data-gt`、先行のないバーの左端・全バーの右端に `data-gh`、プロジェクトの全体バーに `data-gp`（両端に `data-gh`）、マイルストーンに `data-gms`、タスク名のボタンに `data-goto`、行の「×」に `data-del`、プロジェクトごとの末尾に追加用の入力欄 `data-gadd`。先行のあるバーには左端のつまみを描かない。リストの行には `data-row`（ジャンプ先）を付ける。
- リストの「開始」列は、先行がないタスクだけ日付入力、先行があるタスクは `taskStart` を「先行から」と読み取り専用で表示する。
- リストは幅 860px 以下でカード表示（件名は1行、他の項目は2列）に切り替える。

- [ ] **Step 1: 失敗するテストを書く** — `renderProjects(sample, "2026-10-20", {filter:"all", view:"gantt", window:"m6", hideDone:false})` に全プロジェクト名・進捗率（`%`）・遅延バッジ・マイルストーンが含まれ、各ガントの日付目盛りが同じ。レーン幅の式に `ratio`（`ganttLayout` の値）が使われる。空データで空状態の文言が含まれ、例外を出さない。`view:"list"` にタスクの状態（英語表記）、待ち先名、`changeLog` の理由が含まれる。`renderGantt` が行数＝タスク数のバーまたは点、今日の線、マイルストーン（名前と日付のラベルを含む行）、実績のあるタスクにだけ実績の線を含み（実績なしのタスクには無い）、`window:"m1"` で日目盛り（件数＝範囲の日数）と土日の着色になり、`"m3"` で週目盛りになり、タスク 0 件で空状態。18か月規模のデータ（`data/sample.json` を 2026-04〜2027-09 に延ばしたもの）で、`hideDone:true` なら `Done` の行だけが減る。`filter:"A"` に A のガントが含まれ、他プロジェクトのタスク名は含まれない。件名に `<script>` を含めてもエスケープされる。
- [ ] **Step 2: 失敗を確認**
- [ ] **Step 3: 実装** — 見た目は Task 6 の承認トークンに従う。タスク／プロジェクト名など利用者入力は HTML エスケープする（テストに `<script>` を含む件名を入れて確認）。
- [ ] **Step 4: 成功を確認**
- [ ] **Step 5: 目視確認** — ビルドして Playwright で、幅 1700px と 420px の両方のスクリーンショットを撮り、Artifact の承認デザインと比較する。表示期間の4種を切り替え、今日の位置から開くこと（`scrollLeft` が `lane幅 × 今日の位置 - 120` に一致）、ページ全体が横スクロールしないことを確認する。
- [ ] **Step 6: Commit** — `feat: プロジェクト画面（ガント／リスト）`

### Task 9: スケジュール画面（週／日）とドラッグ＆ドロップ配置

**Files:** Create: `src/ui/views/week.js`, `src/ui/views/day.js`; Modify: `src/ui/app.js`, `tests/views.test.js`

**Interfaces:**
- Consumes: `freeSlots`, `rankTasks`, `store`, `addSession`, `moveSession`, `resizeSession`, `confirmSession`, `removeSession`, `sessionKind`, `taskActual`（Task 2b）
- 縦サイズの追従: カレンダーの時間軸（9:00〜18:00）の位置と高さは、すべて全体に対する割合（`%`）で指定し、カレンダーの高さは CSS（`clamp(340px, calc(100dvh - 400px), 1000px)`、週表示は余白が増えるので `- 500px`）で画面の高さに合わせる。ドラッグ位置の分への変換は、固定のピクセルではなく、対象要素の実際の高さで行う（`H0 + (y - top) / height × 540`）。15分の枠でも潰れないよう、枠の最小の高さを16pxにする。
- 手入力の会議のドラッグ: 手入力の会議のブロックだけ `draggable` にし、枠と同じゴースト表示で、`drop` で日付と時間を更新する（長さは保つ。範囲は 9:00〜18:00 に収める。配置済みの枠と重なる場合は警告のみ）。下端のつまみで終了時刻を変える。MCP 由来の会議はドラッグ・長さ変更とも不可。いずれも `updateMeeting` を呼ぶ。
- 会議の画面操作: 上部の「＋ 会議を追加」で編集欄を開く（件名・日付・開始・終了・「参加しない」、既定は今日なら次の正時から1時間、他の日は 10:00 から）。会議のブロックをクリックすると選択されて同じ編集欄が開く（MCP 由来は件名・日付・時間が無効で `skip` のみ変更可、手入力は「会議を削除」ボタンあり）。「参加しない」の会議は薄く・取り消し線つきで表示し、幅を狭めて空き枠を押せるようにする。追加は「追加」ボタンまで確定せず、編集欄は、入力のたびに作り直さない（カレンダー部分だけを再描画する）。`Delete` キーは選択中の枠または手入力の会議を削除し、MCP 由来の会議では削除できない旨を表示する。
- 選択の解除: 枠・会議・削除ボタン・会議の編集欄・「実績にする」・「＋ 会議を追加」以外（欄外）のクリック、または `Esc` で、枠と会議の選択と追加中の下書きを外す。
- Produces: `renderSchedule(data, today, opts: { view: "week" | "day", date: string, now: {date: string, time: string} }): string`（週表示は 7 日の列と日ごとの空き時間・期限タスク、日表示は 1 日の時間軸と現在時刻の線。どちらも右側に「今日の優先」の全件と理由（置いた回数と実績時間を付ける）、各カレンダーの列に `data-date` を持たせる。上部に実績時間・予定件数・未確認件数と、「未確認をすべて実績にする」）、`snapStart(minutes: number, durationMin: number, workday): number`（15分刻みに丸め、勤務時間内に収める）。枠の見た目は、予定＝水色、実績＝緑（✓）、未確認＝点線。
- UI: 週・日の切替（`view`）、「←／→／今日」（週は7日、日は1日移動）、週表示の日付を押すと日表示へ。優先リストの項目をカレンダーへドラッグすると**新しい枠を追加**（同じタスクを何度でも）、置いた枠をドラッグすると**移動**（`moveSession`）。`dragover` の間は配置先のゴースト（重なり・土日は赤）を表示し、`drop` で `addSession` / `moveSession` を呼ぶ。日表示では枠の下端のつまみをドラッグして `resizeSession`（15分刻み）。枠のボタンは「実績にする」（過ぎた予定のみ）。枠をクリックすると選択され（もう一度クリックで解除。表示する週や日を変えると、表示外の選択は無効）、上部の「枠を削除」ボタン（選択がなければ無効で、選択中は「『タスク名』の枠を削除」と表示）か `Delete`／`Backspace` キー（入力欄にフォーカスがないとき、スケジュール画面のみ）で `removeSession` を呼ぶ。「元に戻す」は設けない。画面下に色の凡例（会議・予定・実績・未確認・選択中、日表示は空き時間・現在時刻も）を出す。キーボード用に「タスクを選んでから空き枠を押す」も残す。長さは既定 60 分。

- [ ] **Step 1: 失敗するテストを書く** — `snapStart(10*60+7, 60, workday) === 10*60`、`snapStart(17*60+50, 60, workday) === 17*60`（終了が 18:00 に収まる）、`snapStart(8*60, 60, workday) === 9*60`。`renderSchedule(..., {view:"day"})` に空き時間、優先タスクと理由、予定・実績・未確認の枠が種別ごとのクラスで含まれ、実績時間の表示が `taskActual` の合計と一致する。`{view:"week"}` に 7 日分の列（`data-date`）と会議の時間枠が含まれ、`reportShowMeetingTitles` に関係なく画面では件名を表示する。未確認が 0 件なら「すべて実績にする」は出ない。選択がないとき「枠を削除」は無効。枠をクリックすると選択され、削除すると枠が消えて選択が外れる。凡例に会議・予定・実績・未確認が含まれ、日表示には空き時間と現在時刻も含まれる。
- [ ] **Step 2: 失敗を確認**
- [ ] **Step 3: 実装** — プロットはタスクを時間枠へドラッグ、または日表示で空き枠を押して置く（どちらも `addSession` を呼ぶ）。
- [ ] **Step 4: 成功を確認**
- [ ] **Step 5: 目視確認** — Playwright で `DragEvent` を発火して、週表示・日表示での配置・別の日への移動・土日と重なりの拒否・解除を確認し、スクリーンショットで見た目も確認する（デザイン案の `dashboard-design.html` の操作を基準にする）。
- [ ] **Step 6: Commit** — `feat: スケジュール画面とドラッグ＆ドロップ`

### Task 10: 編集（追加・削除・更新）

**Files:** Create: `src/ui/edit.js`; Modify: `src/ui/app.js`, `tests/edit.test.js`

**Interfaces:**
- Consumes: `validate`, `store.save`
- Produces: `updateTask(data, taskId, patch): data`（件名・状態・期限・開始日・重要度・メモ・先行・待ち先）、`updateProject(data, projectId, patch): data`（状態・開始日・期限。開始日が期限より後なら例外）、`addMilestone(data, projectId, m: {name, date}): data`、`updateMilestone(data, projectId, index, patch): data`、`deleteMilestone(data, projectId, index): data`（`milestones` は日付昇順に保つ。範囲外の `index` は例外）、`futurePlanned`（Task 2b）、`moveTaskDates(data, taskId, mode: "start"|"due"|"both", days: number): { data, error?: string, warning?: string }`（ガントのドラッグ用。先行があるタスクの `start`/`both` は `error`、結果が `start > due` なら `error`。後続タスクの期限より後ろになると `warning` に該当 ID を入れる）、`moveProjectDates(data, projectId, edge: "start"|"due", days): { data, error? }`、`moveMilestone(data, projectId, index, days): data`、`addTaskQuick(data, projectId, title, today): data`（期限は今日の 7 日後、状態 `To Do`、先行なし）。`updateTask` で状態を `Done` にすると `doneAt` に今日を入れ、他の状態に戻すと `null` にする、`predecessorCandidates(data, taskId): string[]`（同一プロジェクトのタスクのうち、自分自身・既に先行のもの・自分の後続（推移的）を除く。循環を作らせない）、`addTask(data, task): data`（ID は `<projectId><連番>` で重複しない）、`deleteTask(data, taskId): { data, dependents: string[] }`（`dependents` は削除対象を先行にしているタスク ID。呼出し側が警告を出し、承認後に `force` で参照を取り除く）、`addProject`, `deleteProject`（配下タスクごと削除、件数を返す）
- 状態を `Waiting` に変えるときは `waitingOn` を入力させ、`Waiting` から外れたら `waitingOn` を `null` にする。

- [ ] **Step 1: 失敗するテストを書く** — `moveTaskDates`: 先行なしで `"both"` +3 日なら `start` と `due` が 3 日動く、`"start"` で `start > due` になる量は `error`、先行ありで `"start"`/`"both"` は `error`、`"due"` は動く、後続の期限より後ろへ動かすと `warning` に後続 ID が入る（データは動く）。`moveProjectDates` で開始が期限を越える量は `error`。`moveMilestone` で日付昇順を保つ。`addTaskQuick` の `title` が空白だけなら例外、ID は `<projectId><連番>` で重複しない。`addMilestone`/`updateMilestone`/`deleteMilestone` が日付昇順を保ち、範囲外の `index` は例外。`updateProject` の開始日が期限より後なら例外。`updateTask` で `Done` にすると `doneAt` が今日になり、戻すと `null`。`predecessorCandidates` が自分・既存の先行・後続（孫を含む）を含まない。`updateProject` で状態・期限が変わり、不正な状態値は例外。先行になっているタスクの削除で `dependents` が返り、承認なしではデータが変わらない。`force` で参照が消える。`Waiting` への更新で `waitingOn` 必須（`party` が空なら拒否）。`Waiting` から他の状態へ変えると `waitingOn` が `null` になる。追加後 `validate(data).errors` が空。保存が `conflict` のとき画面に「他で更新されました。再読込してください」を表示し、データを破棄しない。
- [ ] **Step 2: 失敗を確認**
- [ ] **Step 3: 実装** — 変更は不変更新（元のデータを書き換えない）。
- [ ] **Step 4: 成功を確認**
- ガントの結線: バー・点・全体バー・◆の `mousedown`→`mousemove`→`mouseup` で 1 日の幅（レーン幅 ÷ 範囲の日数）単位に丸めて、ドラッグ中はバーの位置だけを更新し、`mouseup` で `moveTaskDates` / `moveProjectDates` / `moveMilestone` を呼んで保存する（動きがなければ何もしない）。追加欄は `Enter` で `addTaskQuick`（**日本語入力の変換確定の `Enter`（`isComposing`）では追加しない**）、追加後は同じ欄にフォーカスを戻す。`data-goto` は、そのタスクのプロジェクトで「リスト」表示へ切り替え、該当の `data-row` を強調（約2秒）して `scrollIntoView` し、件名の入力にフォーカスする。
- [ ] **Step 5: 目視確認** — Playwright でガント上のドラッグ（先行あり・なし・全体バー・◆）、追加欄の Enter、×と削除確認、タスク名からリストへの移動を操作し、プロジェクト画面のリストを操作して、タスク追加・状態変更（`Waiting` 時の待ち先入力）・先行の追加と解除・削除警告・プロジェクトの状態と期限の変更を確認する。
- [ ] **Step 6: Commit** — `feat: 画面編集`

### Task 11: レポート出力と README

**Files:** Create: `tools/report.js`, `tests/report.test.js`, `README.md`

**Interfaces:**
- Consumes: Task 2〜4 の関数、`src/ui/views/*.js`（見た目を共有）
- Produces: `buildReport(data, today): string`（自己完結 HTML。全体一覧（実績時間つき）・プロジェクト別詳細（計画と実績、日程変更の履歴）・今週の予定。会議は時間枠のみ、`reportShowMeetingTitles` が `true` のときだけ件名）。CLI: `node tools/report.js <data.json> <outDir>` → `report.html` と、Edge ヘッドレス（`msedge.exe --headless --print-to-pdf`）で `report.pdf`。Edge が見つからない場合は HTML のみ出力し、PDF を作れなかった旨を表示して exit 0。

- [ ] **Step 1: 失敗するテストを書く** — `buildReport` が 3 セクションを含み、既定では会議の件名文字列を含まない。`reportShowMeetingTitles:true` で含む。データ 0 件で例外なし。外部 URL・`<script src` を含まない。
- [ ] **Step 2: 失敗を確認**
- [ ] **Step 3: 実装** — PDF 出力のパスは `os.tmpdir()` を経由せず指定の `outDir` に出す。ヘッドレス実行用の一時プロファイルは `os.tmpdir()` に作り、終了後に削除する。
- [ ] **Step 4: 成功を確認** — `node --test` で全テスト PASS
- [ ] **Step 5: 実機確認** — `node tools/report.js data/sample.json <outDir>` で `report.pdf` が生成され、開けることを確認する。
- [ ] **Step 6: README を書く** — 導入（Node・Edge の要件、`data/data.json` の作り方、`node tools/build.js`、ダッシュボードを開いて JSON を選ぶ手順）、予定表 MCP の用意（同梱しないこと、未接続時の手入力）、3 サブエージェントの使い方（依頼文の例）、レポートの出力方法、状態の一覧、優先順位の基準。
- [ ] **Step 7: Commit** — `feat: レポート出力と README`

### Task 12: 全体確認

- [ ] **Step 1:** `node --test` を実行し、全テストの出力を示す。
- [ ] **Step 2:** `/code-review` で差分全体を確認し、正しさ・要件に関わる指摘だけを直す。
- [ ] **Step 3:** SPEC の受入条件 1〜15 を1つずつ、実行した確認方法とその結果で照合して報告する。未検証があれば明記する。
