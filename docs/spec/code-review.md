# コードレビュー

状態: 初回2軸レビュー、対応分析、SP-2修復・SP-3文書同期、修復候補の2軸再レビューと最新自動検証を完了しました。新規指摘はなく、native受け入れのみ未検証です。Final Quality Gateは実施しません。

## 対象と証拠

- ユーザー指定基準・merge-base: `f5b745107f09421655e05c92c8aef7603e9ee68d`。
- 初回候補: `f33402a8dc664ff02f63c0b09bf9280ab8c64104`。P02〜P10の9コミット・55ファイルを対象とします。
- 修復候補・再レビュー対象: `75a84e74422818676821d3afb58a250b0ee1a208`。同じ基準/merge-baseから全10コミット・56ファイルを対象とし、修復差13ファイルを重点確認しました。未変更部分は初回調査を継承しています。
- command: `git diff f5b745107f09421655e05c92c8aef7603e9ee68d...f33402a8dc664ff02f63c0b09bf9280ab8c64104`。
- log: `git log f5b745107f09421655e05c92c8aef7603e9ee68d..f33402a8dc664ff02f63c0b09bf9280ab8c64104 --oneline`。
- 2つの独立したread-only agentが規約と仕様を別々にレビューしました。両方の完了とHEAD/clean一致を確認してから、primaryが指摘・自動検証・coverage gapをまとめて分析しています。
- 規約はAGENTS.mdとFowlerの12 heuristic、仕様は正式なrequirements/design/plan/acceptance/boundary/schema/verificationです。テスト・実装報告は意図を上書きするauthorityとして扱いません。
- 初回候補のprimary証拠: 全257件/13suite、format/typecheck/build、installed CLI6件、PTY9件、read-only検査、HTML validatorがexit0。正式製品60秒のCPU4.56811955%、peak RSS111.46875MiB、p95117.161208ms、scan/read peak1、入力不変と候補source/dist一致を確認しました。
- code-review skillの「If `docs/agents/issue-tracker.md` is missing, run `/setup-matt-pocock-skills`.」に該当しますが、trackerとsetup機能が利用できません。受け入れ済みのdocs/specを仕様の参照元へ直接指定しました。
- [code-review](/Users/iwasawayuuta/.agents/skills/code-review/SKILL.md)、[analyze-review-findings](/Users/iwasawayuuta/.agents/skills/analyze-review-findings/SKILL.md)を使用しました。親workflowは必須検証と実端末の不足で全体完了を保留し、任意のP severityや認証gateを追加しません。ユーザー認可はscope内TDD修復・文書・local checkpointで、remote操作は含みません。

## Standards

確認対象は `f5b745107f09421655e05c92c8aef7603e9ee68d...f33402a8dc664ff02f63c0b09bf9280ab8c64104`。終了時も候補HEAD一致、mainはcleanです。

**文書化された標準の逸脱**

- **ST-1（既知の手順逸脱）** — `AGENTS.md:16` の「Run focused Red -> Green steps in docs/spec/implementation-plan.md」と、同計画`:9` の「期待値のassertionでRed」に対し、`implementation-report.md:314–319` はP06の2件が未処理ENOENTによる例外Redだったと記録しています。I/O例外が期待値assertionへ到達せず、所定のRed証拠になりません。現在は正式なassertion Red件数から除外済みです。この区別を維持し、後続では`resolves`等を使用してください。履歴の人工的な再生成は不要です。

現行製品コードに、ほかの文書標準違反は確認できませんでした。

**判断事項（違反ではありません）**

- **ST-2 — possible Duplicated Code**。`config.ts:142–146`、`model/normalize.ts:198–202`、`io/leases.ts:128–132` に同一のown-property境界があります。引用：`return Object.getOwnPropertyDescriptor(value, key)?.value;`。各入力投影で到達し、境界変更時に三箇所の整合が必要です。object検査を含む小さな純粋関数へ共通化する余地があります。
- **ST-3 — possible Duplicated Code / Shotgun Surgery**。`model/normalize.ts:185`、`render/width.ts:8`、`render/json.ts:4` に制御文字集合が重複しています。引用：`\u007f-\u009f\u2028\u2029\u061c…\u2066-\u2069`。該当文字を含む保存値では、警告検知・text置換・JSON escapeが別実装を通ります。将来の集合変更で対応漏れが起こり得るため、共通の文字集合を定義し、JSON.stringifyによるC0処理の差を保持してください。
- **ST-4 — possible Mysterious Name**。`io/json-reader.ts:112–192`、`io/sessions.ts:64–173`、`io/leases.ts:28–83` の`ioResult1`〜`ioResult10`。引用：`const ioResult7 = io.lstat(path);`。通常readで使われ、変更検査の段階を名前から識別できません。 `finalPathStatResult`等へ局所的に改名する余地があります。

