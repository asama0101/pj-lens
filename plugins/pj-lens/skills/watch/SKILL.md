---
name: watch
description: HTML の「Claude Code に依頼する」から届く依頼を、見張って処理する。見張っている間、HTML に「Claude Code が見ています」と出る。
disable-model-invocation: true
---

HTML の「Claude Code に依頼する」の受信箱を見張ります。依頼が届いたら、`pj-lens:inbox` エージェントで 1 件ずつ処理し、提案を作ります（承認は、HTML か、ここで「R3 を承認」と伝えたとき）。

データは `.pj-lens/data.json` です。見つからないときは、先に `/pj-lens:init` を実行するよう利用者に伝えてください。

## 手順
1. Monitor ツールで、次のコマンドを起動します（標準出力の 1 行が、1 つのイベントになります）。`timeout_ms` は上限の 1800000（30 分）にします。

   ```
   node "${CLAUDE_PLUGIN_ROOT}/tools/inbox.js" wait ".pj-lens/data.json"
   ```

   Monitor が使えないときは、`/pj-lens:inbox` で今ある分を処理するよう案内して終わります。
2. イベントの種類:
   - `{"event":"request","id":"R3",...}` — 依頼が届いた（新しい依頼、聞き返しへの返信、修正の依頼、もう一度の提案）。**`pj-lens:inbox` エージェントに、依頼 R3 の処理を頼みます**。複数届いたら、順に。
   - `{"event":"decision","id":"R3","status":"applied"|"rejected","by":"html"}` — HTML で承認・却下された。利用者に 1 行で伝えるだけで、操作は不要です。
3. 見張っている間の約束:
   - **端末で質問して止まらない**（聞きたいことは `ask` で HTML に出す）。承認も待たない。
   - 利用者が端末で「R3 を承認」「R3 を却下」と伝えたら、`/pj-lens:inbox` と同じ手順（`get` で中身を見せて `approve`、または `reject`）で、自分で実行する。
4. 30 分で Monitor は終わります。終わったら（期限切れの通知が来たら）、**もう一度 手順 1 を実行して、見張りを続けます**。見張りを止めるには、利用者に「見張りをやめて」と伝えてもらい、Monitor を止めます（TaskStop）。
5. 見張りの印（`inbox.watching.at`）は、`wait` コマンドが 30 秒ごとに書きます。Monitor が止まると、90 秒ほどで、HTML に「見ていません」と出ます。

見張りを始めたら、「見張りを始めました。HTML の『Claude Code に依頼する』から依頼できます」とだけ伝えてください。
