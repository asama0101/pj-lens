---
name: mcp
description: メール・予定表の取り込みで使う MCP とツールを指定して保存する。接続中の MCP から候補を提案し、承認後に保存して、1件取得して動作を確認する
argument-hint: "[show | mail | calendar]"
allowed-tools: 'Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/mcpconf.js" *)'
disable-model-invocation: true
---

メール・予定表の取り込み（`/pj-lens:intake mail`・`calendar`）で使う MCP の指定を管理します。MCP 自体は利用者が Claude Code に用意したものを使い、このプラグインには同梱しません。指定は `${CLAUDE_PLUGIN_DATA}` の `pj-lens-mcp.json` に保存し、プロジェクトの `data.json` には入れません。

引数: $ARGUMENTS

## 手順
1. **現状を表示する。** 次のコマンドを実行し、メール用・予定表用の指定の有無と内容を伝える。引数が空または `show` のときは、ここまでで終わる。
   ```
   node "${CLAUDE_PLUGIN_ROOT}/tools/mcpconf.js" "${CLAUDE_PLUGIN_DATA}" show
   ```
2. **候補を提案する。** 引数が `mail` または `calendar` の役割について、いま接続している MCP のツール一覧から候補を選ぶ。メールと予定表が同じ Microsoft 365 系で名前が似ていても、**サーバー名とツール名を明示して**区別して示す。
   - メール（`mail`）: `server`（MCP のサーバー名）、`searchTool`（件名などで検索するツール）、`readTool`（本文を取得するツール）
   - 予定表（`calendar`）: `server`、`listTool`（期間を指定して予定を取得するツール）
   - 該当するツールが見つからないときは、見つからなかったと伝え、MCP の用意（`claude mcp add` など）を案内して終わる。推測で指定しない。
3. **承認を得て保存する。** 承認された内容を次のコマンドで保存する（役割ごと）。
   ```
   node "${CLAUDE_PLUGIN_ROOT}/tools/mcpconf.js" "${CLAUDE_PLUGIN_DATA}" set mail server=<サーバー名> searchTool=<ツール名> readTool=<ツール名>
   node "${CLAUDE_PLUGIN_ROOT}/tools/mcpconf.js" "${CLAUDE_PLUGIN_DATA}" set calendar server=<サーバー名> listTool=<ツール名>
   ```
4. **試しに取得して確認する。** メールは1通（直近の1件）、予定表は今日の予定を、指定したツールで取得する。使った MCP のサーバー名とツール名を添えて、取得できた件数と1件の件名（本文は表示しない）を見せる。失敗したら、理由を伝え、指定を残すか消す（`clear mail`／`clear calendar`）かを聞く。

終わったら、`/pj-lens:intake mail` や `calendar` で取り込めることを伝える。
