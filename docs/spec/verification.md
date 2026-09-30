# 準備資料の検証記録

状態: 準備完了コミット`f5b745107f09421655e05c92c8aef7603e9ee68d`時点の検証記録です。その時点では実装開始判定ready=true、同一会話でのStrict設計相談とローカル照合が完了し、製品コードは未実装でした。以降の製品実装・動作検証の現在の状態は[実装報告](implementation-report.md)を参照してください。

## 実施した検証

- 会話の全5往復を取得し、hasMore=falseを確認した。
- 32要件のIDと受け入れ検証表の参照、10工程（P01完了、P02〜P10未着手）、ローカルMarkdownリンク、コードフェンス、JSON例とschemaの最上位項目、readinessの整合をscripts/check-planning.pyで検証した。
- Japanese explanatory HTMLスキルの検証スクリプトで、静的契約・1図のinline SVG描画・クリックとキーボードによる拡大・フォーカストラップ・閉じる操作・フォーカス復元の成功を確認した。
- 説明HTMLをブラウザで目視し、本文・図の可読性と拡大表示を確認した。
- ZIPのCRC、収録ファイル集合、各ファイルのSHA256と元資料の一致をscripts/package-planning.pyで検証した。時刻を固定した同一入力で再生成し、ZIPのSHA256一致も確認した。

準備時点の資料検証は製品の動作保証ではありません。この時点では製品のビルド・型検査・ユニットテスト・実Oracleによる互換性試験・性能試験は未実施で、本体コードとpackage.jsonも未作成でした。JSON Schemaそのもの、公開出力例、3件の正常変形と11件の拒否例をjsonschema 4.25.1のDraft 2020-12 validatorで検査しました。Ajvと実際のserializer出力を結ぶ検証は後続P07のゲートとして設定し、その実施結果は実装報告へ記録しています。

## 説明HTMLの閲覧

[Tailnet内プレビュー](http://100.85.74.8:8765/oracle-top-planning.html)はdocs/overview.htmlへのシンボリックリンクで公開している。資料更新は反映される。図の初回描画には固定CDNへのアクセスが必要。

公開を解除する場合:

```bash
/Users/iwasawayuuta/.agents/skills/tailscale-html-preview/scripts/tailscale-html-preview unpublish oracle-top-planning.html
```

## 正式採用の証拠

同じ会話で入力SHA `4f37e12b902547cba877f5ffaecaaef64ef9c811`のStrict検証成功を含む回答を回収しました。詳細は[相談記録](consultation.md)です。回答とOracleの保存形式を照合し、R/D/P・Schema・受け入れ表を同期しました。

準備時点で文書検査、完全Schema検査、HTML描画・拡大検査、ZIP内容hash照合を行いました。検証コマンドと結果のログはGit管理外の.workbenchへ保持しました。準備段階の最終commit/push後にclean状態とlocal/remote完全SHA一致を確認し、f5b7451で準備を完了しています。この記録を、その後の実装コミットのpush証拠には使いません。

Schema検証コマンド（製品依存へは追加しない一時検証環境）:

```bash
UV_CACHE_DIR=/Volumes/990p2t/.cache/uv uv run --no-project --with jsonschema==4.25.1 python3 .workbench/oracle/validate-schema.py
```

資料の準備完了は、製品の動作・配布・性能検証完了を意味しません。
