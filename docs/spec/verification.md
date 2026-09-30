# 準備資料の検証記録

状態: draft。実装開始判定はready=false。同一会話でのStrict設計相談が未完了。

## 実施した検証

- 会話の全5往復を取得し、hasMore=falseを確認した。
- 32要件のIDと受け入れ検証表の参照、9実装工程、ローカルMarkdownリンク、コードフェンス、JSON例とschemaの最上位項目、readinessの整合をscripts/check-planning.pyで検証した。
- Japanese explanatory HTMLスキルの検証スクリプトで、静的契約・1図のinline SVG描画・クリックとキーボードによる拡大・フォーカストラップ・閉じる操作・フォーカス復元の成功を確認した。
- 説明HTMLをブラウザで目視し、本文・図の可読性と拡大表示を確認した。
- ZIPのCRC、収録ファイル集合、各ファイルのSHA256と元資料の一致をscripts/package-planning.pyで検証した。時刻を固定した同一入力で再生成し、ZIPのSHA256一致も確認した。

資料検証は製品の動作保証ではない。製品のビルド・型検査・ユニットテスト・実Oracleによる互換性試験・性能試験は未実施。本体コードとpackage.jsonはまだ作成していない。JSON schemaと例の完全なスキーマ検証は実装計画の受け入れゲートで行う。

## 説明HTMLの閲覧

[Tailnet内プレビュー](http://100.85.74.8:8765/oracle-top-planning.html)はdocs/overview.htmlへのシンボリックリンクで公開している。資料更新は反映される。図の初回描画には固定CDNへのアクセスが必要。

公開を解除する場合:

```bash
/Users/iwasawayuuta/.agents/skills/tailscale-html-preview/scripts/tailscale-html-preview unpublish oracle-top-planning.html
```

## 正式化に必要な証拠

同じ会話でStrict設計相談を完了し、GitHub connectorによる最新完全SHA検証を含む回答を取得する。回答をOracle sourceと照合し、下書きの技術判断を確定する。正式版・HTML・ZIPを再生成して検証・commit/pushし、clean状態とGitHub SHA一致を確認した時点でゴールを完了する。