Fowlerの12項目を検討し、承認済みadapter等は除外しました。製品ソース・文書・CI・harnessを静的確認し、テストは境界・fixture・helperを重点抽出しました。テスト／buildは実行していません。native端末確認は未検証です。標準逸脱1件、判断事項3件。順位付けはしていません。

### 再レビュー（75a84e7）

全56ファイル・10コミットの規約軸で、新規指摘はありません。対象は `f5b745107f09421655e05c92c8aef7603e9ee68d...75a84e74422818676821d3afb58a250b0ee1a208` です。

**文書化された標準の逸脱**

- **ST-1：既知の履歴逸脱を維持。** `AGENTS.md:16` の「Run focused Red -> Green steps in docs/spec/implementation-plan.md」、同計画`:9` の「期待値のassertionでRed」に対する、P06の例外Red2件です。I/O例外がassertionへ到達しなかった記録と正式件数からの除外は、`implementation-report.md:314–321` に保持されています。遡及的な人工Redは不要です。
- 新規の文書標準違反は確認できませんでした。

**判断事項**

既存の3件は変更されておらず、保守候補として残ります。

- **ST-2 — possible Duplicated Code**：`config.ts:142`、`model/normalize.ts:198`、`io/leases.ts:128` の `Object.getOwnPropertyDescriptor(value, key)?.value`。入力境界変更時に三箇所の整合が必要です。小さな共通関数への整理候補です。
- **ST-3 — possible Duplicated Code / Shotgun Surgery**：`model/normalize.ts:185`、`render/width.ts:8`、`render/json.ts:4` の制御文字集合。該当文字を含む入力で検知・置換・escapeが別実装を通り、集合変更時の対応漏れが起こり得ます。C0処理の意図的な差を保つ共通定義が候補です。
- **ST-4 — possible Mysterious Name**：`io/json-reader.ts:112`、`io/sessions.ts:64`、`io/leases.ts:28` の `ioResult1` 等。通常readの検査段階を名前から識別しづらく、段階を表す局所的な改名が候補です。

修復差13ファイルを重点確認しました。`text.ts:165–170` の反復max、`performance.mjs:2–10,139–142` の期限再検査、追加テストと正式check順序の同期に、新たな規約上の問題は見つかりませんでした。Fowlerの12項目はheuristicとして検討しました。

未変更部分は初回の製品ソース・文書・CI・harness静的調査を継承しています。初回テスト調査は境界・fixture・helperの重点抽出です。今回もテスト／build／性能／CLI／PTY／HTML／ZIP検査は再実行せず、rootの証拠を参照しました。native画面・shell入力は未検証です。

終了HEADは候補SHAと一致し、mainはclean・ahead10。既存標準逸脱1件、判断事項3件、新規0件。順位付けはしていません。

## Spec

対象は `f5b745107f09421655e05c92c8aef7603e9ee68d` → `f33402a8dc664ff02f63c0b09bf9280ab8c64104`。HEAD・clean状態は不変。製品全体、13テストsuite、配布／性能harness、CIを照合しました。

(a) 必須事項の不足／一部

- **SP-1：実端末の受け入れが未完了。** [acceptance.md:124](acceptance.md) は「PTY検査と、macOSの実端末での画面・復元確認は両方記録します。」と要求します。[smoke-tty.py:138](../../scripts/smoke-tty.py) と [implementation-report.md:801](implementation-report.md) はnative確認を未検証としています。指定寸法、resize、終了経路における画面・復元・shell入力の証拠がないため、A21／A27／A28／A47と製品完了条件は未達です。指定ケースを実端末で記録するまで未検証を維持してください。観測された製品不具合ではありません。

(b) 未要求の振る舞い：なし。

(c) 実装／正式契約との不一致

- **SP-2：大量の有効行で描画が失敗。** [requirements.md:39](requirements.md) は「全行・全警告を出力」、[design.md:574](design.md) は「単発テキスト／JSONは全件を返します。」と要求します。[text.ts:165](../../src/render/text.ts) が全行を `Math.max` の引数へ展開します。メモリ内のcurrent 130,000行で、snapshotテキストと120×32 TUIの双方に `RangeError` を再現しました。CLI／TUIは終了コード1となり、全件出力も省略表示も成立しません。幅の最大値を反復計算し、件数上限を追加せず大量行の回帰検証を追加してください。

