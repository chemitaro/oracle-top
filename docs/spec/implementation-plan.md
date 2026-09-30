# 実装計画書

状態: 正式版（2026-09-30採用）。同一会話のStrict相談をローカルOracle根拠へ照合済み。実装開始時に採用した計画です。現在の工程と検証証拠は[実装報告](implementation-report.md)に記録します。

## 共通規律

実装担当: **GPT 6.1 Sol / High**。準備段階でP01を完了し、readiness.ready=trueとその証拠を確認してP02から順番に実装します。工程の実施状況は[作業計画](../work-plan.md)と[実装報告](implementation-report.md)を参照してください。

各振る舞いについて、型付きの公開境界と実行可能な最小stubを用意し、期待値のassertionでRedを確認してからGreenにします。import失敗、依存不足、テスト0件をRed証拠にしません。一括で全ケースを書いてから実装する進め方は採りません。

各段階のGreen後は、対象テスト・typecheck、report更新、明示パスstage、staged diff全体確認、`commit-codex -a` の順です。このcheckpoint規律はルート `AGENTS.md` に従います。

記載したcheckpoint名はcommitの意図です。計画実行中は各段階の状態・検証・SHAを `docs/spec/implementation-report.md` へ記録します。push、publish、releaseは本計画に含めません。

## P01 — 正式R/D/Pの採用・文書同期

**依存：** 相談回答とローカル根拠の照合（完了）です。
**対象：** `docs/spec/{requirements,design,implementation-plan,acceptance,consultation,verification}.md`、Schema、例、`readiness.json`、`scripts/check-planning.py`、関連するREADME／overviewの矛盾箇所です。
**公開境界：** 計画検査コマンドです。

文書・Schema・例の整合を検査します。製品テストのRed→Greenを実施したとは扱いません。

```bash
python3 scripts/check-planning.py
```

**完了条件：** 全8境界が文書化され、R-ID・Schema・例・計画が一致することです。Codexが採用した段階で `verifiedInputCommit` を今回の完全SHAへ更新し、consultResultを記録します。`ready=true` はその照合後に限り、`implementationStarted=false` は維持します。

**Checkpoint：** `docs: formalize oracle-top requirements and implementation contract`

P01完了時点では採用・照合・資料検証によりreadinessをreadyとし、ツール本体は未開始でした。現在の実装開始状態はreadiness.jsonのimplementationStartedと実装報告に記録します。

## P02 — Node／TypeScript基盤

**依存：** P01です。
**対象：** `package.json`、`package-lock.json`、tsconfig群、Prettier設定、CI、`src/model/dashboard.ts`、実装reportです。
**公開境界：** パッケージと型契約です。

基盤設定を写すだけのテストは作りません。依存をexact versionとlockfileへ固定し、ESMのコンパイル結果と型検査を確認します。実際の振る舞いテストはP03から開始します。P02で空のtest suiteを成功扱いする設定は加えません。

最初にpackage.jsonへtype=module、private=true、engines.node=">=24 <25"、scriptsを記述し、src/model/dashboard.tsの型を設計書から作成します。初回のlockfile生成は以下のinstallで行い、その後にciを実行します。通常キャッシュへの書込権限に依存しないよう、Git管理外の作業用cacheを指定します。

```bash
npm install --save-exact json5@2.2.3 string-width@8.3.0 --cache .workbench/npm-cache
npm install --save-dev --save-exact typescript@7.0.2 @types/node@24.19.0 vitest@5.0.2 prettier@3.9.9 ajv@8.20.0 --cache .workbench/npm-cache
npm ci --cache .workbench/npm-cache
npm run typecheck
npm run build
node --input-type=module -e "import('./dist/model/dashboard.js')"
```

**完了条件：** Node 24でESM出力でき、ESMをimportでき、runtime直接依存が2つであることです。`test=vitest run`、`typecheck=tsc --noEmit`、`build=tsc -p tsconfig.build.json`、`check=format:check→typecheck→build→test` を固定します。

