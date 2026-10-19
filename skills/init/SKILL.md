---
name: init
description: pj-lens のセットアップ。作業フォルダに、ダッシュボード(pj-lens.html)とデータ(.pj-lens/data.json)を用意する。何度実行しても既存のデータは変えない
argument-hint: "[--sample]"
allowed-tools: 'Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/init.js" *)'
disable-model-invocation: true
---

pj-lens のセットアップを行います。次のコマンドを実行してください。

```
node "${CLAUDE_PLUGIN_ROOT}/tools/init.js" $ARGUMENTS
```

- `--sample` を付けると、空のデータの代わりに架空のサンプルデータが入ります(試用向け)。
- 終了コードが 0 以外のときは、出力に書かれた理由をそのまま利用者に伝え、ファイルを作り直したり上書きしたりしないでください。

成功したら、作成・更新されたファイルを短く伝え、次の手順を案内してください。

1. ブラウザ(Edge または Chrome)で、プロジェクト直下の `pj-lens.html` を開く。
2. 「ファイルを開く」で `.pj-lens/data.json` を選ぶ。