- **SP-3：check順序の正式契約が未同期。** [implementation-plan.md:52](implementation-plan.md) は「`check=format:check→typecheck→test→build` を固定します。」と要求します。[package.json:14](../../package.json) はbuild→testです。 `npm run check`で必ず差異が生じます。[report:506](implementation-report.md) に合理的な変更理由がありますが、正式Planとreport:20が旧契約のままです。fresh checkoutで成立する現行順序を正式Plan・説明へ同期してください。

既存257テスト等はrootの証拠を参照し、再実行していません。描画再現はメモリ内のみで、ファイル変更はありません。

### 再レビュー（75a84e7）

全56ファイル・10コミットの範囲で、新たな仕様不一致は確認できませんでした。変更13ファイルを重点確認し、未変更部分は初回の製品全体・13suite・CI／harness調査を継承しました。

(a) 必須事項の不足／一部

- **SP-1：継続。** [acceptance.md:124](acceptance.md) の「PTY検査と、macOSの実端末での画面・復元確認は両方記録します。」に対し、[smoke-tty.py:138](../../scripts/smoke-tty.py)、[report:801](implementation-report.md) はnative未検証を維持しています。指定寸法・resize・終了経路での画面／shell入力の証拠がなく、A21／A27／A28／A47・R32は未完了です。CUAのアプリ安全規則による制約が残ります。指定ケースの実端末記録まで未検証を維持してください。製品不具合の観測ではありません。

(b) 未要求の振る舞い：なし。

(c) 実装／正式契約との不一致

- **SP-2：解消。** [design.md:50](design.md) の「各列の最大幅はheaderを起点に全行を反復して求めます。」に [text.ts:165](../../src/render/text.ts) が一致します。Node 24.14.0のメモリ内再現でcurrent／usage各130,000行、双方の末尾、末尾警告を全文出力でき、TUIは31行・省略表示2件となりました。引数上限による失敗経路は除去され、件数上限の追加もありません。不可視行の保護列幅・Unicode回帰も照合しました。
- **SP-3：解消。** [Plan:52](implementation-plan.md) の「`check=format:check→typecheck→build→test` を固定します。」がpackage.json:14・CI:20–23と一致します。report:20も旧P02定義を履歴として区別し、check実行時の契約差異は解消しています。

性能harnessの期限再検査もdesign:671と一致し、算出式・予算は維持されています。ZIP／manifest一致をread-onlyで確認しました。261テスト・CLI／PTY・正式性能はroot証拠を参照し、再実行していません。sandbox CPU不合格は通常ホスト成功と別記録です。

終了時HEADは `75a84e74422818676821d3afb58a250b0ee1a208` と一致、main clean／ahead10。変更はありません。

## Response analysis

### 初回レビューの対応判断

候補: f33402a8dc664ff02f63c0b09bf9280ab8c64104。基準/merge-base: f5b745107f09421655e05c92c8aef7603e9ee68d。両reviewと必要な自動検証は完了し、HEAD/clean一致を再確認した。analyze-review-findingsを適用し、source-native区分を保持する。P severity/Final Quality Gateを追加しない。