P08で追加したbuilt CLIの検証はdistを必要とするため、checkとCIはtestより先にbuildします。これはP08で新規checkout相当の隔離検証を経て採用した順序の同期です。実施する検査と製品の契約は変えません。

**Checkpoint：** `build: establish minimal node24 esm toolchain`

## P03 — 上限付き読み取り境界

**依存：** P02です。
**対象：** `src/io/json-reader.ts`、`tests/json-reader.test.ts`、合成fixtureです。
**公開境界：** `readJsonFile` です。

正常JSON→JSON5→サイズ境界→不正encoding→symlink→read中変更の順に、一件ずつRed→Greenを行います。

具体例は、空白paddingを含むちょうど1,048,576 bytesの有効JSONを受理し、1,048,577 bytesを `FILE_TOO_LARGE` で隔離するfixtureです。symlink fixtureは参照先をopenしないことも検査します。

```bash
npm test -- tests/json-reader.test.ts -t "rejects-over-limit-file"
npm test -- tests/json-reader.test.ts
npm run typecheck
```

**完了条件：** 上限、通常file、decode、parse、変更検出、finally closeが公開結果で検証されることです。

**Checkpoint：** `feat: add bounded read-only document reader`

## P04 — 設定と独立したroot/profile解決

**依存：** P03です。
**対象：** `src/config.ts`、`tests/config.test.ts`です。
**公開境界：** `resolveMonitorConfig` です。

既定値→homeだけ変更→profile env→JSON5 config→不正値の順に一件ずつ追加します。

```text
osHome=/tmp/user
ORACLE_HOME_DIR=/tmp/store

期待:
sessions=/tmp/store/sessions
profile=/tmp/user/.oracle/browser-profile
```

JSON5 fixtureにコメント、末尾カンマ、無関係な秘密項目を含め、許可2項目以外が戻り値に残らないことを確認します。

```bash
npm test -- tests/config.test.ts -t "home-override-does-not-move-profile"
npm test -- tests/config.test.ts
npm run typecheck
```

**完了条件：** パス・設定・intervalの優先順位がliteral期待値で確定することです。

**Checkpoint：** `feat: resolve independent oracle home and profile`

## P05 — セッション投影・日時・未知値

**依存：** P04です。
**対象：** `src/model/{session,normalize,time}.ts`、`tests/{normalize,time}.test.ts`です。
**公開境界：** `normalizeSession`、`parseIsoTimestamp`です。

browser/GPT→API除外→Gemini除外→未知model＋ChatGPT URL→mode欠損→未知status→日時→follow-upの順です。

具体例：

```text
mode=browser, model=custom-model,
browser.runtime.tabUrl=https://chatgpt.com/c/example
→ 対象、modelはcustom-modelのまま

同じ内容でmode欠損
→ 除外、MODE_UNRESOLVED
```

```bash
npm test -- tests/normalize.test.ts -t "includes-unknown-model-with-chatgpt-url"
npm test -- tests/normalize.test.ts tests/time.test.ts
npm run typecheck
```

**完了条件：** unknown入力を安全に投影し、保存名を勝手に変換せず、不完全値を決定済みの規則で扱うことです。

**Checkpoint：** `feat: normalize supported oracle metadata without inference`

## P06 — 走査・集計・capacity・Snapshot

**依存：** P05です。
**対象：** `src/io/{sessions,leases}.ts`、`src/aggregate.ts`、`tests/{collectors,dashboard}.test.ts`です。
**公開境界：** `collectInputs`、`buildDashboard`です。

全走査→破損隔離→current順→reliability→送信窓→follow-up→sort→profile別maxの順です。

固定nowは `2026-09-30T06:00:00.000Z` とします。

