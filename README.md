# oracle-top

OracleのChatGPTブラウザ実行の保存状態を表示する、読み取り専用CLIダッシュボードを開発しています。

正式な要件・設計・実装計画が揃い、実装開始判定はready=trueです。同じChatGPT会話でStrict相談と完全SHA検証を完了し、回答をローカルOracle根拠へ照合しました。P02〜P04の基盤・読み取り・設定を検証してコミットし、後続工程を実装中です。製品全体は未完成です。

## 目的

- 現在の pending / running セッション
- ブラウザスロットの保存済み使用数
- 直近24時間の成功率と結果件数
- 直近24時間・7日間のモデル／推論レベル別送信回数

ログ解析、独自異常判定、Oracle操作、ネットワーク通信、永続履歴、利用枠・残量表示は行いません。

## 計画

[要件定義書](docs/spec/requirements.md)、[設計書](docs/spec/design.md)、[実装計画書](docs/spec/implementation-plan.md)、[受け入れ検証表](docs/spec/acceptance.md)を用意しました。正式版です。実装担当はGPT 6.1 Sol / Highです。工程ごとの検証結果とコミットは[実装報告](docs/spec/implementation-report.md)に記録します。

[説明HTML](docs/overview.html)は人間向けに画面・用語・数字の意味・実装順を説明します。
[準備状況](docs/spec/readiness.json)、[相談の記録と再開順](docs/spec/consultation.md)、[作業計画](docs/work-plan.md)で未完了のゲートを確認できます。

## 資料の検証とパッケージ

```bash
python3 scripts/check-planning.py
python3 scripts/package-planning.py
```

ZIPはartifacts/oracle-top-planning.zipです。現在のZIPは準備完了時点の資料です。計画のready=trueは製品の実装完了や動作検証を示すものではありません。