| ID | 妥当性・到達条件・影響 | authority/最初のfault layer | 主route・認可・検証・親への結果 |
|---|---|---|---|
| ST-1 標準逸脱（既知の手順逸脱） | 有効。P06の2Redは未処理ENOENTで期待値assertionを経由しなかった。現在のGreenと他のassertion証拠は独立確認済み。元履歴の欠陥は遡及修復できない | AGENTS.mdとPlan共通規律/test証拠 | documentation-correction。既存の除外・逸脱記録を保持しreviewへ対応付ける。既往を正常TDDと表示せず、人工Red/元ログ改変を行わない。現在の製品修復を妨げないが履歴逸脱の開示を維持 |
| ST-2 判断事項/possible Duplicated Code | own-property関数3つの重複は実在。getter/継承を使わない境界は同一。現時点の意味不一致は未検出 | Fowler heuristic/保守時の重複 | out-of-scope-follow-up。保守候補として親review文書へ記録。公開保証の不足を示さないため今回のbugfixは増やさない |
| ST-3 判断事項/possible Duplicated Code・Shotgun Surgery | 共通制御文字集合の重複は実在。JSON側C0を除く差はJSON.stringifyのescapeを用いる意図的処理。検知・text無害化・JSON復元の既存literal assertionはpass | Fowler heuristic/保守時の重複 | out-of-scope-follow-up。文字集合変更時の整合候補を記録。現在の保存値/端末安全性の違反とはしない |
| ST-4 判断事項/possible Mysterious Name | ioResult連番は段階を名前から識別しづらい。制御・変更検知の誤りを示す証拠はない | Fowler heuristic/可読性 | out-of-scope-follow-up。命名候補として記録。公開振る舞いの修復へ混ぜない |
| SP-1 不足/一部 | 有効。指定native画面/shell復元は未検証。自動PTYは別証拠。製品不具合という主張ではないがA21/27/28/47・R32完了を妨げる | acceptance.md:124/外部UI環境 | external-blocked。Terminal/Ghostty CUAアプリ安全規則が制約。許可されたUI又は人間の指定寸法/終了4経路の観測で解消。回避せず未検証を維持。全独立作業を継続し、人間の結果を待つ |
| SP-2 実装/正式契約との不一致 | 有効。widthsが全rowsをMath.max引数に展開し、多数の有効current/usage行でJS引数上限に達する。snapshot/TUIとも同じ関数へ到達する。仕様に総件数上限はない | R03・Design単発全件/実装widths | implementation-remediation。ユーザーのTDD実装/不具合修復認可内。header幅を基準にrowを反復しpairwise maxで最大幅を求める。行数制限、cache、表示省略前の幅計算変更は加えない。公開renderTextで130000行のassertion Red→Green、全文/末尾/省略/幅とUnicodeの回帰、最新check/package/PTY/正式60s測定、修復候補の再reviewを実施 |
| SP-3 実装/正式契約との不一致 | 有効。現行check/CIはformat→typecheck→build→test、Plan:52とreport:20は旧test→build。built CLIのdist依存とP08 fresh証拠が現行順の理由 | Plan P02完了条件/正式文書の同期漏れ | documentation-correction。P08で採用済みの機械的順序へ現行Planを同期し、reportはP02の元定義を維持して現行差分を注記。全検査/製品意味/実装担当/remote境界を変えない。package/CIの実順との照合とplanning検査。人間のmaterial判断は不要 |

全指摘・coverage gapにrouteを割当てた。rootは文書訂正、既存GPT 6.1 Sol / High writerは限定されたSP-2のTDD修復を担当する。source変更により旧性能・旧tarball証拠を最新候補へ流用せず再測定/再packする。修復後にSHAを固定して同じ2review軸へ確認を依頼し、両結果完成後に新batchを分析する。native gapは残し、全体完成とは宣言しない。


### 再レビューの対応判断

候補: 75a84e74422818676821d3afb58a250b0ee1a208。基準/merge-base: f5b745107f09421655e05c92c8aef7603e9ee68d。両独立reviewの完了、全必要な自動検証の元job完了、HEAD/clean一致を確認してanalyze-review-findingsを適用しました。source-native区分と既存IDを維持し、P severity/Final Quality Gate/追加remote操作は導入しません。

