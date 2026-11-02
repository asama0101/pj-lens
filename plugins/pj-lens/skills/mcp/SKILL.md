---
name: mcp
description: 予定表の取り込みで使う MCP とツールを指定して保存する。接続中の MCP から候補を提案し、承認後に保存して、1件取得して動作を確認する
argument-hint: "[show | calendar]"
allowed-tools: 'Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/mcpconf.js" *)'
disable-model-invocation: true
---

予定表の取り込み（`/pj-lens:intake calendar`）で使う MCP の指定を管理します。MCP 自体は利用者が Claude Code に用意したものを使い、このプラグインには同梱しません。指定は `${CLAUDE_PLUGIN_DATA}` の `pj-lens-mcp.json` に保存し、プロジェクトの `data.json` には入れません。

引数: $ARGUMENTS

## 手順
1. **現状を表示する。** 次のコマンドを実行し、予定表用の指定の有無と内容を伝える。引数が空または `show` のときは、ここまでで終わる。
   ```
   node "${CLAUDE_PLUGIN_ROOT}/tools/mcpconf.js" --data "${CLAUDE_PLUGIN_DATA}" show
   ```
2. **候補を提案する。** 予定表（`calendar`）について、いま接続している MCP のツール一覧から候補を選ぶ。**サーバー名とツール名を明示して**示す。
   - `server`、`listTool`（期間を指定して予定を取得するツール）
   - 該当するツールが見つからないときは、見つからなかったと伝え、MCP の用意（`claude mcp add` など）を案内して終わる。推測で指定しない。
3. **承認を得て保存する。** 承認された内容を次のコマンドで保存する。
   ```
   node "${CLAUDE_PLUGIN_ROOT}/tools/mcpconf.js" --data "${CLAUDE_PLUGIN_DATA}" set calendar server=<サーバー名> listTool=<ツール名>
   ```
4. **自分のメールアドレスと会議室の名前を聞いて保存する。** 取り込みで、自分だけ・自分と会議室だけの予定（作業ブロックなど）を会議として取り込まないための設定。聞く内容は次の 2 つ。どちらも答えは任意で、答えがなければ保存しない（自分のメールアドレスが未設定のときは、何も除外されない）。
   - 自分のメールアドレス（複数可。予定表の参加者に載る形。例: 会社と個人のアドレス）。
   - 会議室の名前に含まれる言葉（複数可）。MCP が会議室を `resource` 種別で返すときは不要。何も保存しないときは「会議室」が使われる。
   ```
   node "${CLAUDE_PLUGIN_ROOT}/tools/mcpconf.js" --data "${CLAUDE_PLUGIN_DATA}" set calendar selfEmails=<メール,メール> roomKeywords=<言葉,言葉>
   ```
   保存済みの `server`・`listTool` は、そのまま残る。項目を空（`selfEmails=`）にすると、その項目を消す。
5. **試しに取得して確認する。** 今日の予定を、指定したツールで取得する。使った MCP のサーバー名とツール名を添えて、取得できた件数と1件の件名を見せる。参加者（メールアドレス・人か会議室か）が取得できるかも伝える（取得できないと、自分だけの予定を除外できない）。失敗したら、理由を伝え、指定を残すか消す（`clear calendar`）かを聞く。

終わったら、`/pj-lens:intake calendar` で取り込めることを伝える。
