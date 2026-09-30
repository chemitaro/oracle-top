# oracle-top

OracleのChatGPTブラウザ実行の保存状態を表示する、読み取り専用CLIダッシュボードの計画リポジトリです。

現在は要件・設計・実装計画の具体化段階です。ツール本体は未実装です。同じChatGPT会話を使うOracleのStrict相談が送信前エラーで止まったため、実装開始判定はready=falseです。

## 目的

- 現在の pending / running セッション
- ブラウザスロットの保存済み使用数
- 直近24時間の成功率と結果件数
- 直近24時間・7日間のモデル／推論レベル別送信回数

ログ解析、独自異常判定、Oracle操作、ネットワーク通信、永続履歴、利用枠・残量表示は行いません。

## 計画

[要件定義書](docs/spec/requirements.md)、[設計書](docs/spec/design.md)、[実装計画書](docs/spec/implementation-plan.md)、[受け入れ検証表](docs/spec/acceptance.md)を用意しました。現在は相談前の下書きです。実装担当はGPT 6.1 Sol / Highを想定しています。

[説明HTML](docs/overview.html)は人間向けに画面・用語・数字の意味・実装順を説明します。
[準備状況](docs/spec/readiness.json)、[相談の記録と再開順](docs/spec/consultation.md)、[作業計画](docs/work-plan.md)で未完了のゲートを確認できます。

## 資料の検証とパッケージ

```bash
python3 scripts/check-planning.py
python3 scripts/package-planning.py
```

ZIPはartifacts/oracle-top-planning.zipです。ready=falseの下書き状態も明記して含めます。製品のテスト・ビルドを実行した証拠ではありません。
