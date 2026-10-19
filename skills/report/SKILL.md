---
name: report
description: 進捗レポート(全体一覧・プロジェクト別の詳細・今週の予定)を HTML と PDF で出力する
argument-hint: "[YYYY-MM-DD]"
allowed-tools: 'Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/report.js" *)'
---

進捗レポートを出力します。次のコマンドを実行してください。`$ARGUMENTS` は省略できます(日付を指定すると、その日時点のレポートになります)。

```
node "${CLAUDE_PLUGIN_ROOT}/tools/report.js" ".pj-lens/data.json" ".pj-lens/report" $ARGUMENTS
```

- 出力先は `.pj-lens/report/` で、`report.html` と `report.pdf` ができます(毎回上書きされます)。PDF は Microsoft Edge で作るため、Edge が見つからないときは HTML だけになります。
- データが見つからないときは、先に `/pj-lens:init` を実行するよう伝えてください。
- 会議の件名は載りません。載せたいときは、`.pj-lens/data.json` の `settings.reportShowMeetingTitles` を `true` にします。

成功したら、出力先のパスを利用者に伝えてください。
