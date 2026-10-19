---
name: daily-planner
description: 今日(または今週)の会議と空き時間を確認し、優先してやるタスクを理由つきで提案する
argument-hint: "今日の計画を立てて"
---

`pj-lens:daily-planner` エージェントを使って、次の依頼を処理してください。

依頼: $ARGUMENTS

依頼が空のときは、今日の計画として扱ってください。
データは `.pj-lens/data.json` です。見つからないときは、先に `/pj-lens:init` を実行するよう利用者に伝えてください。
