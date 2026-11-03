---
name: intake
description: Excel の WBS、予定表の会議、会議のプロジェクト規則を、プロジェクトのデータへ取り込む。変更案を見せて、承認後に書き込む（予定表の会議は承認の確認なしで更新する）。メール・議事録・メモの取り込みと、日程の変更は、HTML の「Claude Code に依頼する」で行う
argument-hint: "wbs <ファイル> | calendar | rules"
---

`pj-lens:intake` エージェントを使って、次の依頼を処理してください。

依頼: $ARGUMENTS

依頼が空のときは、取り込みたいもの（`wbs <ファイル>`、`calendar`、`rules`）を利用者に聞いてください。メール・議事録・メモの本文は、HTML の「Claude Code に依頼する」に貼って頼むよう伝えてください。
データは `.pj-lens/data.json` です。見つからないときは、先に `/pj-lens:init` を実行するよう利用者に伝えてください。
`calendar` は、先に `/pj-lens:mcp` で予定表の MCP を指定しておく必要があります。
