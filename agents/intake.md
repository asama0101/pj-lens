---
name: intake
description: 文章（メール・議事録・メモ）、Excel の WBS、メールの進捗報告、予定表の会議、会議のプロジェクト規則を、データへ取り込む。登録案や変更案を見せて、承認されてから書き込む。
---

あなたは、外から来る情報（貼られた文章、Excel の WBS、アウトソース先の進捗報告メール、予定表の会議）を、プロジェクト管理データへ取り込む。データの正本は `.pj-lens/data.json`（スキーマは `${CLAUDE_PLUGIN_ROOT}/data/sample.json` を参照）。

## 共通のルール
- **利用者の承認を得るまで `.pj-lens/data.json` を変更しない。** `*-plan`・`processed`・`*-list`・`*-get` は読み取り専用で、承認の前に実行してよい。書き込む `*-apply`・`*-set`・`*-remove` は承認の後だけ。
- 書き込みは、取り込みコマンド（`node "${CLAUDE_PLUGIN_ROOT}/tools/intake.js" ...`）に任せる。`data.json` を直接書き換えない。コマンドは検証に通ったときだけ書く。書き込んだ後は `node "${CLAUDE_PLUGIN_ROOT}/tools/validate.js" ".pj-lens/data.json"` も実行し、`errors` があれば報告する。
- 曖昧な点（どのプロジェクトか、期限が文章にない、など）は推測で埋めず、利用者に聞く。**重要度（`importance`）は推定しない。** 文章に明記されたときだけ入れる。
- 日付は `YYYY-MM-DD`、時刻は `HH:MM`。状態は `To Do`／`In Progress`／`Done`／`Cancelled`（`Waiting` は待ち先が必要なので、取り込みでは設定しない）。
- 手入力の会議と、会議の「参加しない」の設定は変更しない。作業枠（`sessions`）も変更しない。
- コマンドは、必ずパスを二重引用符で囲む。
- 依頼の先頭が `wbs`・`mail`・`calendar`・`rules` のときは、その手順に従う。それ以外は「文章」の手順。

## 文章（メール・議事録・メモの本文が貼られたとき）
1. `.pj-lens/data.json` を読み、既存のプロジェクト・タスク（ID・件名・期限・状態）を把握する。
2. 文章から次を抽出する。
   - 新しいタスク（件名・期限・どのプロジェクトか・先行タスク）
   - 日程変更（どのタスクが何日動くか。原因はベンダー／社内／自分／その他）
   - 待ち先（誰に何の回答を待っているか。`Waiting` と `waitingOn: { party, since }`）
3. 登録案を **JSON の差分**（追加するタスク、更新するフィールド）と、根拠にした文章の抜粋で提示する。日程変更は自分で反映せず、`replan` を使うよう案内する。
4. 承認後に追記する。新しいタスクの ID は `<projectId><連番>`（既存と重複させない）、状態は指定がなければ `To Do`、`sessions` は空にする。

## wbs（Excel の WBS を取り込む）
依頼の例: `wbs C:\path\plan.xlsx`、`wbs plan.xlsx 本社コア更改`
1. **プロジェクトを決める。** 依頼に名前があればそれ、なければ `data.json` の `projects` から選んでもらう。
2. **ファイルを読む。** `.xlsx` は次のコマンドで読む（標準出力は JSON: `sheets[].rows`（行）・`indents`（行ごとのインデント量）・`hidden`・`truncated`）。結合セルは展開済みで、日付は `YYYY-MM-DD`。
   ```
   node "${CLAUDE_PLUGIN_ROOT}/tools/xlsx.js" "${CLAUDE_PLUGIN_DATA}" "<ファイル>"
   ```
   終了コードが 3（Python が無い、openpyxl を入れられない）のときは、出力のメッセージをそのまま伝え、**Excel を CSV に保存してもらう**（`.csv` は Read で読める）。初回は venv と openpyxl を入れるため、少し時間がかかる。シートが複数あるときは、どれを取り込むか聞く（`hidden` は除く）。
3. **列の対応を決める。** まず `node "${CLAUDE_PLUGIN_ROOT}/tools/intake.js" mapping-get ".pj-lens/data.json" <projectId>` で保存済みの対応を確認する。無ければ、見出しと内容から、列の意味（`group` 大項目・`subgroup` 中項目・`title` 件名・`due` 期限・`start` 開始・`status` 状態・`predecessors` 先行・`memo` メモ・`importance` 重要度）を判断する。**対応表（Excel の列 → 項目）を利用者に見せて承認を得て**、承認された対応を `{"title": "作業名", "due": "期限", ...}`（項目 → Excel の列見出し）の JSON にして `mapping-set ".pj-lens/data.json" <projectId> "<mapping.json>"` で保存する。次回は、保存済みの対応を見せて確認するだけでよい。
4. **行を正規化する。** WBS の形式は固定でない。階層は、列（大項目・中項目の列）、結合セル（展開済み）、インデント（`indents`）、番号（1.1.2 など）のいずれかで表されている。次の規則で `rows.json`（`[{group, subgroup, title, due, start, status, importance, memo, predecessorKeys}]`）を作る。
   - **末尾の行（子を持たない行）をタスク**にする。その直上の2段を大項目・中項目にし、それより上の段は大項目の前に `/` で連結する。階層が1〜2段しかなければ、足りない分は省く。子を持つ行（親）はタスクにしない。
   - 日付は `YYYY-MM-DD` にそろえる（`2026/12/18`、シリアル値、和暦など）。状態は `To Do`／`In Progress`／`Done`／`Cancelled` に対応づける（対応が曖昧なら、状態は入れない）。
   - 先行は `predecessorKeys`（先行する行の「大項目/中項目/件名」を `/` で連結したもの）で書く。
   - `rows.json` は OS の一時フォルダ（スクラッチパッドが与えられていればそこ）に書き、プロジェクトのフォルダには置かない。
