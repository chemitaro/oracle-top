# 要件定義書

状態: 正式版（2026-09-30採用）。同一会話のStrict相談をローカルOracle根拠へ照合済み。実装開始時に採用した契約です。現在の工程と検証証拠は[実装報告](implementation-report.md)に記録します。

目的: Oracleの保存されたChatGPTブラウザ実行を読み取り専用・オフラインで表示する、単一画面のCLIです。

製品は、**Oracleの保存状態と保存記録から求めた集計を表示する、単一画面の軽量CLIビューア**です。

表示内容は、現在セッション、選択したブラウザプロファイルの保存済みスロット数、直近24時間のステータス別件数と成功率、直近24時間／7日間のモデル・requested effort別送信回数です。成功率の補数となる失敗率、利用枠・残量・消化率は表示しません。モデルの固定優先順位も保持します。

操作形式は次の三つです。

```bash
oracle-top
oracle-top snapshot
oracle-top snapshot --json
```

ログ解析・ログ表示、CDP、プロセス生死判定、独自セッション状態、異常推定、DB、履歴保存、通知、詳細画面、Oracle操作は対象外です。同じ形式で保存されたセッションを、CLI/MCPという起動元だけで分離する機能も作りません。

**`SESSION / SLUG` は一つの列です。** 現在一覧は以下の6列とし、独立した `SESSION` 列と `SLUG` 列を作りません。

```text
STATUS | ELAPSED | PROJECT | SESSION / SLUG | MODEL | EFFORT
```

これはベースラインの列定義と一致します。`SESSION / SLUG`は一つの列名として扱い、独立したSESSION列とSLUG列には分けません。

---

## 規範要件

既存のR-01〜R-32を保持します。以下を規範とし、細部は後続の設計節へ対応付けます。

| ID | 正式要件 |
|---|---|
| R-01 | `oracle-top` は単一画面TUIを起動し、初回即時採取、既定間隔2,000msで更新します。 |
| R-02 | `--interval` はASCII正整数＋`ms`／`s`／`m`、1,000〜60,000msを受け付けます。重複、不正値、単位なしを拒否します。 |
| R-03 | `snapshot` は1回だけ採取し、ANSIなしのテキストで全行・全警告を出力して終了します。 |
| R-04 | `snapshot --json` は同じ完全SnapshotをJSON一文書として出力します。 |
| R-05 | TUIは `q`、Ctrl-C、SIGINT、SIGTERMで終了処理を開始し、採取終了を待たず端末復元を開始します。 |
| R-06 | 選択homeの `sessions` 直下にある通常ディレクトリの `meta.json` を毎回走査します。7日より古いcurrent sessionも対象です。 |
| R-07 | `home/config.json` はJSON5として読み、`browser.manualLoginProfileDir` と `browser.maxConcurrentTabs` だけを投影します。project configは探索しません。 |
| R-08 | スロット台帳は選択した1profileの `oracle-tab-leases.json` だけを読みます。 |
| R-09 | ファイル単位の読取・解析失敗を隔離し、他のレコードを処理します。全体取得不能と正常な0件を区別します。 |
| R-10 | Oracleライブラリ／CLI、Chrome、CDP、ネットワーク、対象への書込み、cleanup、プロセス照会を使用しません。 |
| R-11 | current sessionは対象providerの `pending`／`running` だけです。statusを変換・補正しません。 |
| R-12 | 現在一覧は `STATUS`、`ELAPSED`、`PROJECT`、`SESSION / SLUG`、`MODEL`、`EFFORT` の6列です。 |
| R-13 | elapsed昇順、不明は末尾、同値はidのUTF-16コード単位昇順です。時間表示の時間部分は24時間で巻き戻しません。 |
| R-14 | reliabilityは `completedAt`、fallbackとして `createdAt` を使い、両端を含む直近24時間を集計します。 |
| R-15 | `evaluated=completed+partial+error`、`successRate=completed/evaluated` です。cancelledは分母外、分母0は `null` です。失敗率・error率は出力しません。 |
| R-16 | `browser.runtime.promptSubmitted === true` の場合だけ初回1件を加算します。hashやterminal statusは条件にしません。 |
| R-17 | 初回trueかつcompletedかつ有効なfollow-up配列なら `1+length`、それ以外は初回分だけです。不完全配列の詳細はD-04に従います。 |
| R-18 | 送信回数は `startedAt`、fallbackとして `createdAt` を使い、24H／7Dを同時集計します。 |
| R-19 | model／effortの保存値の組で集約し、7D=0の行を出しません。保存ディレクトリを単位として数え、conversation IDでは統合しません。 |
| R-20 | model固定順とeffort固定順を使い、回数順・モデル能力推定順にはしません。 |
| R-21 | Oracle経由の保存記録のみであること、直接ChatGPT利用を含まないこと、requested値と送信操作代理値であることはREADMEと単発textへ明記します。TUI下部の説明・警告案内は表示しません（2026-10-01のユーザー変更指示）。 |
| R-22 | スロットは有効なv1台帳の `leases.length` です。PID、heartbeat、stale、重複を使った除外はしません。 |
| R-23 | maxは同profileのcurrent保存値→env→ユーザー設定→3の順です。競合・所属不明の規則を設計で固定します。 |
| R-24 | utilizationはactive/maximumです。100%超も数値は保持し、棒だけをclampします。独自の正常・逼迫ラベルはありません。 |
| R-25 | ヘッダー、現在一覧、24H reliability、24H／7D送信表の4領域を一画面に表示します。TUI注記領域は削除します（2026-10-01のユーザー変更指示）。 |
| R-26 | project／slugを先に縮めます。保護列が収まらない幅ではサイズ不足表示、高さ不足では表ごとの省略件数を表示します。 |
| R-27 | すべての出力は `schemaVersion: 1` の同じSnapshotから生成します。JSONにはTUIの省略を反映しません。 |
| R-28 | 入力由来の端末制御を無害化し、JSONを安全にserializeします。保存値自体のalias統合はしません。 |
| R-29 | 第一対象はmacOS、Node 24、TypeScript ESMです。重量級TUI、Oracle SDK、DBは導入しません。 |
| R-30 | pollは非重複、ファイル読取は最大8並行です。独自watch、履歴、永続キャッシュを作りません。 |
| R-31 | 終了・例外でraw mode、cursor、alternate screen、自分が登録したlistener／timerを復元・解除します。 |
| R-32 | 全check、CLI配布smoke、TTY終了／resize、読み取り専用証拠、性能予算、文書・受け入れ表が揃って実装完了とします。 |

**仕様の優先関係**は、上位指示・最新のユーザー合意を維持したうえで、Codexが採用したR→D→Pの順です。下書きのR/D/Pが、元のユーザー合意を上書きする扱いにはしません。`conversation-baseline.md` は履歴として保持し、技術的補正は正式R/D/Pと相談記録へ明示します。

---

技術境界は[決定表](boundary-decisions.md)、詳細契約は[設計書](design.md)、検証契約は[受け入れ表](acceptance.md)を参照します。
