# Oracle Top 実装計画書

状態: draft（同一会話でのStrict相談未完了）。実装担当モデル: GPT 6.1 Sol。推論レベル: High。
今回は計画まで。本体実装へ着手する担当は要件定義書→設計書→本書の順に読む。

## 実行規律

1ステップずつ、公開境界の1つの振る舞いに対してRed→Greenを繰り返す。まず全テストを書いてから実装する進め方は採らない。
Redは期待する振る舞いがないために失敗したことを確認する。依存不足、import失敗、テスト0件はRed証拠ではない。
Green後はそのステップに必要なチェックを実施し、plan/reportを更新し、明示パスをstageして全staged diffを読み、commit-codex -aでcheckpointする。
チェック失敗で次に進まない。要件にない新機能は追加しない。Product判断が現れたら仕様へ戻す。
pushはユーザーが許可した範囲で通常のnon-force pushのみ。既存変更を混ぜない。

## P01 開発基盤

依存: 正式R/D/Pがready。対象: package.json、lock、tsconfig、format設定、CI、実装レポート。
Node 24 ESM、TypeScript、テストランナー、JSON5、表示幅処理を設計に従って固定する。Oracleを依存にしない。
binの実装はまだ行わない。開発環境の健全性を確かめるためのテストだけを追加する。
完了: clean install、typecheck、test runnerの1テスト実行が成功。CIはmain/PRで同じcheckを行う。

## P02 設定とパス

依存: P01。公開境界: resolveMonitorConfig入力env/home/config→型付きResolvedConfig。
対象: src/config.ts、src/io/json-reader.ts、tests/config.test.ts。
順序: デフォルトhome/profile→home上書きでもprofileは独立→JSON5の許可項目→env値→不正値→symlink/readエラー。
fixture: home=/tmp/user、ORACLE_HOME_DIR=/tmp/store。期待sessions=/tmp/store/sessions、profile=/tmp/user/.oracle/browser-profile。
完了: 設計の優先順位がliteral期待値で検証され、configのsecretは戻り値に含まれない。

## P03 セッション投影

依存: P02。公開境界: normalizeSession(raw, directoryId)。
対象: src/model/session.ts、src/model/normalize.ts、tests/normalize.test.ts。
順序: browser/GPTの最小レコード→API/Gemini除外→mode欠損→unknownモデル→フィールドfallback→不正日時→follow-up配列。
fixtureは合成し、個人の実metadataをコピーしない。プロンプト、token、cookie、errorMessage、URL全文をSnapshotに残さない。
完了: unknown入力から安全な限定型へ変換できる。表示文字列と集計キーの正規化規則が一意。

## P04 読取コレクター

依存: P02/P03。公開境界: collectInputs(config, signal)。
対象: src/io/sessions.ts、src/io/leases.ts、tests/collectors.test.ts。
順序: 空sessions→2件→1件だけ破損→読込中消失→不正台帳→symlink→巨大meta→scan並行数。
Oracleの一覧APIをimportしない。読み取りに限定したIO能力を注入し、絶対にmkdir/write/rename/rmを利用しない。
完了: 一件の破損で全体を失わず、不明と0を区別できる。窓外の長期runningも採取する。

## P05 集計とSnapshot

依存: P03/P04。公開境界: buildDashboard(inputs, nowMs)。
対象: src/model/dashboard.ts、src/aggregate.ts、tests/dashboard.test.ts。
順序: 現在一覧とelapsed→信頼性→分母0→24H/7D境界→promptSubmitted→follow-up→固定sort→capacity。
固定now=2026-09-30T06:00:00.000Z。completed=24、partial=2、error=4、cancelled=1ならevaluated=30、successRate=0.8。
24時間下限=2026-09-29T06:00:00.000Z、7日下限=2026-09-23T06:00:00.000Z。境界の前後1msも検証する。
completed+true+follow-ups2なら3、error+true+follow-ups2なら1、completed+false+follow-ups2なら0。
完了: 一採取一nowで決定論的なSnapshot。24H≤7D、evaluatedと率の関係が保たれる。

## P06 テキスト描画

依存: P05。公開境界: renderText(snapshot, viewport?)。
対象: src/render/text.ts、src/render/width.ts、tests/render.test.ts。
順序: 全5領域→N/A→日本語幅→制御文字→project/slug省略→極小幅→高さ不足。
数値は型から描画し、テキストから集計を復元しない。JSONは別途Snapshotを直接serializeする。
完了: 列保護、省略件数、固定footerが確認できる。snapshotは全行を出す。

## P07 CLI単発出力

