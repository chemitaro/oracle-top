# oracle-top

OracleのChatGPTブラウザ実行の保存状態を表示する、読み取り専用CLIダッシュボードを開発しています。

正式な要件・設計・実装計画が揃い、実装開始判定はready=trueです。同じChatGPT会話でStrict相談と完全SHA検証を完了し、回答をローカルOracle根拠へ照合しました。P02〜P09の基盤・読み取り・設定・投影・集計・表示・単発CLI・TUIを実装し、全222テスト、型検査、ビルドが通りました。配布・実端末・性能を含む製品全体の動作検証は未完了です。

## 目的

- 現在の pending / running セッション
- ブラウザスロットの保存済み使用数
- 直近24時間の成功率と結果件数
- 直近24時間・7日間のモデル／推論レベル別送信回数

ログ解析、独自異常判定、Oracle操作、ネットワーク通信、永続履歴、利用枠・残量表示は行いません。

## ソースからの実行

Node.js 24を使用します。開発・検証の基準は24.14.0です。

```bash
npm ci
npm run build

node dist/cli.js
node dist/cli.js --interval 5s
node dist/cli.js snapshot
node dist/cli.js snapshot --json
```

引数なしのTUIは2秒間隔で更新し、`q`で終了します。`--interval`は単位付きの正整数（`ms`／`s`／`m`）で、1〜60秒の範囲を指定できます。TUIにはstdinとstdoutの両方がTTYである端末が必要です。パイプやリダイレクトでは`snapshot`を使用してください。textはANSIなし、JSONは一文書で、どちらも全行・全警告を保持します。

`--help`／`-h`、`--version`／`-V`も使用できます。上記以外の引数や組合せは受け付けません。

## 読み取り先

| 環境変数 | 用途・既定値 |
|---|---|
| `ORACLE_HOME_DIR` | Oracle home。未指定ならOS homeの`.oracle` |
| `ORACLE_BROWSER_PROFILE_DIR` | 選択profile。未指定ならconfigの`browser.manualLoginProfileDir`、なければOS homeの`.oracle/browser-profile` |
| `ORACLE_BROWSER_MAX_CONCURRENT_TABS` | 同profileの保存sessionから上限を採れない場合のfallback。さらにconfigの`browser.maxConcurrentTabs`、既定3の順 |

homeを変更してもprofileの既定値は移動しません。環境変数とconfigの相対パスは起動時の作業ディレクトリを基準とし、`~`や環境変数文字列をツール内で展開しません。configの読み取り対象は上記2項目だけです。

各更新で`home/sessions/*/meta.json`と選択profileの`oracle-tab-leases.json`を読みます。壊れた記録は安全な警告で隔離し、読めた記録から表示します。セッション全体を読めない場合のN/Aと、正常に読めた0件を区別します。

## 数字の意味

セッションのstatusとmodel／effortは保存値です。スロット数は保存されたleaseの件数で、staleや重複も含みます。プロセスの生存やブラウザの状態を照会した値ではありません。

成功率は直近24時間の`completed / (completed + partial + error)`です。`cancelled`は分母へ入らず、分母0はN/Aになります。

送信回数はOracleが保存した送信操作の代理値です。初回は`promptSubmitted === true`を1件とし、completedの有効な`options.browserFollowUps`だけを追加します。直接ChatGPTを使った回数、アカウントの利用枠や残量は表しません。24時間・7日間の区間は開始時刻で集計します。

通常終了と有効な警告付きsnapshotはexit 0、引数・TTY条件の不正は2、内部・出力・復元の失敗は1です。Ctrl-C／SIGINTは130、SIGTERMは143、stdoutのEPIPEは0です。

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