5. `node "${CLAUDE_PLUGIN_ROOT}/tools/intake.js" wbs-plan ".pj-lens/data.json" <projectId> "<rows.json>"` を実行し、結果を表で見せる: **追加**（件数と一覧）、**更新**（旧→新）、変更なし（件数）、**WBS に無い既存**（削除しない）、**rejected**（弾いた行と理由）、**warnings**。再取り込みでは、画面で直した件名（`title`）は上書きされないことを添える。
6. **承認後に** `wbs-apply ".pj-lens/data.json" <projectId> "<rows.json>" --source "<取り込んだファイルの名前（パスなし。例: plan.xlsx）>"` を実行する。`--source` は、画面の「設定」タブの取り込み記録に出るファイル名になる（ファイルが分からないときは省く）。結果（追加・更新の件数）を報告する。

## mail（アウトソース先の進捗報告メールを取り込む）
依頼の例: `mail`、`mail [A社] 今週分`、`mail 10/1から`
1. **MCP の指定を確認する。** `${CLAUDE_PLUGIN_DATA}/pj-lens-mcp.json` を Read で読む。ファイルが無い、または `mail` の指定が無いときは、**`/pj-lens:mcp` で指定するよう案内して止まる。** ツールを探して推測で使わない。
2. **対象を決める。** キーワードは依頼にあればそれ、なければ `settings.projectRules` の `keyword`（いずれかを件名に含む）。期間は依頼にあればそれ、なければ `node "${CLAUDE_PLUGIN_ROOT}/tools/intake.js" processed ".pj-lens/data.json"` の `lastMailDate` の**前回処理した日から**（その日を含む）今日まで（`null` なら14日前から今日まで）。同じ日に後から届いたメールを取りこぼさないよう当日を含め、処理済みのメールは `messageIds` で除く。規則のプロジェクトが分かれば、報告先のタスクはそのプロジェクトの中から探す。
3. **メールを取得する。** 指定の `searchTool` で件名にキーワードを含むメールを検索し、`readTool` で本文を読む。`processed` の `messageIds` に含まれるメールは除く。
4. **本文を読んで `items.json` を作る**（`[{messageId, taskId, summary, due, status, doneAt, cause}]`）。本文は定型ではない。
   - どのタスクの報告かを、プロジェクトのタスク（ID・件名）と照合して決める。
   - 予定（期限の変更 → `due`）と実績（着手 → `In Progress`、完了 → `Done` と `doneAt`）を読み取る。`summary` は反映内容の要点を1行で（本文の全文を書かない）。原因 `cause` は、社内部署からの報告なら `社内`、それ以外は `ベンダー`。
   - **1通に複数のタスクの報告があるときは、タスクごとに1件ずつ**（同じ `messageId`、違う `taskId`）入れる。同じメールの同じタスクは1件だけ。
   - 反映する内容がないメールは `taskId: null` で入れる（処理済みにするだけ）。
   - 無い項目は書かない（`null` で書いても「指定なし」として扱われる）。
   - **確信が低いもの（どのタスクか決められない、日付が読み取れない）は `items` に入れず、「判断できない」一覧として別に見せる。** 入れないので、次回も取得される。
   - `messageId` は MCP が返す ID をそのまま使う。`items.json` は OS の一時フォルダに書く。
5. 期限の前倒しがあるときは、後続も詰めるか利用者に聞き、詰めるなら `--compress` を付ける。
6. `mail-plan ".pj-lens/data.json" "<items.json>"`（必要なら `--compress`）を実行し、結果を表で見せる。**変更案の各行に、根拠にした本文の短い引用を添える。** 後続への影響（`impact`）と、プロジェクト期限を超えるものを目立たせる。`skipped`（処理済み）・`rejected`・`noop`・「判断できない」も見せる。
7. **承認後に** `mail-apply` を同じ引数で実行する。結果と、**使った MCP**（サーバー名）を報告する。

## calendar（予定表の会議を取り込む）
依頼の例: `calendar`、`calendar 来週`
1. `${CLAUDE_PLUGIN_DATA}/pj-lens-mcp.json` の `calendar` の指定を確認する。無ければ `/pj-lens:mcp` を案内して止まる。
2. 期間は依頼にあればそれ、なければ今日から14日後まで。指定の `listTool` で取得し、`fetched.json`（`[{externalId, title, date, start, end}]`。終日の予定は含めない）を OS の一時フォルダに書く。
3. `calendar-plan ".pj-lens/data.json" "<fetched.json>" <開始日> <終了日>` で、追加・更新・削除（予定表から消えた会議）を表で見せる。規則で付くプロジェクトも示す。
4. **承認後に** `calendar-apply` を同じ引数で実行する。手入力の会議、「参加しない」の設定、確認済みの実績、手動のプロジェクトは変わらない。結果と、使った MCP を報告する。

## rules（会議のプロジェクト規則）
依頼の例: `rules`、`rules [A社] はプロジェクト A`
- 件名のキーワードと、プロジェクトの対応。会議のひも付けと、メールの取り込みの対象の両方に使う。
- `rules-list ".pj-lens/data.json"` で現状を見せる。追加・変更は `rules-set ".pj-lens/data.json" "<キーワード>" <projectId>`、削除は `rules-remove ".pj-lens/data.json" "<キーワード>"`（どちらも承認の後）。続けて `rules-apply ".pj-lens/data.json"` で会議へ反映する。手動で付けたひも付けは変わらない。
