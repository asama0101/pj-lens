---
name: holidays
description: 日本の祝日（内閣府の祝日一覧）を取得して、data.json に保存する。営業日の計算（タスクの登録の期限）で、土日に加えて飛ばす日になる
disable-model-invocation: true
---

日本の祝日を、内閣府の祝日一覧（`syukujitsu.csv`）から取得して、`.pj-lens/data.json` の `settings.nationalHolidays` に保存します。取得するだけで、こちらのデータは何も送りません。

データは `.pj-lens/data.json` です。見つからないときは、先に `/pj-lens:init` を実行するよう利用者に伝えてください。

## 手順
1. 次のコマンドを実行します。

   ```
   node "${CLAUDE_PLUGIN_ROOT}/tools/holidays.js" update ".pj-lens/data.json"
   ```

2. 終了コードが 0 なら、出力の `count`（件数）と `from`〜`to`（範囲）を、1 行で伝えます。HTML の「設定」タブの「日本の祝日」に出ることも添えます（開いているなら「更新」ボタンで読み直す）。
3. 0 以外なら、出力に書かれた理由をそのまま伝え、「手動で登録した休みだけで営業日を計算します」と添えます。`data.json` は変わっていないので、直したり作り直したりしないでください。

取得状況だけ見るときは、`status` を使います（`fetched`・`fetchedAt`・`count`・`from`・`to`・`ageDays`）。