| ID / source区分 | 妥当性・到達条件・影響 | authority/最初のfault layer | route・認可・検証・親への結果 |
|---|---|---|---|
| ST-1 文書標準/既知の履歴逸脱 | P06の2Redは期待値assertionへ到達しなかった実在の履歴欠陥。元証拠・除外・現在のGreenの区別は保持済み | AGENTS.md:16とPlan:9/test証拠 | documentation-correctionの記録対応済み。過去を正常TDDへ書き換えず、遡及人工Redをしない。現行コードの新規違反ではない。履歴逸脱の開示を継続 |
| ST-2 判断事項/Duplicated Code | 3つのown-property境界に重複が残る。現行の意味不一致/公開保証不足は未検出 | Fowler heuristic/保守 | out-of-scope-follow-up。初回記録を保守候補として保持。今回の修復へ共通化を追加しない |
| ST-3 判断事項/Duplicated Code・Shotgun Surgery | 制御文字集合の重複は残る。JSONのC0除外は意図的で、既存text/JSON/警告の期待値は成功 | Fowler heuristic/保守 | out-of-scope-follow-up。意図的な差を保つ整理候補を保持。未検出の保証違反を推測で扱わない |
| ST-4 判断事項/Mysterious Name | ioResult連番の検査段階が読みにくい。変更検知/制御の誤りは未検出 | Fowler heuristic/可読性 | out-of-scope-follow-up。命名候補を保持し製品振る舞いの修復へ混ぜない |
| SP-1 必須不足/一部 | 有効・継続。native画面/shellは未検証。PTYは別証拠でA21/27/28/47・R32の完了を妨げる | acceptance.md:124/外部UI環境 | external-blocked。Terminal/GhosttyのCUAアプリ安全規則が制約。既存認可内のUI検査又は人間の指定寸法/終了4経路の結果が必要。別経路で回避しない。全独立作業は完了させ、全体完了を保留 |
| SP-2 実装/正式契約不一致 | 修復検証済み・解消。全行の反復maxで引数上限の到達経路を除去。件数上限なし。各130000行の全文/末尾/警告とTUI省略、全行必要幅/Unicodeを維持 | R03/Design全件契約・text.ts:165の実装 | implementation-remediation完了。ユーザーのTDD不具合修復認可内。真正assertion Red→Green、primary全261件、導入CLI6/PTY9、同じ最新source/distの正式host性能と独立Specのメモリ内再現で確認 |
| SP-3 実装/正式契約不一致 | 文書同期済み・解消。現行Planのformat→typecheck→build→testがpackage/CIに一致し、reportは元P02を履歴へ区別 | Plan:52/文書同期 | documentation-correction完了。P08で採用済みの機械的順序だけを反映。製品意味/実施検査を変えず人間のmaterial判断は不要 |

開発用harnessの期限再検査はtest-remediationを完了しています。公開fake clockのassertion Red→Green/末端回帰、正式60秒30scan、全process算出/予算維持を確認しました。sandbox CPU不合格と通常ホスト成功は別記録のままで、guardや容量制限の変更・失敗値の補正はありません。

新規指摘0。Standardsは既知の履歴逸脱1と判断事項3を保持。Specは不足/一部1、未要求0、未解消の実装不一致0で、初回SP-2/3の履歴を消しません。レビュー担当は変更13ファイルを重点確認し未変更部分は初回調査を継承、実行検証はprimaryの証拠を参照しました。独立Specは大量行をメモリ内で再現しました。全範囲56ファイル/10コミットの結論です。

親workflowには「コードレビュー/修復と自動検証は完了、native受け入れのみ未検証」を返します。最終記録の確定は文書/ZIP/manifestのみのcheckpointとし、実行コード・テスト・harness・最新tarballは変更しません。同じコードに対する不要な全検証や正式性能の再実行はせず、文書整合性・ZIPのsource/hash/CRC/再現性・staged diffを検査します。実装のremote pushは未認可のまま実施しません。


## 修復後の証拠

SP-2は全行の反復maxへ変更し、公開renderTextの130000行・両表/全snapshot/省略表示で真正assertion Red→Greenを記録しました。SP-3はP08で採用済みのbuild→testへPlanとreportを同期しました。測定harnessの期限前復帰も公開fake clockでassertion Red→Greenにしました。元27pair/初回pass回帰と追加2pair/回帰2件を区別します。primaryは元ログhashとassertionを独立照合し、全261件/13suiteのcheckを再実行してexit0を確認しました。

最新installed CLI6/PTY9、read-only、通常ホスト上の正式60秒は成功です。CPU4.7249%、peak RSS111.7813MiB、p9597.6203ms、30scan、scan/read peak1、入力不変です。Codex sandboxではCPU5.6175%で不合格でした。8scanの環境A/B/Aで同じ読取回数・Snapshotとsystem時間の差を確認した後、通常ホストの正式測定を別jobで実施しました。失敗値の補正・予算/guard/容量制限の変更はありません。詳細はimplementation-report.mdに記録します。

sourceSHA `ec5d3d95c0b95e5450f27c9429f6c8114074edb851202246492afa5fa7aef8ff`、distSHA `94e0f9e5ea456599219588cce987eef88044ed7c6398597c6fa7a21e8aac2917`が現在/導入済み/正式測定で一致します。修復候補75a84e7の2軸再確認も完了し、SP-2/3の解消と新規指摘0を確認しました。SP-1のnative gapは残しています。

初回件数: Standardsは標準逸脱1件（既知の履歴）・判断事項3件、Specは不足/一部1件・未要求0件・不一致2件。各軸は順位付けされておらず、軸間の順位も付けません。