```text
24 completed + 2 partial + 4 error + 1 cancelled
→ evaluated=30, successRate=0.8

completed + true + followUps2
→ 24H=3, 7D=3

root読取不能
→ セッション関連3領域=null
```

```bash
npm test -- tests/dashboard.test.ts -t "counts-submitted-completed-followups"
npm test -- tests/collectors.test.ts tests/dashboard.test.ts
npm run typecheck
```

**完了条件：** 全件走査、最大8read、算術不変条件、固定順、unknownと0、max競合が検証されることです。

**Checkpoint：** `feat: build deterministic dashboard snapshots`

## P07 — 共通テキスト／JSON描画

**依存：** P06です。
**対象：** `src/render/{text,width,json}.ts`、`tests/{render,schema}.test.ts`、Schema・例の同期です。
**公開境界：** `renderText`、`serializeJson`です。

6列→N/A→幅→高さ→制御文字→JSON round-trip→Schema negative casesの順です。

具体fixtureはcurrent10件・usage9件です。body割当てが各4行なら、current3件＋`7 more`、usage3件＋`6 more`を期待します。full text／JSONには10件・9件すべてが残ります。

```bash
npm test -- tests/render.test.ts -t "reports-omitted-rows-per-section"
npm test -- tests/render.test.ts tests/schema.test.ts
npm run typecheck
```

**完了条件：** 全行の表示幅上限、保護列、明示省略、全件出力、安全なJSON round-trip、閉じたSchemaが確認できることです。

**Checkpoint：** `feat: render one-screen and complete snapshot outputs`

## P08 — CLI・単発プロセス契約

**依存：** P07です。
**対象：** `src/cli.ts`、`package.json`のbin、`tests/cli.test.ts`です。
**公開境界：** built CLIのargv／env／stdout／stderr／exitです。

help/version→snapshot text→JSON→不正引数→非TTY→警告付き成功→EPIPEの順です。

隔離fixtureで `snapshot --json` をspawnし、JSONが一文書、stderrが空、exit0を期待します。非TTYで引数なしならstdout空・exit2です。

```bash
npm run build
npm test -- tests/cli.test.ts -t "emits-one-json-document"
npm test -- tests/cli.test.ts
npm pack --dry-run
```

**完了条件：** `bin` が `dist/cli.js` を指し、単発出力がTUIやOracleを起動しないことです。

**Checkpoint：** `feat: expose read-only snapshot cli`

## P09 — TUIライフサイクル

**依存：** P08です。
**対象：** `src/tui.ts`、`tests/tui.test.ts`です。
**公開境界：** terminal／timer／collector adapterを注入した `runTui` です。

初回即時→2秒tick→遅いscan→resize→q→ETX／SIGINT→SIGTERM→例外→drain／EPIPE→late resultの順です。

```text
interval=2,000ms、初回scan完了=5,000ms
→ 次回開始=6,000ms、同時scan最大1

resizeを連続発火
→ collect呼出し回数は増えない

q後に採取Promiseをresolve
→ 再描画しない
```

```bash
npm test -- tests/tui.test.ts -t "skips-missed-ticks-without-overlap"
npm test -- tests/tui.test.ts
npm run typecheck
```

**完了条件：** 停止・復元・遅延結果破棄・非重複描画が確認できることです。

**Checkpoint：** `feat: add bounded polling tui lifecycle`

## P10 — 配布・TTY・安全性・性能・最終文書

**依存：** P09です。
**対象：** `tests/{integration,performance}.test.ts`、smoke／performance用script、README、受け入れ表、実装report、CIです。実測で必要になった最小の内部I/O改善は下記の順で実施します。
**公開境界：** tarballから導入したCLIと実TTYです。

未対応の全A-caseを一件ずつRed→Greenで閉じます。文書にpassを書くことでテストを通したことにはしません。

具体fixtureは1,000件×16KiB以下です。読取前後のtree、内容hash、mtime、modeを比較し、スロット台帳を含め変更がないことを確認します。OSによるatime更新は、この書込み禁止証拠の比較対象から除きます。

