# pj-lens（開発用の入口）

ネットワーク設備の管理者向けに、複数プロジェクトの進捗と自分のタスクを 1 つのダッシュボードで管理する Claude Code プラグイン。利用者向けの説明（使い方・画面・Claude Code 連携・変更履歴）は [plugins/pj-lens/README.md](plugins/pj-lens/README.md)。

**Windows 専用。**

## 導入

    /plugin marketplace add asama0101/pj-lens
    /plugin install pj-lens@pj-lens

## 開発

プラグイン本体は `plugins/pj-lens/`、tests・docs はこのリポジトリ直下にある。

    npm test        # node --test
    npm run build   # plugins/pj-lens/assets/pj-lens.html（プラグインに同梱する完成版）

- ソース（`plugins/pj-lens/src/`）を変えたら `npm run build` を実行し、`assets/pj-lens.html` をコミットする（古いと `npm test` が失敗する）。
- このリポジトリを直接開いてプラグインを試すときは、`claude --plugin-dir ./plugins/pj-lens` で起動する。
- 開発記録（`docs/`・`grill-specs/`）は gitignore 済みで、ローカルにだけある。

| パス | 内容 |
|---|---|
| `.claude-plugin/marketplace.json` | マーケットプレイスの定義 |
| `plugins/pj-lens/` | プラグイン本体（`.claude-plugin/plugin.json`・`skills/`・`agents/`・`src/`・`tools/`・`assets/`・`data/sample.json`・`requirements.txt`・`package.json`） |
| `tests/` | テスト（`fixtures/` は Excel のサンプル） |

## ライセンス

MIT