依存: P05/P06。公開境界: CLI process argv/env/stdout/stderr/exit。
対象: src/cli.ts、tests/cli.test.ts、package bin。
順序: help/version→snapshot text→snapshot json→不正flag→nonTTY default→data warnings→EPIPE。
隔離home/profileをfixtureへ指定してbuilt CLIをspawnする。stdout JSON一文書、stderrを混入させない。
完了: npm pack dry-runで実行可能binと必要distだけが入る。本物Oracleやネットワークを呼ばない。

## P08 TUIライフサイクル

依存: P07。公開境界: runTuiのterminal/timer/collect adapter。
対象: src/tui.ts、tests/tui.test.ts。
順序: 初回描画→tick→長いscanで非重複→resize→q→SIGINT→SIGTERM→例外→late結果破棄。
fake timerで採取呼び出し重複を検証する。raw mode/cursor/screen復元は端末adapterの公開呼び出しと実TTYの両方で確認。
完了: qで即時停止要求、次tickなし。終了後の読込が描画しない。復元の失敗も他の復元を妨げない。

## P09 結合・性能・導入

依存: P08。対象: tests/integration.test.ts、tests/performance.test.ts、README、docs/implementation-report.md。
孤立fixtureのbefore/after内容hash・mtime・一覧を比較し、読取専用能力と静的禁止APIチェックを補助に使う。
1,000セッション（各≤16KiB）・2秒・60秒の採取時間/CPU/RSSを記録。数値予算は設計の値を使う。
実TTYで120x32、80x24、極小幅、resize、qとCtrl-Cの復元を確認する。実プロファイルをTUI smokeに使わない。
導入はnpm ci→npm run check→npm pack→tarballから別prefixへinstall→oracle-top snapshot --json。npm publishは今回含めない。
完了: 全R-IDをacceptance表でpassにし、既知制約、性能測定環境、未確認点、SHAをreportへ記録。

## 最終ゲート

- 開発・結合・CLI/TUIチェックを全て実施し、必要なcommand/exit codeを保存。
- 全R-IDに証拠を対応づけ、Oracle保存状態と実画面・課金の区別がREADMEに説明されている。
- staged diffに実データ、秘密、scratch、node_modules、distを混ぜない。
- coherent checkpointが全てcommitされ、branch/HEAD/remaining worktreeを確認。
- 実装レビューや公開・リリースはユーザーの依頼範囲に従う。本計画の準備完了だけで製品実装完了としない。

## コマンドと実装ファイルの固定

P01で次のnpm scriptsを定義する。testはvitest run、typecheckはtsc --noEmit、buildはtsc -p tsconfig.build.json、format:checkはprettier --check、checkはformat:check→typecheck→test→buildの順とする。
今の計画リポジトリには本体package.jsonがなく、以下は実装着手時の作業である。

| ステップ | Greenで行う確認 | 次へ進む条件 |
| --- | --- | --- |
| P01 | npm ci、npm run typecheck、npm test | 環境確認テストが実際に1件以上実行 |
| P02 | npm test -- tests/config.test.ts、npm run typecheck | A04とhome/profileの独立、env検証 |
| P03 | npm test -- tests/normalize.test.ts、npm run typecheck | raw入力投影、provider/status/日時fallback |
| P04 | npm test -- tests/collectors.test.ts、npm run typecheck | A03,A05,A06,A30 |
| P05 | npm test -- tests/dashboard.test.ts、npm run typecheck | A08〜A17,A19,A31,A32 |
| P06 | npm test -- tests/render.test.ts、npm run typecheck | A18,A20〜A23 |
| P07 | npm run build、npm test -- tests/cli.test.ts、npm pack --dry-run | A02,A24,A29 |
| P08 | npm test -- tests/tui.test.ts、npm run typecheck | A01,A25,A27のadapter確認 |
| P09 | npm run check、npm test -- tests/integration.test.ts tests/performance.test.ts | A07,A26,A27の実TTY確認,A28 |

Redでは各ファイルの1振る舞いだけを`npm test -- tests/対象.test.ts -t "test title"`で実行し、同じ選択をGreenで再実行する。
実装ファイルは設計表に列挙したものを使う。P01でtests/setup.test.tsを作り、環境健全性確認後も本体の公開CLI契約を検証する必要がなければ重複テストとして除去する。
P09のpackage導入検証は.pack出力を.workbenchへ置き、`npm install --prefix .workbench/install-test ./tarball-path`と生成binのsnapshotを実行する。グローバルinstallやnpm publishを実施しない。
既存のNodeは24.14.0。2026-09-30のregistry確認値はJSON5 2.2.3、string-width 8.3.0、TypeScript 7.0.2、Vitest 5.0.2、Prettier 3.9.9。P01ではNode24互換の型定義を使い、exact versionとpackage-lock.jsonを保存する。着手時に依存互換性を確認し、勝手に新majorへ更新しない。
