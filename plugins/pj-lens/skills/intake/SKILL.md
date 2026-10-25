---
name: intake
description: 文章（メール・議事録・メモ）、Excel の WBS、予定表の会議を、プロジェクトのデータへ取り込む。変更案を見せて、承認後に書き込む。日程の変更の影響計算には使わない（`replan` を使う）
argument-hint: "(本文) | wbs <ファイル> | calendar | rules"
---

`pj-lens:intake` エージェントを使って、次の依頼を処理してください。

依頼: $ARGUMENTS

依頼が空のときは、取り込みたいもの（文章を貼る、`wbs <ファイル>`、`calendar`、`rules`）を利用者に聞いてください。
データは `.pj-lens/data.json` です。見つからないときは、先に `/pj-lens:init` を実行するよう利用者に伝えてください。
`calendar` は、先に `/pj-lens:mcp` で予定表の MCP を指定しておく必要があります。
