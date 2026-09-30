# Oracle Top 要件定義書

版: 1.0 / 2026-09-30。状態: draft（同一会話でのStrict相談未完了）。
実装担当: GPT 6.1 Sol / High。本体は未実装。

## 1. 目的と権威

OracleのChatGPTブラウザ実行について、現在の保存状態と直近の利用実績を一画面で把握する。Oracleが保存した状態を再読込して表示し、独自の状態監視エンジンを作らない。
正式仕様の優先順位はユーザーの最新指示、本書、設計書、実装計画書、会話ベースラインの順。同じ内容の矛盾があれば実装を止めて仕様を修正する。相談回答は助言であり、自動的に仕様にはならない。

## 2. 対象と対象外

ローカルOracleのChatGPTブラウザセッションを対象とする。同じmetadata形式で保存されたMCP起動セッションを起動元によって除外することはしない。MCP専用連携は作らない。
API、Gemini、Oracle本体改造、CDP、プロセス生死判定、ログ解析、詳細ペイン、選択・ページ切替、操作・復旧・再実行、通知、Webアプリ、メニューバー、DB、独自履歴・ログ、デーモン、利用上限・推定残量・消化率は対象外。
説明HTMLは本プロジェクトの資料であり、製品Web UIではない。

## 3. CLI契約

| ID | 入力 | 必須結果 |
| --- | --- | --- |
| R-01 | `oracle-top` | 一画面TUI。既定間隔2000ms |
| R-02 | `oracle-top --interval 2s` | 指定した更新周期でTUIを実行 |
| R-03 | `oracle-top snapshot` | 一度の採取結果をANSIなしのテキストで全件表示して終了 |
| R-04 | `oracle-top snapshot --json` | 同じSnapshotをJSON一文書で出力して終了 |
| R-05 | TUIでq / Ctrl-C | 読込終了を待つことなく終了処理開始。端末設定を復元 |

期間切替、snapshotへのinterval、TUIへのjson、未知の引数は許可しない。help/versionは標準的な診断用オプションとして提供する。
非TTYではTUIを起動せずstderrでsnapshotを案内してexit 2。stdoutを汚さない。

## 4. データ取得

| ID | 要件 |
| --- | --- |
| R-06 | sessionsの直下各ディレクトリのmeta.jsonのみ読む。現在セッションは7日窓より古くても表示する |
| R-07 | 設定はOracle home/config.jsonの許可したbrowser項目のみ投影する。JSON5を許容する |
| R-08 | 選択した一つのprofileのoracle-tab-leases.jsonから保存済みleases.lengthを読む |
| R-09 | 読取エラー・不正JSON1件を隔離し、他のレコードを継続する。警告を出す |
| R-10 | 監視対象を変更せず、OracleのライブラリやCLIを呼ばず、ネットワーク通信を行わない |

毎回全セッションを走査する。createdAtだけで7日より古いレコードを先に除外してはいけない。古いセッションが現在稼働中、または直近に完了することがあるため。
ファイル更新・消失が採取中に起きても全体の原子性は要求しない。値は一回の採取内で個別に観測した保存値であり、全ファイル同時点の保証ではない。

## 5. 現在のセッション

R-11: 対象statusはpendingとrunningだけ。変換・補正・独自のstale除外を行わない。
R-12: 列はSTATUS / ELAPSED / PROJECT / SESSION / SLUG / MODEL / EFFORT。

| 値 | 優先順位・表示 |
| --- | --- |
| status | 保存値pending/running |
| elapsedMs | startedAt、欠損・不正ならcreatedAtを基準にnowとの差。両方不明はnull / N/A |
| project | cwdの末尾名。不明はunknown |
| slug | options.slug、id、ディレクトリ名 |
| model | meta.model、options.model、unknown |
| effort | browser.thinkingSelection.requestedLevel、options.browserConfig.thinkingTime、unknown |