### 実測を受けた内部I/O改善の順序（2026-10-01）

元の60秒測定でCPU超過を確認しました。設計5.1／5.6／5.8／5.9の補足に従い、保存値・全件再読込・変更検知・終了時の復元・同時scan1／read最大8を維持します。試作の数値を製品の合格証拠として流用しません。

1. `src/io/read-buffer.ts` とreaderの任意poolを追加します。排他貸出、成長copy、上限1MiB+1、旧領域・返却時のzero化、finally返却を検証します。stat.size到達時の条件付きEOF省略も別のfocused Red→Greenにし、size未達short read、size0、途中grow、全post検査、abort／closeの既存証拠を維持します。
2. `src/io/collector.ts` の `createInputCollector`／collect／stopと最小WorkerPortを実行可能stubで用意します。`workerFactory`でOS境界だけを注入し、遅延起動、1本再利用、nowの1回捕捉、必要設定の固定、非重複を公開結果からRed→Greenにします。export／compile失敗をRedとは扱いません。
3. collector側で、`normalizeSession`が返したNormalizedSessionだけをstructuredCloneします。Unicodeを含む保存文字列と集計値の同値性を確認し、原文backing storageの保持と性能の関係は測定で確認します。実装呼出しを写すだけのtestや、初回から通る回帰testをRed証拠にしません。
4. `src/io/collector-worker.ts`へ同期read-only adapter、共有停止flag、計数だけのmetricsを実装します。mainでは同期filesystem syscallを呼ばず、workerの全readにも既存guardを使います。最大1MiBの有効file、入力保存値、返信停止中のabort、error／exit、遅延返信、停止後の再生成禁止、idle stopを検証します。nursery以外へ追加の容量制限を設けません。
5. CLIのsnapshotをfinally stop、Node TUIを同じcollector＋任意dispose hookへ接続します。dispose失敗でも復元を続け、q／ETX／SIGINT／SIGTERMと130／143優先、注入I/O経路、worker未完了でも始まる復元をfocused Red→Greenで確認します。
6. 全checkを通し、最新buildを再pack・offline installしてCLI／PTYを再検証します。同じ製品worker経路で、起動を含む60秒の全process CPU／peak RSS／採取p95を再測定します。事前hash／tree準備は別process、終了後の不変確認は測定値固定後です。超過が残ればpassにせず原因へ戻ります。実端末確認、A01〜A49の最終表、コードレビュー、文書・artifactの同期は続けて実施します。

追加の原因比較で必要となる等価整理は、guardの事前組立て、reader／sessions／leasesでの同期値とPromise-likeの正しい受理、全件幅を維持した可視行のformatです。既存の公開結果、非同期・同期I/O、別realm／thenable、abort／変更／close失敗を回帰検証します。意味を変えない整理に人工的なRedを作らず、新しい振る舞いのassertion Red→Greenと区別します。採用ごとの比較と正式測定を別ログへ残し、予算・file検査・停止保証を緩めません。

```bash
npm ci
npm run typecheck
npm run build
npm test
npm run check

npm run smoke:cli
npm run smoke:tty
npm run perf
python3 scripts/check-planning.py
```

`smoke:cli` は `.workbench` 内へpackし、事前準備済みcacheを使ったoffline install、隔離home/profileでinstalled binを実行するものにします。グローバルinstall・npm publishはしません。

**完了条件：** acceptance.mdの最終ゲートがすべてpass、実行コマンド・exit code・環境・SHA・未検証事項がreportに残ることです。

**Checkpoint：** `test: verify packaged cli tty safety performance and docs`

---

受け入れケースは[検証表](acceptance.md)のA01〜A49です。順序の省略、未確認項目のpass記載、契約の無断変更はしません。P02の開始前に作業branch/HEAD/worktreeを確認し、実装担当モデルと推論レベルを確認します。
