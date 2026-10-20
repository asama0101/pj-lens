---
name: intake
description: 文章（メール・議事録・メモ）、Excel の WBS、アウトソース先の進捗報告メール、予定表の会議を、プロジェクトのデータへ取り込む。変更案を見せて、承認後に書き込む
argument-hint: "(本文) | wbs <ファイル> | mail [キーワード] | calendar | rules"
---

`pj-lens:intake` エージェントを使って、次の依頼を処理してください。

依頼: $ARGUMENTS

依頼が空のときは、取り込みたいもの（文章を貼る、`wbs <ファイル>`、`mail`、`calendar`、`rules`）を利用者に聞いてください。
データは `.pj-lens/data.json` です。見つからないときは、先に `/pj-lens:init` を実行するよう利用者に伝えてください。
`mail` と `calendar` は、先に `/pj-lens:mcp` でメール・予定表の MCP を指定しておく必要があります。
