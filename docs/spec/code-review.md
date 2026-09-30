# コードレビュー

状態: 初回2軸レビューと対応分析、SP-2修復・SP-3文書同期・最新自動検証を完了。修復checkpoint後の再レビューを待っています。native受け入れは未検証です。Final Quality Gateは実施しません。

## 対象と証拠

- ユーザー指定基準・merge-base: `f5b745107f09421655e05c92c8aef7603e9ee68d`。
- 初回候補: `f33402a8dc664ff02f63c0b09bf9280ab8c64104`。P02〜P10の9コミット・55ファイルを対象とします。
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

## Spec

対象は `f5b745107f09421655e05c92c8aef7603e9ee68d` → `f33402a8dc664ff02f63c0b09bf9280ab8c64104`。HEAD・clean状態は不変。製品全体、13テストsuite、配布／性能harness、CIを照合しました。

(a) 必須事項の不足／一部

- **SP-1：実端末の受け入れが未完了。** [acceptance.md:124](acceptance.md) は「PTY検査と、macOSの実端末での画面・復元確認は両方記録します。」と要求します。[smoke-tty.py:138](../../scripts/smoke-tty.py) と [implementation-report.md:801](implementation-report.md) はnative確認を未検証としています。指定寸法、resize、終了経路における画面・復元・shell入力の証拠がないため、A21／A27／A28／A47と製品完了条件は未達です。指定ケースを実端末で記録するまで未検証を維持してください。観測された製品不具合ではありません。

(b) 未要求の振る舞い：なし。

(c) 実装／正式契約との不一致

- **SP-2：大量の有効行で描画が失敗。** [requirements.md:39](requirements.md) は「全行・全警告を出力」、[design.md:574](design.md) は「単発テキスト／JSONは全件を返します。」と要求します。[text.ts:165](../../src/render/text.ts) が全行を `Math.max` の引数へ展開します。メモリ内のcurrent 130,000行で、snapshotテキストと120×32 TUIの双方に `RangeError` を再現しました。CLI／TUIは終了コード1となり、全件出力も省略表示も成立しません。幅の最大値を反復計算し、件数上限を追加せず大量行の回帰検証を追加してください。

- **SP-3：check順序の正式契約が未同期。** [implementation-plan.md:52](implementation-plan.md) は「`check=format:check→typecheck→test→build` を固定します。」と要求します。[package.json:14](../../package.json) はbuild→testです。 `npm run check`で必ず差異が生じます。[report:506](implementation-report.md) に合理的な変更理由がありますが、正式Planとreport:20が旧契約のままです。fresh checkoutで成立する現行順序を正式Plan・説明へ同期してください。

既存257テスト等はrootの証拠を参照し、再実行していません。描画再現はメモリ内のみで、ファイル変更はありません。

## Response analysis

# 初回レビューの対応判断

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


## 修復後の証拠

SP-2は全行の反復maxへ変更し、公開renderTextの130000行・両表/全snapshot/省略表示で真正assertion Red→Greenを記録しました。SP-3はP08で採用済みのbuild→testへPlanとreportを同期しました。測定harnessの期限前復帰も公開fake clockでassertion Red→Greenにしました。元27pair/初回pass回帰と追加2pair/回帰2件を区別します。primaryは元ログhashとassertionを独立照合し、全261件/13suiteのcheckを再実行してexit0を確認しました。

最新installed CLI6/PTY9、read-only、通常ホスト上の正式60秒は成功です。CPU4.7249%、peak RSS111.7813MiB、p9597.6203ms、30scan、scan/read peak1、入力不変です。Codex sandboxではCPU5.6175%で不合格でした。8scanの環境A/B/Aで同じ読取回数・Snapshotとsystem時間の差を確認した後、通常ホストの正式測定を別jobで実施しました。失敗値の補正・予算/guard/容量制限の変更はありません。詳細はimplementation-report.mdに記録します。

sourceSHA `ec5d3d95c0b95e5450f27c9429f6c8114074edb851202246492afa5fa7aef8ff`、distSHA `94e0f9e5ea456599219588cce987eef88044ed7c6398597c6fa7a21e8aac2917`が現在/導入済み/正式測定で一致します。SP-1のnative gapは残しています。修復候補のSHAを固定し、同じ2軸で再確認します。

初回件数: Standardsは標準逸脱1件（既知の履歴）・判断事項3件、Specは不足/一部1件・未要求0件・不一致2件。各軸は順位付けされておらず、軸間の順位も付けません。
