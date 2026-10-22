---
name: inbox
description: HTML の「Claude Code に依頼する」に届いている依頼を、今ある分だけ処理する（見張りなし）。「R3 を承認」「R3 を却下」の依頼にも使う。
argument-hint: "[R3 を承認 | R3 を却下]"
disable-model-invocation: true
---

`.pj-lens/data.json` の受信箱に届いている依頼を、今ある分だけ処理します。見張り続けたいときは `/pj-lens:watch` を使います。

依頼: $ARGUMENTS

データが見つからないときは、先に `/pj-lens:init` を実行するよう利用者に伝えてください。

## 手順
- **依頼（引数）が空のとき**: `node "${CLAUDE_PLUGIN_ROOT}/tools/inbox.js" list ".pj-lens/data.json"` で、状態が `pending` の依頼を見つけ、`pj-lens:inbox` エージェントで、1 件ずつ処理します。なければ「届いている依頼はありません」と伝えます。この手動の処理では、聞きたいことを端末で聞いても構いません（`ask` で HTML に出してもよい）。
- **「R3 を承認」のとき**: `get` で提案の中身を見せてから、`pj-lens:inbox` エージェントの「承認・却下」の手順で `approve` を実行します。
- **「R3 を却下」のとき**: `reject` を実行します。
- 終わったら、処理した依頼と、その状態（提案ができた・聞き返した・できなかった・反映した）を、1〜2 行で伝えてください。
