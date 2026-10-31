---
name: inbox
description: HTML の「Claude Code に依頼する」に届いている依頼を、今ある分だけ処理する（見張りなし）。「R3 を承認」「R3 を却下」の依頼にも使う。
argument-hint: "[R3 を承認 | R3 を却下]"
allowed-tools: 'Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/inbox.js" *)'
disable-model-invocation: true
---

`.pj-lens/data.json` の受信箱に届いている依頼を、今ある分だけ処理します。見張り続けたいときは `/pj-lens:watch` を使います。

依頼: $ARGUMENTS

データが見つからないときは、先に `/pj-lens:init` を実行するよう利用者に伝えてください。コマンドは `node "${CLAUDE_PLUGIN_ROOT}/tools/inbox.js" <コマンド> ".pj-lens/data.json" ...` の形で、パスは二重引用符で囲みます。

## 手順
- **依頼（引数）が空のとき**: `list` で、状態が `pending` の依頼を見つけ、`pj-lens:inbox` エージェントで、1 件ずつ処理します。なければ「届いている依頼はありません」と伝えます。
- **「R3 を承認」のとき**: `get R3` で提案の中身（`sections`・`warnings`）を見せてから、`approve R3` を実行します。HTML で先に承認・却下されていたら、`approve` は何も変えずに失敗するので、その旨を伝えます。提案のあとにデータが変わっていた（`failed`）ときは、HTML の「もう一度提案してもらう」か、新しい依頼で作り直すよう案内します。
- **「R3 を却下」のとき**: `reject R3` を実行します。
- 終わったら、処理した依頼と、その状態（提案ができた・聞き返した・できなかった・反映した）を、1〜2 行で伝えてください。