R-13: 経過時間昇順。不明は末尾、同時間はidのコード単位昇順で固定する。時間はHH:MM:SSで、24時間を越えたら時を巻き戻さない。
要求値model/effortは実際のChatGPT UIや課金レベルの証明ではない。保存文字列を勝手にalias統合しない。

## 6. 24時間の信頼性

R-14: completedAt、なければcreatedAtを結果時刻として、ローリング24時間内のcompleted / partial / error / cancelled件数を集計する。
R-15: evaluated=completed+partial+error。successRate=completed/evaluated。cancelledは分母から除く。evaluated=0はnull、画面はN/A。
failureRate / errorRateはJSONにも表示にも持たない。成功率の画面表示は百分率小数1桁。JSONは丸めない0..1の比率。

## 7. 送信回数

R-16: browser.runtime.promptSubmittedがboolean trueのときだけ初回1件。文字列true、欠損、falseは0。hashの有無を条件にしない。
R-17: completedかつbrowserFollowUpsが有効な配列なら1+長さ。他statusでは初回1件だけ。不正な配列は初回1件と警告。初回のboolean trueがなければcompletedでも0。
R-18: startedAt、なければcreatedAtを使い、24Hと7Dを同時表示。窓は下限・上限を含む。未来日時は集計しない。
R-19: 同一model/effortの組をまとめ、7D=0の行を出さない。CLI --followupで作られる新sessionは別送信として数え、conversationIdで統合しない。
R-20: modelはgpt-6-astra、gpt-5.6-sol、その他の文字列昇順。effortはpro、heavy、extra-high、extended、standard、light、unknown、未知文字列昇順。回数で並べない。
R-21: 画面末尾にOracle経由のみ・直接のChatGPT利用を含まない旨を表示する。開始時刻による代替、途中follow-upの過小計上、Oracle retentionによる履歴欠損を資料に説明する。

回数は送信操作に到達したローカル代理値であり、ChatGPT側の受付・利用枠消費・正確な送信時刻の証明ではない。

## 8. Browser slots

R-22: active=台帳の保存件数。PID照会、heartbeatやstaleによる除外、重複leaseの独自整理をしない。欠損台帳は保存leaseなしとして0。不正／読取不能はnull / N/Aとして警告する。
R-23: 上限は現在セッションの保存値、env、ユーザー設定、既定3の順。複数候補は設計書の決定規則に従う。
R-24: utilization=active/maximum。100%を超えても値はそのまま表示する。棒だけを0..100%へclampする。「正常」「逼迫」といったラベルは作らない。
current sessionsはセッション件数、slotsは選択profileの保存lease件数であり、一致する必要はない。

## 9. 画面とJSON

R-25: ヘッダー、現在セッション、24時間信頼性、モデル／effort送信表、末尾注記を単一画面に表示する。
R-26: 文字幅を考慮しproject/slugを先に短縮する。保護列が物理的に収まらない端末は最小幅不足を明示する。高さ不足は省略件数を明示し、snapshotを案内する。計算結果自体は省略しない。
R-27: JSONはschemaVersion=1を含む完全なDashboardSnapshotを返す。TUIだけの可視行制限はJSONへ持ち込まない。警告はdataWarningsであり、セッション状態の独自分析を含めない。
R-28: ターミナル制御文字を無害化し、表示や終了のために台帳・metadataへ書き戻さない。

## 10. 非機能・完了条件

R-29: macOS、Node 24、TypeScript ESM。軽量なANSI描画を採用する。重量級フレームワークやOracle依存は追加しない。
R-30: pollを重複させず、走査同時数を制限する。独自watch/cache/DBを持たない。実装時に性能fixtureのCPU・メモリ・採取時間を記録する。
R-31: SIGINT/SIGTERM、q、例外でraw mode・cursor・alternate screen・listener/timerを確実に復元する。
R-32: 隔離fixtureを使ったCLI smokeとTUI終了確認、全要件のテスト、typecheck/build/checkが通り、READMEの導入・制約・操作が揃ったとき実装完了。

仕様作成の完了と製品実装の完了は別。本書の受け入れテストは実装計画書へ対応づける。
