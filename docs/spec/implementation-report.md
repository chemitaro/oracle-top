# 実装報告

状態: P02〜P09はcheckpoint済み。P10の実装・自動検証が成功し、primaryも全257テスト・最新installed CLI／PTY・性能とのコード一致・文書を照合しました。native画面／shell入力とコードレビューは未完了で、製品受け入れ全体は未完了です。

## 実装環境と基準

- 実装担当: GPT 6.1 Sol / High。
- 開始branch: `main`。
- 開始HEAD: `f5b745107f09421655e05c92c8aef7603e9ee68d`。
- 開始worktree: clean。作業中の`docs/work-plan.md`、`docs/spec/readiness.json`、`scripts/check-planning.py`はprimary所有の変更です。
- 環境: macOS、Node `v24.14.0`、npm `11.18.0`。
- scratch/cache: `use-workbench ensure`で解決・ignore確認したプロジェクト内`.workbench`。正式検証は合成fixtureを使います。P08の手順誤りによる実metadataの意図しない読取と対処はP08節へ記録します。

## P02 — Node／TypeScript基盤

設計5.5のSnapshot型、30種類のwarning codeとsource別unionを`src/model/dashboard.ts`へ反映しました。保存model／effortはstringのまま保持します。型ファイルにI/Oや副作用はありません。数値範囲・配列順・null間の不変条件の実行時検証は後続工程の対象です。

`package.json`は`private:true`、`type:module`、`engines.node:>=24 <25`を固定しました。runtime直接依存は`json5@2.2.3`と`string-width@8.3.0`の2つだけです。dev依存は採用版のTypeScript、Node型、Vitest、Prettier、Ajvだけとし、全直接依存をexact version、解決結果をlockfileへ固定しました。

TypeScriptはstrictなNodeNext ESM設定を使い、buildは`src`から`dist`へJavaScriptと型宣言を出力します。`test=vitest run`、`typecheck=tsc --noEmit`、`build=tsc -p tsconfig.build.json`、`check=format:check→typecheck→test→build`を定義しました。PrettierはTypeScript・JSON・YAMLを対象とし、正本文書と配布済みplanning artifacts、生成物、scratchを対象から除外します。CIはP02で確認したinstall・format・typecheck・buildを実行します。製品テストのCI追加は後続工程で行います。

### 実行証拠

以下は2026-09-30のローカル実行です。install・ci・typecheck・build・format・ESM importのログは`.workbench/p02/`に保持しました。

| コマンド | exit | 結果 |
|---|---:|---|
| `node --version` / `npm --version` | 0 | `v24.14.0` / `11.18.0` |
| `use-workbench ensure --target p02/npm-install.log --target p02/npm-ci.log --target p02/typecheck.log --target p02/build.log --target p02/esm-import.log --target p02/format.log --json` | 0 | 既存`.workbench`を再利用、ignore確認成功 |
| `use-workbench ensure --target npm-cache --json` | 0 | 作業用cacheのignore確認成功 |
| `npm install --save-exact json5@2.2.3 string-width@8.3.0 --cache .workbench/npm-cache` | 0 | runtime直接依存2つを取得、lockfile生成 |
| `npm install --save-dev --save-exact typescript@7.0.2 @types/node@24.19.0 vitest@5.0.2 prettier@3.9.9 ajv@8.20.0 --cache .workbench/npm-cache` | 0 | 採用版dev依存5つを取得 |
| `npm ci --cache .workbench/npm-cache` | 0 | lockfileから再インストール成功 |
| `npm run typecheck` | 0 | 型検査成功 |
| `npm run build` | 0 | ESM JavaScript・型宣言生成成功 |
| `node --input-type=module -e "import('./dist/model/dashboard.js')"` | 0 | ESM出力のimport成功 |
| `npm run format:check`（初回） | 1 | `src/model/dashboard.ts`の整形差分1件を検出 |
| `./node_modules/.bin/prettier --write src/model/dashboard.ts` | 0 | 型ファイルだけを整形 |
| `npm run format:check`（再実行） | 0 | 全対象の整形確認成功 |
| `npm ls --depth=0` | 0 | runtime2つ・dev5つ、全採用版を確認 |
| 下記runtime依存ESM smoke | 0 | JSON5と表示幅ライブラリがNode 24で動作 |

runtime依存ESM smokeは以下です。テストsuiteの代替ではなく、P02の実依存互換性確認です。

```bash
node --input-type=module -e "import JSON5 from 'json5'; import stringWidth from 'string-width'; if (JSON5.parse('{value: 1,}').value !== 1 || stringWidth('日本語') !== 6) throw new Error('runtime dependency smoke failed'); console.log('runtime dependencies imported under Node 24')"
```

`npm ci`はoptional依存`fsevents@2.3.3`のinstall scriptがallowScriptsで未承認というwarningを出しましたがexit 0です。ここでの型検査・build・runtime依存importは成功しています。製品はwatchを使用しません。

P02では採用済み計画に従い、基盤設定を写すテストを追加していません。`npm test`と`npm run check`は未実施で、テスト0件を成功扱いする設定もありません。A24のNode 24 ESMと依存境界のみ局所確認済みで、pack後のbin起動はP08／P10待ちです。A01〜A49の製品受け入れpassはまだ記録しません。

P02 checkpoint SHA: `efffbc124378e82dd4bac2fdb64617952df68e7f`（primaryによる完全差分確認・commit済み）。この実装担当はstage・commit・push・branch変更をしていません。

## P03 — 上限付き読み取り境界

開始時は`main`／`efffbc124378e82dd4bac2fdb64617952df68e7f`／cleanを確認しました。`readJsonFile({rootPath,pathSegments,format,context,signal?,io?})`は、objectのunknown値、閉じたDataWarning、または中止結果を返します。配列・null・primitiveのrootは`INVALID_ROOT`です。警告にはcode/source/sessionIdだけを返し、例外文・stack・対象パスを含めません。中止のためにwarning codeやsession statusを追加していません。

指定rootのrealpathは許容し、配下の各componentはlstatでsymlinkを拒否します。`O_RDONLY | O_NOFOLLOW | O_NONBLOCK`でopenし、fstatの通常file／1MiB上限、最大1MiB+1までのbounded read、fatal UTF-8 decode、JSON／JSON5解析を実装しました。fileのdev/ino/size/mtimeNs/ctimeNsと親directoryのdev/inoを再確認し、置換・変更・消失を隔離します。handleはfinallyで閉じ、abortは進行中OS readを即時中断できると主張せず、終了したreadの結果を採用しません。失敗したreadの後も別の正常readを実行できます。

`io`はrealpath/lstat/openとhandleのstat/read/closeだけの小さなread-only adapterです。テストでは通常のfilesystem fixtureを使い、決定的な更新競合・I/O失敗・abortだけをこのOS境界で注入しました。最初の製品testがGreenになった後、CIに`npm test`を追加しました。

### Focused Red→Green証拠

下表の選択commandはすべて`npm test -- tests/json-reader.test.ts -t '^<テスト名>$' --reporter=verbose`です。各回は対象1件の実行を確認しました。元stdout/stderrは`.workbench/p03/cycles.log`に順序どおり保持しています。最初のRedは実行可能stubの戻り値assertion不一致で、import／collection失敗ではありません。

| テスト名 | Red exit | Green exit |
|---|---:|---:|
| reads-json | 1 | 0 |
| reads-json5 | 1 | 0 |
| isolates-invalid-json | 1 | 0 |
| isolates-invalid-json5 | 1 | 0 |
| rejects-non-object-root | 1 | 0 |
| rejects-over-limit-file | 1 | 0 |
| rejects-invalid-encoding | 1 | 0 |
| rejects-non-regular-file | 1 | 0 |
| skips-file-symlink-without-opening-target | 1 | 0 |
| skips-descendant-directory-symlink | 1 | 0 |
| isolates-missing-file | 1 | 0 |
| isolates-file-replacement-during-read | 1 | 0 |
| isolates-parent-swapped-to-symlink | 1 | 0 |
| aborts-before-opening | 1 | 0 |
| aborts-during-read-and-closes-handle | 1 | 0 |
| rejects-path-escape | 1 | 0 |
| rejects-final-symlink-race-with-no-follow | 1 | 0 |
| aborts-during-close-before-return | 1 | 0 |

次の11件は先行する最小実装で初回からexit 0だった回帰確認です。Red証拠とは扱いません。同じ選択commandと元ログを保持しています。

```text
accepts-exact-limit-file
allows-configured-root-symlink
isolates-parent-directory-replacement
returns-safe-warning-for-io-failure
bounds-read-when-file-grows
handles-short-reads-until-eof
isolates-file-disappearance-during-read
isolates-in-place-file-change
closes-handle-on-read-failure
closes-handle-for-rejected-document
isolates-close-failure
```

### 工程の最終検証

| コマンド | exit | 結果・ログ |
|---|---:|---|
| `npm test -- tests/json-reader.test.ts --reporter=verbose` | 0 | 29件pass、`.workbench/p03/suite.log` |
| `npm run typecheck` | 0 | 型検査成功、`.workbench/p03/typecheck.log` |
| `npm run check` | 0 | format／typecheck／29件test／build成功、`.workbench/p03/check.log` |
| `git diff --check` | 0 | 空白エラーなし |

primaryの差分確認で、test setupが既存`.workbench/p03`へ依存していたことを指摘されたため、`beforeEach`でfixture親directoryをrecursive mkdirしてからmkdtempするよう修正しました。製品srcは変更していません。この環境準備の不足は製品Redとして数えません。

修正後は必要なsource/test/package/TypeScript/Prettier設定をGit管理外の隔離cwd `.workbench/p03/fresh-checkout`へ配置し、既存node_modulesだけをsymlink参照しました。cloneやネットワーク処理は行っていません。対象readerとtestのSHA-256が作業treeと同一で、隔離cwdの`.workbench`／`.workbench/p03`が実行前に存在しないことをassertしました。29件の対象suiteがexit 0、その後隔離cwd内にテストが作った空scratchだけを除去し、再び両directoryがない状態から`npm run check`もexit 0（29件pass、format/typecheck/build成功）でした。元のprivateログは保持しています。

この再検証のコマンドは`npm test -- tests/json-reader.test.ts --reporter=verbose`と`npm run check`です。元ログは`.workbench/p03/fresh-checkout.log`、事前不存在・入力hash・exitの証拠は`.workbench/p03/fresh-checkout-proof.txt`へ保持し、コピーした一時checkoutは検証後に除去しました。

P03 checkpoint SHA: `d3b45562a845d9a545cc51d6504534586318b35b`（primaryによる完全差分確認・commit済み）。集約／collector、配布CLI、実TTY、安全性の全製品証拠、性能値は後続工程です。readerは1readにつき最大1MiB+1のbufferを確保するため、P10で1,000件fixtureのCPU／RSS／p95を実測します。実測なしで性能passとは扱いません。

## P04 — 設定と独立したroot/profile解決

開始時は`main`／`d3b45562a845d9a545cc51d6504534586318b35b`／cleanを確認しました。後から追加された`docs/work-plan.md`はprimary所有の変更です。

`resolveMonitorConfig(startup, dependencies?)`は起動時に取得したenv／cwd／OS home／interval引数だけを入力にし、processの環境やcwd、OS homeを内部で再取得しません。呼出しごとに選択homeの`config.json`を既存readerでJSON5として読み直します。profileのrealpath照合は後続collectorの責務です。返却値は解決したhome/sessions/profileパス、interval、session候補がない場合のfallback max/source、閉じた警告だけです。JSON全文・秘密・env全文を返しません。

homeとprofileの既定値は独立です。envとuser configの相対パスをstartup cwd基準で絶対化し、`~`／`$VAR`を展開しません。NULを含むenvパスや不正なstartupパスはusage errorです。user configはown propertyの`browser.manualLoginProfileDir`と`browser.maxConcurrentTabs`だけを読み、不正フィールドは警告して他の正常な値を保持します。project configやprototype由来の値は使用しません。

max fallbackは`ORACLE_BROWSER_MAX_CONCURRENT_TABS`のASCII数字列による正のsafe integer→user configのnumber型正のsafe integer→3です。現在session候補を優先する処理はP06です。`parseInterval`はASCII数字列＋`ms`／`s`／`m`、換算後1,000〜60,000msを受理し、重複・単位なし・符号・小数・指数・Unicode数字・範囲外を拒否します。先頭0だけを理由には拒否しません。

### Focused Red→Green証拠

下表の選択commandは`npm test -- tests/config.test.ts -t '^<テスト名>$' --reporter=verbose`です。毎回対象1件の実行を確認しました。元stdout/stderrは`.workbench/p04/cycles.log`に順序どおり保持しました。最初のRedは実行可能stubの戻り値assertion不一致です。

| テスト名 | Red exit | Green exit |
|---|---:|---:|
| defaults-use-os-home | 1 | 0 |
| home-override-does-not-move-profile | 1 | 0 |
| profile-env-overrides-default | 1 | 0 |
| projects-only-whitelisted-json5-config | 1 | 0 |
| environment-max-overrides-user-config | 1 | 0 |
| invalid-config-fields-warn-and-use-fallback | 1 | 0 |
| invalid-environment-max-uses-user-config | 1 | 0 |
| rejects-nul-environment-path-as-usage-error | 1 | 0 |
| invalid-config-profile-falls-back | 1 | 0 |
| invalid-browser-object-warns | 1 | 0 |
| interval-defaults-to-two-seconds | 1 | 0 |
| interval-accepts-ascii-units-and-leading-zeroes | 1 | 0 |
| resolver-uses-selected-interval | 1 | 0 |
| rejects-invalid-startup-paths | 1 | 0 |

次の8件は先行実装で初回からexit 0だった回帰確認です。Red証拠とは扱いません。同じ選択commandと元ログを保持しています。

```text
interval-rejects-invalid-syntax-range-and-duplicates
rereads-user-config-on-each-call
uses-startup-snapshot-instead-of-live-environment
paths-use-startup-cwd-without-shell-expansion
profile-env-overrides-user-config
preserves-reader-warning-without-derived-field-warnings
does-not-read-project-config-or-prototype-values
propagates-abort-without-warning
```

### 工程の最終検証

| コマンド | exit | 結果・ログ |
|---|---:|---|
| `npm test -- tests/config.test.ts --reporter=verbose` | 0 | 22件pass、`.workbench/p04/suite.log` |
| `npm run typecheck` | 0 | 型検査成功、`.workbench/p04/typecheck.log` |
| `npm run check` | 0 | format／typecheck／51件test／build成功、`.workbench/p04/check.log` |
| 隔離cwdで同じ対象suite | 0 | 22件pass、`.workbench/p04/fresh-checkout.log` |
| `git diff --check` | 0 | 空白エラーなし |

新規checkoutのscratch不存在でもfixtureが成立するよう、setupが`.workbench/p04`を作成します。必要なsource/test/package/configと既存node_modulesのsymlinkだけを一時checkoutへ配置し、`.workbench`／`.workbench/p04`の事前不存在と対象入力hash一致をassertして22件を実行しました。clone／ネットワーク処理はありません。証拠は`.workbench/p04/fresh-checkout-proof.txt`へ保持し、コピーした一時checkoutは検証後に除去しました。

P04 checkpoint SHA: `3b1c947c5caa8232b6660724de756571d19a9bb8`（primaryによる完全差分確認・commit済み）。この実装担当はstage・commit・push・branch変更をしていません。

## P05 — sessionの限定投影と厳密な日時解析

開始時は`main`／`3b1c947c5caa8232b6660724de756571d19a9bb8`／cleanを確認しました。作業中のREADME・overview・正式仕様への保存位置転記はprimary所有の変更として保持しました。

`normalizeSession(raw, directoryId)`はown propertyだけを読み、限定したNormalizedSessionまたは除外結果と閉じたDataWarningを返します。raw全文、prompt、URL、PID、cookie、秘密値を保持しません。browser modeを確認したうえでGPT prefix／許可位置の正規ChatGPT hostnameを採用根拠とし、API、Gemini、根拠不明、矛盾するmode/providerを隔離します。保存model／effortの大文字小文字や未知statusを変換しません。未知statusでも初回boolean trueの1件を後続集計へ渡せます。任意フィールドの不正で正常な他フィールドを捨てません。

profile／maximumは指定された保存2箇所から必要値だけを投影します。相対パスを保存cwd基準で論理解決し、有効な絶対cwdがなければ絶対profile文字列も所属根拠として採用しません。未知のmetadataパスを探索するI/Oはありません。follow-upは`options.browserFollowUps`の配列全体を検証し、completedかつ初回trueの場合だけ長さを追加します。重複を保持し、prompt文字列は返しません。警告を重複除去してコード単位順にし、表示制御文字の存在だけを警告します。実際の表示サニタイズはP07です。

`parseIsoTimestamp(unknown)`はtimezoneを必須とし、年0001〜9999、実在する暦日、通常時分秒、fraction 1〜3桁、offset時00〜23／分00〜59を検証して整数epoch millisecondsまたはnullを返します。0001／0099年を1900年代へ補正しません。開始とreliabilityのfallbackは独立し、有効な未来日時もその数値を保持します。clock取得・未来判定・集計窓・件数集約はP06です。

### Focused Red→Green証拠

選択commandは`npm test -- tests/<suite>.test.ts -t '^<テスト名>$' --reporter=verbose`です。下表32件は各回対象1件、assertion失敗のRed exit 1からGreen exit 0を確認しました。最初のRedは実行可能stubの戻り値assertion不一致で、import失敗ではありません。元stdout/stderrと選択commandは`.workbench/p05/cycles.log`に順序どおり保持しています。

| suite | テスト名 | Red exit | Green exit |
|---|---|---:|---:|
| normalize | normalizes-browser-gpt-session | 1 | 0 |
| normalize | excludes-api-despite-browser-remnants | 1 | 0 |
| normalize | excludes-gemini-models | 1 | 0 |
| normalize | rejects-unknown-model-without-provider-evidence | 1 | 0 |
| normalize | includes-unknown-model-with-chatgpt-url | 1 | 0 |
| normalize | excludes-conflicting-provider-evidence | 1 | 0 |
| normalize | does-not-infer-browser-mode | 1 | 0 |
| normalize | excludes-conflicting-known-modes | 1 | 0 |
| normalize | preserves-unrecognized-status | 1 | 0 |
| normalize | resolves-independent-time-fallbacks | 1 | 0 |
| normalize | counts-first-submission-only-for-boolean-true | 1 | 0 |
| normalize | excludes-gemini-prefix-even-with-slash | 1 | 0 |
| normalize | reads-followups-from-options | 1 | 0 |
| normalize | warns-unrecorded-terminal-submission | 1 | 0 |
| normalize | isolates-invalid-root-without-derived-warnings | 1 | 0 |
| normalize | uses-directory-id-on-metadata-mismatch | 1 | 0 |
| normalize | requested-effort-precedes-browser-config | 1 | 0 |
| normalize | project-requires-valid-absolute-cwd | 1 | 0 |
| normalize | invalid-mode-type-falls-back-with-warning | 1 | 0 |
| normalize | invalid-display-fields-use-independent-fallbacks | 1 | 0 |
| normalize | checks-nested-objects-without-discarding-session | 1 | 0 |
| normalize | projects-logical-profile-and-capacity | 1 | 0 |
| normalize | warns-conflicting-valid-saved-capacity-fields | 1 | 0 |
| normalize | cwd-unavailable-leaves-absolute-profile-unresolved | 1 | 0 |
| normalize | detects-display-controls-without-changing-saved-values | 1 | 0 |
| normalize | deduplicates-and-orders-warning-codes | 1 | 0 |
| normalize | invalid-submission-type-does-not-coerce | 1 | 0 |
| normalize | invalid-cwd-warns-and-keeps-profile-unresolved | 1 | 0 |
| normalize | invalid-url-field-does-not-discard-gpt-session | 1 | 0 |
| normalize | rejects-sparse-followup-array | 1 | 0 |
| time | parses-timezone-qualified-iso | 1 | 0 |
| time | rejects-invalid-iso-and-calendar-dates | 1 | 0 |

最初のfollow-up2件では保存位置を誤ってroot直下に置いたため、その旧Red／Greenは正式証拠から除外します。Oracle根拠資料・会話基準の保存位置を確認して`options.browserFollowUps`へ訂正し、異なるroot配列を無視する`reads-followups-from-options`を新しいRed→Greenとして上表へ記録しました。旧ログは削除せず保持しています。訂正後の2件は`-t '^(counts-completed-followups-without-retaining-prompts|rejects-entire-incomplete-followup-array)$'`で対象2件・exit 0を確認し、下の回帰確認へ分類しました。

次の14件は現行の正規fixtureで初回exit 0だった回帰確認です。Red証拠とは扱いません。同じ選択commandと元ログを保持しています（上記2件のみまとめて選択）。

```text
time: preserves-early-years-fractions-and-leap-rules
normalize: preserves-valid-future-time-without-fallback
normalize: counts-completed-followups-without-retaining-prompts
normalize: rejects-entire-incomplete-followup-array
normalize: accepts-only-allowed-url-fields-and-exact-hosts
normalize: gemini-options-and-url-always-exclude
normalize: unknown-mode-does-not-fall-back-but-missing-mode-does
normalize: preserves-model-effort-case-and-unknown-values
normalize: followups-require-completed-and-first-true
normalize: invalid-profile-and-max-fall-back-independently
normalize: returns-only-limited-projection
normalize: ignores-inherited-fields-and-unknown-keys
normalize: missing-and-invalid-time-fields-remain-explicit
normalize: capacity-accepts-only-positive-safe-numbers
```

### 工程の最終検証

| コマンド | exit | 結果・ログ |
|---|---:|---|
| `npm test -- tests/normalize.test.ts tests/time.test.ts --reporter=verbose` | 0 | 46件pass（normalize 43／time 3）、`.workbench/p05/suite.log` |
| `npm run typecheck` | 0 | 型検査成功、`.workbench/p05/typecheck.log` |
| `npm run check` | 0 | format／typecheck／全97件test／build成功、`.workbench/p05/check.log` |
| `git diff --check` | 0 | 空白エラーなし |

fixtureはメモリ内の合成objectだけで、scratch directoryの事前存在に依存しません。実Oracleデータ・秘密値は使っていません。P05 checkpoint SHAは`1ffb02231edeae1c887222de5fdf1ea588b13346`です（primaryによる完全差分確認・commit済み）。この実装担当はstage・commit・push・branch変更をしていません。

primaryはREADME・説明HTMLを実装中の状態へ同期し、設計書と受け入れ表へ既存根拠どおりの保存位置 `options.browserFollowUps` を明記しました。`python3 scripts/check-planning.py` はexit 0です。使用スキル付属の `/Users/iwasawayuuta/.agents/skills/japanese-explanatory-html/scripts/validate-plantuml-html.mjs docs/overview.html` も最終編集後にexit 0で、SVG描画1/1、クリック・キーボード拡大、倍率境界、focus trap、終了とfocus復元を確認しました。このブラウザ検証は説明資料のもので、未実装の製品TUIの証拠とは扱いません。planning ZIPは準備完了時点の資料として残し、最終納品時に同期します。

## P06 — 採取・窓集計・capacity・Snapshot

開始時は`main`／`1ffb02231edeae1c887222de5fdf1ea588b13346`／cleanを確認しました。作業中の正式仕様冒頭状態の同期はprimary所有の変更として保持しました。固定nowは`2026-09-30T06:00:00.000Z`／`1790748000000`です。

`collectInputs(startup, {io?, signal?, now?})`は設定読込より前にclockを1回だけ取得し、設定→session→選択leaseの順で採取します。成功結果は`{kind:"inputs", nowMs, inputs}`、usage errorとabortは独立unionです。env／cwd／OS homeはcallerのstartup snapshotを使い、設定は各呼出しで読み直します。aggregateへ渡す値は解決済み設定、NormalizedSession配列またはnull、選択profile realpath、active、閉じたwarningだけです。

`collectSessions({homePath, io?, signal?})`はresolved home配下のsessionsをlstatしてから列挙し、直下の通常directoryだけを読むため、8日前runningも採用します。通常fileを無視し、session／metadataのsymlinkを開きません。home自体の指定symlinkは許容しますが、sessionsをreaderの許容rootにせず、resolved home＋`sessions/id/meta.json`で読みます。列挙root／homeと各session directoryのidentityを再確認し、rootの変更は全体null、個別file／directoryの失敗は他recordから隔離します。root欠損／読取不能／拒否symlinkはセッション3領域null、正常emptyは配列と0です。

`collectLeases({profilePath, io?, signal?})`は選択profileだけを解決し、`oracle-tab-leases.json`を既存readerで読みます。v1・own version／leases・全要素非null非array objectを要求し、stale／重複／PIDを検査せず長さを数えます。初回profile／lease欠損は0＋FILE_MISSING、破損や権限不足はnullです。解決後のprofile消失・置換はroot identity確認でnull＋FILE_CHANGED、初回通常fileのprofileはnull＋FILE_NOT_REGULARとします。resolved home／profileをその後のreaderへ渡し、許容root aliasのretargetで列挙元とread元、selected realpathと台帳の所属が食い違わないよう保持します。metadata由来の他profileパスを探索しません。

read-only adapterは既存realpath／lstat／openへreaddirだけを追加しました。現在は順次readで、12session＋config＋leaseの合成adapter実測はpeak 1、open／close 14／14、未close 0です。上限8を満たし、最低並行数は仕様で要求していません。並列化の必要性とCPU／RSS／p95はP10実測待ちです。abort後の新read／probeを止め、進行中readのlate結果を破棄し、handle closeを確認しました。同tick retryやlast-good fallbackはありません。

`buildDashboard(inputs, nowMs)`はI/O／clock取得なしの純粋集約です。currentはpending／runningのみ、elapsed昇順・null末尾・id UTF-16順です。用途ごとに開始／reliability時刻の未来・不明を警告し、有効未来からcreatedへfallbackしません。24H／7Dは両端inclusiveです。reliabilityはcompleted＋partial＋errorを分母にし、cancelledを除外します。初回・follow-upの投影数を保存directory単位、保存model／effort単位で合算し、7D=0の行を出しません。固定model／effort順とwarning tupleのUTF-16順・重複除去を適用します。

max候補は選択logical profileまたは既に解決したselected realpathと一致するcurrentだけです。他profile currentは一覧に残し、PROFILE_DIFFERENTを出します。同profileの有効非未来開始の最新→不明／未来末尾→id順で選択し、採用値と異なる候補にCAPACITY_CONFLICTを出します。候補なしはP04のenv／config／default fallbackです。cwd不明profileのmax9を所属推定せず、env4を採用できます。active4／max3のutilizationは`1.3333333333333333`のままで上限1を設けません。

### Focused Red→Green証拠

選択commandは`npm test -- tests/<suite>.test.ts -t '^<テスト名>$' --reporter=verbose`です。下表29件は各回対象1件、期待値のAssertionErrorによるRed exit 1→Green exit 0を確認しました。最初のRedは実行可能stubの戻り値assertion不一致です。import／compile失敗や0件suiteをRedとして数えていません。元stdout／stderrとcommandは`.workbench/p06/cycles.log`、各exitは`.workbench/p06/exits.txt`へ順序どおり保持しました。

| suite | テスト名 | Red exit | Green exit |
|---|---|---:|---:|
| collectors | scans-all-directories-including-old-current | 1 | 0 |
| collectors | isolates-corrupt-metadata-without-derived-warnings | 1 | 0 |
| collectors | unreadable-sessions-root-is-unavailable | 1 | 0 |
| collectors | rejects-sessions-symlink-before-enumeration | 1 | 0 |
| dashboard | orders-current-by-elapsed-null-last-and-utf16-id | 1 | 0 |
| dashboard | counts-reliability-with-cancelled-outside-denominator | 1 | 0 |
| dashboard | counts-inclusive-submission-windows-and-excludes-future | 1 | 0 |
| dashboard | orders-model-effort-with-fixed-priorities-and-utf16 | 1 | 0 |
| dashboard | selects-maximum-only-from-same-profile-current | 1 | 0 |
| dashboard | future-and-unavailable-time-stay-null-with-safe-warnings | 1 | 0 |
| dashboard | latest-valid-same-profile-max-wins-with-conflict | 1 | 0 |
| dashboard | deduplicates-and-sorts-warning-tuples-by-utf16 | 1 | 0 |
| collectors | counts-all-v1-leases-without-pid-or-stale-filtering | 1 | 0 |
| collectors | rejects-invalid-v1-lease-structure | 1 | 0 |
| collectors | missing-profile-or-registry-means-zero-stored-leases | 1 | 0 |
| collectors | ignores-files-and-skips-session-directory-symlinks | 1 | 0 |
| collectors | isolates-directory-disappearance-and-keeps-other-session | 1 | 0 |
| collectors | isolates-session-directory-replacement-before-file-read | 1 | 0 |
| collectors | session-abort-discards-results-and-stops-new-reads | 1 | 0 |
| collectors | aborted-lease-collection-does-not-probe-profile | 1 | 0 |
| collectors | abort-during-identity-check-stops-following-probes | 1 | 0 |
| collectors | lease-read-stays-on-resolved-profile-after-root-alias-retarget | 1 | 0 |
| collectors | session-reads-stay-on-enumerated-root-after-alias-retarget | 1 | 0 |
| collectors | observed-profile-disappearance-is-changed-not-initial-missing | 1 | 0 |
| collectors | profile-replacement-during-read-is-unknown-capacity | 1 | 0 |
| collectors | profile-permission-failure-stays-unreadable-not-missing | 1 | 0 |
| collectors | non-directory-profile-is-not-regular-without-reading-registry | 1 | 0 |
| collectors | observed-home-disappearance-is-changed-not-initial-missing | 1 | 0 |
| collectors | abort-in-last-session-identity-check-stops-success-and-failure-probes | 1 | 0 |

primaryが元cycles.logを独立照合した結果、次の2件のRedは期待値のassertion不一致ではなく、公開関数から未処理ENOENTが返った実行時I/O例外でした。対象1件failed→passedと現在のGreenは確認していますが、計画の「期待値のassertionでRed」を満たさない手順逸脱のため、上表29件のassertion Red→Green証拠には含めません。

| suite | テスト名 | 公開I/O例外 Red exit | Green exit |
|---|---|---:|---:|
| collectors | missing-sessions-root-is-unavailable | 1 | 0 |
| collectors | isolates-enumeration-directory-replacement | 1 | 0 |

過去の元ログを保持し、証拠を作り直すための実装の逆戻しや人工的なfailure再生成は行いません。今後、I/O例外を安全な公開結果へ変換する振る舞いはPromiseの`resolves`等で期待値assertionを経由するRedとして選択します。最初の実行可能stubのRedがassertion不一致だった事実は維持します。

次の16件は先行最小実装で初回exit 0だった回帰確認です。Red証拠とは扱いません。同じ選択commandと元ログを保持しました。

```text
dashboard: counts-submitted-completed-followups
collectors: abort-discards-late-read-and-starts-no-further-files
dashboard: normal-empty-and-unavailable-have-distinct-session-regions
dashboard: reliability-uses-independent-inclusive-completion-window
dashboard: unknown-profile-max-falls-back-without-clamping-utilization
dashboard: maximum-ties-use-id-and-unknown-times-follow-valid-starts
collectors: counts-directories-not-conversations-and-keeps-unknown-status-usage
collectors: captures-clock-before-config-and-rereads-config-each-poll
collectors: reads-only-selected-profile-and-accepts-its-resolved-alias
collectors: configured-home-symlink-is-allowed-but-meta-file-symlink-is-skipped
collectors: all-document-reads-stay-within-eight-and-close
collectors: lease-reader-failure-is-isolated-without-structure-warnings
dashboard: valid-future-start-never-falls-back-to-past-created
dashboard: invalid-followups-preserve-initial-only-and-do-not-count-subsets
collectors: changed-file-is-not-retried-and-next-poll-adopts-normal-file
collectors: abort-during-last-directory-stat-failure-starts-no-final-probes
```

最後のsession directory post-identity awaitでabortした場合の成功／例外両経路を公開adapterで追加検証し、それ以降のprobe／openが0となるRed→Greenを確認しました。同じ停止判定を最初のdirectory stat失敗にも適用し、その経路は初回pass回帰として記録しました。45件時点の旧suite／check成功ログも保持し、修正後の47件／全144件を最終結果とします。

### 工程の最終検証

| コマンド | exit | 結果・ログ |
|---|---:|---|
| `npm test -- tests/dashboard.test.ts -t '^counts-submitted-completed-followups$' --reporter=verbose` | 0 | 指定case 1件pass（初回pass回帰）、cycles.log |
| `npm test -- tests/collectors.test.ts tests/dashboard.test.ts --reporter=verbose` | 0 | P06 47件pass、`.workbench/p06/suite.log` |
| `npm run typecheck`（初回） | 1 | exactOptionalPropertyTypesでsignal undefined 2件を検出、typecheck.log |
| `npm run typecheck`（修正後） | 0 | signal存在時だけreader requestへ渡して型検査成功、typecheck.log |
| `npm run check` | 0 | format／typecheck／全144件test／build成功、`.workbench/p06/check.log` |
| 隔離cwdで同じP06対象suite | 0 | 47件pass、`.workbench/p06/fresh-checkout.log` |
| `git diff --check` | 0 | 空白エラーなし |

Workbench ensureはignore済みrootと指定payloadを確認しましたが、最初のログredirect時にはp06親directoryが未作成でした。親を作成してから対象テストを実行し、その環境準備失敗を製品Redに数えていません。fixture setupもrecursive mkdir→mkdtempとし、新規checkoutのscratch不存在で成立します。各fixtureは検証後に削除し、元ログを保持しています。全fixtureは合成で、実Oracleデータ・秘密値を使っていません。

必要なsource／test／package／TypeScript設定と既存node_modulesのsymlinkだけを一時cwdへ配置し、`.workbench`／`.workbench/p06`の事前不存在と対象入力SHA-256一致をassertしてP06 47件を実行しました。clone／ネットワーク処理はありません。証拠は`.workbench/p06/fresh-checkout-proof.txt`、元ログはfresh-checkout.logへ保持し、一時配置は検証後に削除しました。

P06 checkpoint SHAは`7beba24daa2ea94b819ab32d84385cceb35ef507`です（primaryによる完全差分・元ログ確認・commit済み）。この実装担当はstage・commit・push・branch変更、外部分析、追加agentを実行していません。P07〜P10と製品受け入れ全体は未完了です。

## P07 — 共通テキスト・安全なJSON・Schema検証

開始時は`main`／`7beba24daa2ea94b819ab32d84385cceb35ef507`／cleanを確認しました。変更は`src/render/{text,width,json}.ts`、`tests/{render,schema}.test.ts`と本reportです。極小viewportの正式仕様補足はprimary所有の変更として保持しました。Workbench ensure後にp07親directoryを作成・実在確認してからログを書きました。

`renderText(snapshot, {columns, rows}?)`は同じSnapshotから全件textまたはviewport textを生成します。currentはSTATUS／ELAPSED／PROJECT／SESSION / SLUG／MODEL／EFFORTの6列です。elapsedの時間は24時間で巻き戻さず、nullをN/A、正常emptyをplaceholderで区別します。比率は1桁の百分率とし、active4／max3は133.3%です。数値や保存model／effortを独自の状態・quotaへ変換しません。5領域とOracle-only／direct ChatGPT除外／requested値／selected profile・homeの注記を表示し、警告時にValues from readable records onlyを付けます。表示clockはgeneratedAtのOS local時刻＋offset、JSONはUTCの保存値です。Snapshotにないrefresh contextは追加していません。

幅はIntl.Segmenterと採用版string-widthでgraphemeのセル数を計測します。全Snapshotの保護列（currentのSTATUS／ELAPSED／MODEL／EFFORT、usageの全4列）から、project／slug最小1セルと区切りを含む必要幅を決定します。物理下限80列・最後1列予約を守り、project／slugとその見出しを先に短縮します。保護名や数値を黙って切りません。必要幅未満は通常表を出さずnarrow message、メッセージが入らない場合は!です。予約後の描画可能列・行が0の0／1columns・rowsでは本文空です（primaryが既存予約ルールから導いた境界を正式仕様へ補足）。

固定領域を実際に組み立て、巨大なsafe integerも数値を保持して行を折り分けてからFを数えます。最後1行を予約し、残bodyをcurrent／usage半分、奇数はcurrent、余りは他方へ再配分します。空表にも1行を使い、N>BではB−1件＋残件数行です。固定＋両表1行が入らなければshort messageです。指定fixtureの120×24、固定F15・body各4行ではcurrent3件＋7 more、usage3件＋6 more、全23描画行です。viewport warning要約は最大2行、full textは全行・全警告を返します。Snapshotを変更しません。

テキストはC0／C1／DEL／CRLF／TAB／Unicode改行／指定BidiControlを空白へ置換します。`serializeJson(snapshot)`はJSON.stringify後にC1／DEL／BidiControl／U2028・U2029をUnicode escapeし、生制御文字を出さずJSON.parse後の全値とwarning集合を保持します。TUIの省略はJSONへ反映しません。

既存正式Schema・正式例は意味変更や同期修正を必要とせず、Ajv2020 strict実validatorで確認しました。date-time formatは既存parseIsoTimestamp、UTC patternは正式Schemaを使い、ajv-formatsやruntime依存を追加していません。extra property、required欠損、未知warning／不正source・sessionId union、負elapsed・float件数・unsafe integer・max0・7D0行、UTC／暦不正、3領域の混在null、不正な率nullをrejectします。model／effortの自由な非空保存文字列、0001年、有効な3領域allnullをacceptします。Schemaだけで算術・一意性・順序を保証するとは扱わず、実際のbuildDashboard公開結果のliteralを検証してからserialize→実validatorへ通しました。

### Focused Red→Green証拠

選択commandは`npm test -- tests/<suite>.test.ts -t '^<テスト名>$' --reporter=verbose`です。下表10件は対象各1件、元ログのAssertionErrorを確認したRed exit 1→Green exit 0です。最初は実行可能stubの戻り値assertion不一致です。例外、import／compile失敗や0件suiteをRedに数えていません。元stdout／stderr・commandは`.workbench/p07/cycles.log`、各exitは`.workbench/p07/exits.txt`に保持しました。

| suite | テスト名 | assertion Red exit | Green exit |
|---|---|---:|---:|
| render | renders-exactly-six-current-columns | 1 | 0 |
| render | distinguishes-unavailable-from-zero-and-empty | 1 | 0 |
| render | measures-and-truncates-whole-graphemes-in-cells | 1 | 0 |
| render | shrinks-project-and-slug-before-protected-columns | 1 | 0 |
| render | renders-five-regions-and-provenance-notes | 1 | 0 |
| render | reports-omitted-rows-per-section | 1 | 0 |
| render | neutralizes-text-controls-without-changing-snapshot | 1 | 0 |
| render | serializes-safe-json-with-full-value-round-trip | 1 | 0 |
| render | wraps-fixed-lines-without-hiding-safe-integer-values | 1 | 0 |
| render | shows-generated-clock-in-os-local-time-with-offset | 1 | 0 |

次の13件は初回exit 0だった回帰確認です。既存正式Schemaが最初から満たしていたnegative caseもこの区分にし、人工的なRedを生成していません。選択commandと元ログを保持しました。

```text
schema: validates-canonical-snapshot-example
schema: rejects-extra-properties-at-every-output-object
schema: rejects-invalid-numeric-boundaries-and-null-ratios
schema: requires-three-session-regions-to-be-all-null-or-all-normal
schema: rejects-unknown-warning-code-source-and-invalid-session-id-union
schema: requires-strict-utc-generated-time-and-nonempty-free-saved-names
schema: validates-built-dashboard-with-literal-algebra-unique-rows-and-order
render: computes-required-width-from-protected-values-before-omission
render: uses-size-messages-and-reserves-last-row-and-column
render: gives-odd-body-row-to-current-and-redistributes-unused-space
render: limits-tui-warning-summary-to-two-lines-and-full-text-keeps-all
render: keeps-hours-above-day-and-formats-unclamped-percent-to-one-decimal
schema: requires-output-fields-in-root-and-nested-records
```

### 工程の最終検証

| コマンド | exit | 結果・ログ |
|---|---:|---|
| `npm test -- tests/render.test.ts -t '^reports-omitted-rows-per-section$' --reporter=verbose`（最終選択） | 0 | 指定case 1件pass、cycles.log |
| `npm test -- tests/render.test.ts tests/schema.test.ts --reporter=verbose` | 0 | P07 23件pass（render15／schema8）、`.workbench/p07/suite.log` |
| `npm run typecheck` | 0 | 型検査成功、`.workbench/p07/typecheck.log` |
| `npm run check` | 0 | format／typecheck／全167件test／build成功、`.workbench/p07/check.log` |
| `git diff --check` | 0 | 空白エラーなし |

P07の最終検証に新たな警告・失敗はありません。fixtureはメモリ内の合成Snapshotと正式な合成例だけで、実Oracleデータ・秘密値を使っていません。元ログを保持し、除去すべき一時fixture配置はありません。P07 checkpoint SHAは`2d13625abdbff19e9548a1af14c18e8a6e2f0485`です（primaryによる完全差分・元ログ確認・commit済み）。この実装担当はGit書込み、外部分析、追加agentを実行していません。

配布CLI・default TTYの実動作・PTY／実TTY終了とresize・採取から描画まで含めたCPU／RSS／p95は未検証です。P10実測で改善の必要性を判断し、予備計測を正式性能passとして扱いません。P08〜P10と製品受け入れ全体は未完了です。

## P08 — CLI・単発プロセス契約

開始時は`main`／`2d13625abdbff19e9548a1af14c18e8a6e2f0485`／cleanを確認しました。担当変更は`src/cli.ts`、`tests/cli.test.ts`、packageのbin／filesとlock rootのbin同期、本reportです。primary所有のREADME／HTML／work-plan等を保持します。

built CLIと最小注入境界`main(argv, deps)`で、単独help／version、snapshot text、snapshot --json、TUI argv／preflightを実装しました。起動時のenv／cwd／osHomeをコピーし、snapshotはcollectInputs→buildDashboard→共通rendererを一度だけ通します。JSONは一文書＋改行、textはANSIなしの全行・全警告です。警告付き有効Snapshotもexit0、未知arg／重複／不正組合せ／interval／NUL startupと非TTYはstdout空・exit2です。stdin／stdout両TTYとTERM≠dumbを要求します。診断・usageは採取しません。

stdoutのEPIPEはsnapshot／help／versionすべてexit0、他の出力障害・内部例外はexit1です。stderr障害も未処理eventやhangにせずexit1へ閉じます。write callbackとerror eventを扱い、falseならdrainも待ち、完了／失敗時に自分のlistenerを解除します。遅いcallbackのflush、pending output中のerror、後から返るcallbackで追加writeしない境界も確認しました。通常entryは`process.exitCode`だけを設定し、強制process.exitやstdout destroyをしません。内部メッセージにパス・prompt・stackを返しません。

Node24の`import.meta.main`で直接実行し、shebang付き`dist/cli.js`をbin oracle-topへ指定しました。Nodeによるbin symlink経由のentry実行を確認しました。`files=[dist, README.md]`、private:true、runtime直接依存2つを保持します。pack dry-run候補はdistのJS／型宣言とREADME、package.jsonだけの28ファイル、61,204 bytesでした。spec／tests／Workbench／private fixture／liveデータは含みません。tarball導入後のnpm bin実行はP10の別検証です。

有効TTYは注入runnerへ固定startupとparse済みintervalを渡します。既定2000ms・指定3000msのうち、指定値と返却exit143を接続回帰で確認しました。製品runnerは未接続で、実TTY時は仮の正常終了をせずexit1です。default TUI・poll／resize／終了復元はP09未実装です。

### 試験隔離の手順逸脱と是正

最初のEPIPE試験は、実行可能main stubがdepsを受け取るだけで未接続だったため、既定homeの実metadataを意図せずread-onlyで読取り、private cycles.logへSnapshotを出力しました。対象へのwriteはありません。この実行は正式TDD証拠から除外しました。primaryの承認により、実データを含む生Snapshotの1行だけをredaction markerへ置換し、command／exit1／対象1件failedのメタデータを保持しました。元データは他のログ・reportへ再保存していません。

根本防止として、mainをVitest process内で呼ぶ試験をなくし、built moduleを専用scenario childで実行します。childのHOME、ORACLE_HOME_DIR、ORACLE_BROWSER_PROFILE_DIRを合成fixtureへ固定し、親process envを変更しません。startup注入を省略してもosHomeと選択2pathがfixture内、current=[]となる安全caseを先行検証しました。その後のEPIPE成功は初回pass回帰として扱い、人工的なRedを生成していません。fixturesはbeforeEachのrecursive mkdir→mkdtempで成立し、afterEachで当該fixtureだけを削除します。

JSON caseの初回stub RedはJSON一文書のassertion不一致です。実装後の一度目Greenではテストが正本browserCapacityをcapacityと誤記して失敗し、正本型へ訂正後にGreenとなりました。この期待値誤記を製品バグ修正として数えません。

内部例外とdiagnostic出力障害の最初の試験はchildのruntime終了で失敗したため正式Redから除外しました。child内で例外／eventを捕捉して公開結果に変換し、正しい期待値とのAssertionErrorを確認してからGreenへ進めました。最終非同期検証はresolvesで期待結果を判定します。

runner接続の初回試験と一度目Greenは親TERM=dumbを継承してpreflight拒否となりました。この2回は正しいrunner前提でなく正式Redから除外し、child TERM=xterm固定後の成功を回帰として扱います。履歴は保存し、Red再生成はしません。

### Focused Red→Greenと回帰

各対象選択は`npm test -- tests/cli.test.ts -t '^<name>$' --reporter=verbose`です。下記11件は実行可能stub／現在の公開結果に対する対象1件のAssertionError、exit1→同名Green exit0です。import／compile／spawn失敗、0件suite、上記手順逸脱は数えません。各buildと選択command／stdout・stderrは`.workbench/p08/build.log`と`cycles.log`、exitは`exits.txt`へ保存しました。

| 真のassertion Red→Green | Red / Green exit |
|---|---|
| shows-help-without-collection | 1 / 0 |
| shows-version-without-collection | 1 / 0 |
| emits-complete-text-snapshot | 1 / 0 |
| emits-one-json-document | 1 / 0 |
| rejects-unapproved-argument-combinations | 1 / 0 |
| rejects-non-tty-before-any-stdout | 1 / 0 |
| reports-other-output-failure-without-private-details（safe child） | 1 / 0 |
| isolates-internal-exceptions-with-safe-exit-one（captured boundary） | 1 / 0 |
| rejects-invalid-startup-values-with-usage-exit | 1 / 0 |
| handles-diagnostic-output-errors-and-flush（captured event） | 1 / 0 |
| defines-distribution-bin-and-runs-symlink-entry | 1 / 0 |

残る14件は初回pass回帰です。安全な前提での初回を数え、除外した試験や誤ったTERM前提をRedと扱いません。

```text
succeeds-with-isolated-data-warnings
isolates-default-home-even-without-startup-injection
treats-stdout-epipe-as-success
waits-for-backpressure-and-flush-with-one-write
contains-stderr-write-failure-with-exit-one
connects-valid-tty-to-injected-runner-with-parsed-interval
requires-both-tty-streams-and-nondumb-term
diagnostics-and-usage-do-not-collect
snapshots-startup-and-collects-clock-once
help-and-version-epipe-are-success
valid-tty-is-unfinished-without-runner-not-false-success
built-snapshot-keeps-all-rows-and-all-warnings
contains-error-event-during-pending-output-with-no-late-write
built-cli-exits-zero-when-output-pipe-closes
```

全件fixtureはcurrent12件＋不正3件をtext／JSONで省略せず検証しました。EPIPE built processは各150,000字の合成slug8件でpipeを閉じ、code0／signalなし／stderr空を確認しました。

### 最終検証

| command | exit | 証拠 |
|---|---:|---|
| `npm run build` | 0 | build.log、Node24 ESM |
| `npm test -- tests/cli.test.ts -t '^emits-one-json-document$' --reporter=verbose` | 0 | 対象1件pass、cycles.log |
| `npm test -- tests/cli.test.ts --reporter=verbose` | 0 | 25件pass、suite.log |
| `npm run typecheck` | 0 | typecheck.log |
| `npm run check` | 0 | format／typecheck／全192件・9suite／build、check.log |
| `npm pack --dry-run --json`（初回） | 255 | 既定npm cacheへのsandbox EPERM、pack.json／pack.log |
| `npm pack --dry-run --json --cache .workbench/p08/npm-cache` | 0 | 既定cacheを変更せず開発cacheへ限定、pack-safe.json／pack-safe.log |
| 配布file listの許可集合assertion | 0 | dist・README.md・package.jsonのみ28件、private fixtureなし |
| `git diff --check` | 0 | 空白エラーなし |

新規checkout相当の隔離cwdへsrc／cli test／package／tsconfig等と既存node_modules参照を配置し、対象source／testのSHA-256一致と開始時dist／.workbench/p08不存在を確認しました。明示`npm run build`→CLI全25件は両exit0です。証拠は`.workbench/p08/fresh-proof.txt`、fresh-build.log、fresh-cli.logで、一時cwdは検証後に削除しました。clone／ネットワークはありません。

既存CIとpackage checkはtest→build順で、新規checkoutにはdistがないためbuilt CLI testが成立しませんでした。primaryがCIとcheckをformat→typecheck→build→testの順へ修正しました。既存workspaceの`npm run check`と、src／全tests／package／TypeScript・Prettier設定／Schema・例をSHA-256一致で配置し、dist／Workbenchの事前不存在を確認した隔離cwdの`npm run check`は、いずれもexit0・全192件passです。clone／ネットワークは使用せず、一時cwdを削除しました。元ログは`.workbench/p08/primary-check.log`、`check-order-fresh.log`、配置証拠は`check-order-proof.txt`です。GitHub Actionsのremote実行結果はまだ取得していません。

P08 checkpoint SHAは`c556f09fd52083e1c355815871b93aaaf85d69e7`です（primaryの完全差分・元ログ確認・commit済み）。この担当はstage／commit／push／branch変更、外部分析、追加agentを実行していません。packはdry-runのみでpublishしていません。P09／P10、実TUI、tarball導入、実TTY、正式60秒性能・全受け入れは未完です。

## P09 — TUIライフサイクルと実runner接続

開始時は`main`／`c556f09fd52083e1c355815871b93aaaf85d69e7`／cleanを確認しました。変更は`src/tui.ts`、`tests/tui.test.ts`、CLIの実runner接続とCLI tests、本reportです。primary所有のREADME／design／verification等を保持しました。新moduleの抽出・runtime依存追加はありません。

公開`runTui(deps, intervalMs)`はterminal／monotonic timer／collectorを注入し、snapshot／usage-error／abortedの結果境界を使います。実rendererでviewport本文を作り、alternate screen・cursor・clear制御だけを製品で追加します。unitのterminal／timer／collectorはすべて合成adapterです。初回、2,000ms tick、初回scan＋drawが5,000msに完了した場合の次6,000ms開始を確認しました。scan／drawは直列で、完了時より後の開始グリッドへ一つの次tickだけを予約し、missed tickを追いかけません。

resizeは最新Snapshotの再描画だけで、追加採取をしません。連続resizeを最後の寸法へまとめ、採取／描画／背圧待機中は最新のresize要求だけを保持します。callbackとwrite(false)のdrainを待ってから次のframe／scanへ進み、無限frame queueを作りません。小さいviewportや0列も既存rendererをそのまま使います。

停止は冪等で、自分のpoll／resize timer・data／input error／resize／signal listenerを解除し、Abortを発行、保存raw状態へ戻し、自分が開始したinput flowをpauseします。既存のraw／flow／listenerは保持します。cursor表示・SGR reset・alternate leaveを試み、一つのlocal復元失敗でも後続を試します。q0、ETX／SIGINT130、SIGTERM143、内部／input／出力障害／通常復元障害1、stdout EPIPE0です。EPIPE後は同stdoutへ復元writeを追加しません。close済みstdoutにもwriteを追加せず、local復元を行います。

採取待機・frame／drain待機中の停止は、採取や出力callbackの完了を前提にせずlocal復元を開始します。出力が詰まっていない通常復元はcallbackを待ちます。既存出力が詰まっていれば復元writeを最大1回queueし、runTuiを待機から解放します。残したerror guardianは自分のもの最大1つで、queued callback／closeが決着すると解除し、新timer／frame／writeを起こしません。遅延callbackのerrorとerror eventの両方を受けても通知を重複しません。終了後に採取がresolve／rejectしても描画・予約・exit変更をしません。

背圧停止後の遅延出力失敗は注入`onLateExitCode`へ渡します。unitはglobal process.exitCodeを変更しません。CLI entryはmainの返却と遅延通知を統合し、早い障害1を後のmain0で上書きせず、130／143を保持します。この非応答stdoutの優先境界はprimaryと確認し、primaryがdesign5.8へ明示しました。

同moduleの`createNodeTuiDependencies(startup, options)`をdefault CLIへ接続しました。Nodeのstdin／stdout／自身のsignal listener、performance.nowとsetTimeout、既存collectInputs→buildDashboard→renderTextを使います。起動env／cwd／osHomeは固定コピー、user configは各採取で再読込です。実adapterの合成childでdefault runner→採取・描画→q→raw／input flow復元を確認しました。設定3→4再読込とstartup envの後変更を受けない結果も確認しました。P08の未実装runner状態caseは「不完全terminal adapterを安全なexit1へ閉じる」caseへ更新し、その他のP08契約を保持しました。

### TDD実行証拠

`tdd`に従い実行可能stubから一件ずつ実装しました。選択commandは`npm test -- tests/<suite>.test.ts -t '^<name>$' --reporter=verbose`です。下表17件は対象各1件のAssertionErrorを元ログで確認したRed exit1→Green exit0です。import／compile／spawn失敗、timeout、0件suiteは含みません。非同期結果はresolvesとliteral期待値で確認します。

| suite | 真のassertion Red→Green | Red / Green exit |
|---|---|---|
| tui | collects-immediately-and-renders-current-viewport | 1 / 0 |
| tui | polls-on-two-second-start-grid | 1 / 0 |
| tui | coalesces-resize-without-collecting | 1 / 0 |
| tui | q-aborts-restores-and-removes-only-owned-resources | 1 / 0 |
| tui | raw-etx-and-sigint-exit-130 | 1 / 0 |
| tui | sigterm-exits-143-and-preserves-signal-code-on-restore-failure | 1 / 0 |
| tui | waits-for-frame-drain-before-next-scan | 1 / 0 |
| tui | resize-during-drain-keeps-only-latest-dimensions | 1 / 0 |
| tui | epipe-exits-zero-without-restoring-to-broken-stdout | 1 / 0 |
| tui | q-during-drain-resolves-and-bounds-late-error-guardian | 1 / 0 |
| tui | late-collector-rejection-does-not-change-exit-or-write | 1 / 0 |
| tui | input-error-restores-with-safe-exit-one | 1 / 0 |
| cli | connects-default-runner-to-node-adapters-and-restores-input | 1 / 0 |
| cli | entry-keeps-early-late-error-instead-of-overwriting-with-main-zero | 1 / 0 |
| tui | pending-output-close-notifies-late-failure-and-removes-guardian | 1 / 0 |
| tui | error-during-drain-after-callback-releases-stop | 1 / 0 |
| tui | output-close-during-drain-stops-without-restoration-write | 1 / 0 |

次の13件は初回pass回帰です。既存の組合せで成立したslow scan／例外／遅延通知等に人工的なRedを作っていません。CLIの遅延障害・signal2件の初回は同じselectionで2件pass、残りは各1件の選択です。

```text
tui: skips-missed-ticks-without-overlap
tui: internal-collector-exception-restores-and-exits-one
tui: other-output-error-exits-one-and-keeps-local-restoration
tui: q-during-collection-restores-before-late-result
tui: late-output-error-notifies-once-after-backpressured-q
tui: late-output-error-keeps-signal-exit-code
tui: normal-restoration-output-failure-exits-one
tui: guardian-close-cleans-up-without-new-frames
tui: restores-original-raw-and-input-flow-state
tui: cleanup-attempts-remaining-steps-after-local-failure
cli: entry-reflects-delayed-output-error-in-final-process-code
cli: entry-keeps-signal-code-after-late-output-error
cli: node-collector-rereads-config-with-fixed-startup
```

Workbench ensure→親directoryの作成・実在確認後にログを書きました。元command／stdout・stderrは`.workbench/p09/cycles.log`、exitは`exits.txt`、CLIの先行buildは`build.log`へ保持しています。途中typecheckはtest harnessのfixturesとreturn型の循環推論・派生implicit anyでexit1でした。明示Harness型を付けてexit0へ修復し、このcompile失敗を製品Redと扱いません。その他にTDD手順逸脱や未処理runtime失敗はありません。中間22件成功と最新25件成功のログを両方保持します。

### 最終検証

| command | exit | 結果・証拠 |
|---|---:|---|
| `npm test -- tests/tui.test.ts -t '^skips-missed-ticks-without-overlap$' --reporter=verbose` | 0 | 指定case 1件pass、cycles.log |
| `npm test -- tests/tui.test.ts --reporter=verbose` | 0 | TUI25件pass、suite.log |
| `npm test -- tests/cli.test.ts --reporter=verbose` | 0 | CLI30件pass（既存25件＋P09追加5件）、cli-suite.log |
| `npm run typecheck` | 0 | typecheck.log |
| `npm run check` | 0 | format／typecheck／build／全222件・10suite、check.log |
| `git diff --check` | 0 | 空白エラーなし |

CLI scenarioとbuilt entry試験は専用childのHOME／home／profileを合成fixtureへ固定し、deps未接続でもlive Oracleへ到達しない隔離を維持しました。terminal preloadはchildだけの制御で、親env／stdio／exitCodeを変更しません。fixtureは後始末済み、元ログは保持しています。P09で実Oracleデータ・秘密値を使用していません。製品の対象データwrite／Oracle・Chrome・CDP・ネットワーク・cleanup・process probeを追加していません。

primaryは製品・testの全差分を読み、元cycles.logとexits.txtから17件すべての対象1件AssertionError・Red1→Green0を独立照合しました。4 source/testのSHA256と元ログhashを`.workbench/p09/primary-cycles-proof.json`へ記録しました。`npm run check`を改めて実行し、exit0、全222件・10suiteとformat／typecheck／buildの成功を確認しました（primary-check.log）。READMEへ起動・設定・数字の意味を追加し、説明HTMLを同じ検証範囲へ同期しました。HTMLの既定validatorはexit0で、1図のSVG描画と拡大・keyboard・focus復元が成功しました。これらを導入済みCLI・実端末・正式性能の検証証拠には使いません。

P09 checkpoint SHAは`33b6b38330206f626196ae95cd17e11a4b041025`です（primaryの完全差分・元17pair・独立222件check・HTML確認後にcommit済み）。この担当はGit書込み、外部分析、追加agentを実行していません。P10の導入済みtarball、built CLIの実PTY／native TTY、正式60秒CPU／RSS／p95、安全性全受け入れは未検証です。Node実adapter接続の合成child検証を実端末の画面・復元確認とは扱いません。製品受け入れ全体は未完了です。

## P10 — 配布・PTY・read-only・性能（局所実装・自動検証完了）

開始時は`main`／`33b6b38330206f626196ae95cd17e11a4b041025`／clean、origin/main比ahead8を確認しました。GPT 6.1 Sol / High、`tdd`と`use-workbench`を継続しています。primary所有のREADME／HTML／canonical文書／work-plan／.gitignoreを保持し、stage／commit／push、外部分析、追加agent、nativeアプリ操作を実施していません。

開発用`fixture.mjs`は合成metadataのみを作り、子processのHOME／ORACLE_HOME_DIR／ORACLE_BROWSER_PROFILE_DIRをこのfixtureへ固定します。親のprocess-wide envは変更しません。個別test fixtureを後始末し、installed bin・native確認用fixture・receipt・元ログは`.workbench/p10`へ保持します。開発fixture生成／npm pack／導入の書込みは製品read-only検査と分離しました。

### TDD証拠

元selection／stdout・stderrは`.workbench/p10/cycles.log`、exitは`exits.txt`です。選択commandは`npm test -- tests/<suite>.test.ts -t '^<name>$'`（一部は`--reporter=verbose`付き）です。次の27件は対象各1件のassertion Red exit1→同名Green exit0です。compile／import／harness失敗を含めません。

| suite | assertion Red→Green |
|---|---|
| performance | creates-thousand-bounded-synthetic-metadata-files |
| performance | evaluates-fixed-performance-budgets-with-one-core-cpu |
| performance | dates-development-fixture-relative-to-explicit-clock |
| integration | rejects-pack-contents-outside-public-allowlist |
| integration | real-worker-preserves-one-mib-unicode-document-and-poll-config |
| integration | reports-only-bounded-read-metrics-through-real-worker |
| json-reader | reads-small-document-with-proportional-buffer-and-extra-byte |
| json-reader | finishes-known-size-short-read-without-redundant-eof-probe |
| json-reader | returns-loaned-buffer-zeroed-after-parsing |
| json-reader | reuses-one-buffer-between-documents-without-keeping-contents |
| json-reader | grows-loan-with-preserved-bytes-and-zeroes-retired-storage |
| json-reader | rejects-buffer-capacity-outside-file-boundary |
| json-reader | prevents-overlapping-buffer-loans |
| json-reader | abort-during-post-stat-starts-no-new-probe |
| collector-service | starts-worker-lazily-and-captures-clock-once |
| collector-service | reuses-one-worker-and-fixed-startup-across-polls |
| collector-service | stop-releases-blocked-poll-and-rejects-late-reply |
| collector-service | rejects-overlapping-polls-without-extra-request |
| collector-service | isolates-worker-error-and-does-not-restart |
| collector-service | isolates-unexpected-worker-exit-before-stop |
| collector-service | preserves-injected-io-path-without-worker |
| collector-service | node-tui-connects-collector-and-disposes-idle-worker |
| collector-service | isolates-metrics-observer-failure-as-internal-error |
| collector-service | abort-during-clock-capture-starts-no-worker-or-read |
| tui | disposes-after-abort-without-waiting-for-collection |
| tui | continues-restoration-after-dispose-failure |
| cli | snapshot-stops-worker-in-finally-after-usage-result |

次の8件は初回pass回帰です。既存cloneの保存値はnormalize／collectorsの公開結果を用いた回帰と、実Workerの1MiB／Unicode保存値の公開結果で照合し、メモリ改善だけに人工的なRedを作っていません。

```text
integration: reads-complete-snapshot-without-changing-fixture-or-opening-unrelated-files
integration: production-imports-and-capabilities-exclude-forbidden-effects
performance: rejects-each-budget-overrun-without-relaxing-limits
tui: preserves-signal-priority-when-dispose-fails
collector-service: aborts-blocked-worker-and-removes-only-owned-listeners
collector-service: stop-before-first-poll-does-not-create-worker
json-reader: accepts-cross-realm-promises-and-legal-thenables
json-reader: zeroes-pool-after-parse-failure-and-reads-next-file
```

開発fixtureは任意nowMsを受け、controlled literalの2030年基準で2分前／1分前を確認しました。perf／coreはFIXED_NOW、installed CLI／native用fixtureはDate.now起点です。製品clock用の隠しenvは追加していません。旧固定日付fixtureのsmoke成功はその実行時点の回帰として残します。

### 配布・PTY・安全性

`smoke:cli`は最新buildをpackし、専用準備済みcacheから`--offline --ignore-scripts --omit=dev`で別prefixへ導入、そのnpm binを直接実行します。runtime直接依存json5／string-widthの2つ、Node24 ESM、pack allowlist（dist・README・package.json）を検査します。help0／version0／非TTY2（stdout空）／JSON0／text0／closed pipe EPIPE0の6ケースが成功しました。JSON全20current／40submitted・2warning、text全行・全警告・長いslug・ANSIなし、読取前後tree／SHA256／mtimeNs／mode不変を確認しました。導入元tarballとsource／dist hash、bin／fixture pathは`installed-receipt.json`へ保持します。production再修正後は最新buildで再pack・再導入し、旧receiptを新製品の証拠へ流用しません。

`smoke:tty`はPython標準PTYでinstalled binを起動し、120×32／80×24／幅不足／高さ不足／連続resize、q0／ETX130／SIGINT130／SIGTERM143、開発adapter注入例外1の9ケースを検査しました。cursor表示・SGR reset・alternate leave、raw制御／その他永続termios flagsの復元が成功しています。macOSがcanonical復帰時に付ける一時PENDINだけを比較から除外します。controllerがTTYを保持したまま終了直後flagsを検査し、専用ack pipeでcontrollerを終了させます。これはnative画面・折返し／scroll／shell入力の合格証拠ではありません。

read-onlyは製品禁止import／APIのstatic検査、O_RDONLY／O_NOFOLLOW／O_NONBLOCK能力境界、合成fixtureのtree／内容hash／mtimeNs／mode前後一致、logと他profileのopen0を組み合わせました。atimeは比較から除外します。実Oracle metadata、秘密値、full conversationを使用していません。

### 正式性能と原因計測

Node24.14.0／npm11.18.0／macOS27.0.1 arm64／Mac16,10・10core・32GiB／ローカルAPFS PCI-Express SSDです。primaryの環境証拠は`environment.md`です。各正式runは1000件×16384bytes、2000ms・60000ms、採取→限定投影→集計→120×32描画を含みます。fixture生成は別processで測定前に行い、npm処理も測定外です。process.cpuUsage user＋system／wallで1コア平均CPU、process.resourceUsage maxRSS、scan時間p95、initial、scan/read peak、input hashとsource identityを保存します。

| 正式run | CPU | peak RSS | p95 | scan数 | scan/read peak | fixture不変 | exit |
|---|---:|---:|---:|---:|---|---|---:|
| before（perf-before.json） | 17.1429% | 97.1094MiB | 295.3166ms | 30 | 1 / 1 | true | 1 |
| proportional buffer（perf-buffer.json） | 12.4051% | 139.3281MiB | 257.0420ms | 30 | 1 / 1 | true | 1 |

CPU<=5%だけが超過しており、合格と記録しません。adapterでdistinct buffer容量を計測し、30scanの確保量31,520,224,620→491,550,870bytesを確認しました。readerはstat.size+1の初期bufferとfull時bounded拡張へ変更しました。追加byte／1MiB+1検出・短いread・identity／size／mtime／ctime再検査・abort・finally closeを保持し、focused assertion Red→Greenとreader全30件passを確認しました。通常16KiBのfileでは拡張copyは発生しません。

private原因比較`io-cause*.json`ではguardを減らさず、callback API Promise wrapperもCPU改善が不足でした。main-thread同期syscallのscratch比較は行いましたが、OS read待機中のq／signal復元保証を保てないためproductionへ採用していません。これはWorker採用前の原因比較履歴です。後段の正式内部契約固定後にWorkerを製品へ実装しました。短い比較やpreflightを正式性能passへ転記しません。

### Worker候補のscratch比較（製品採用前）

main-thread同期I/Oは不採用とし、採取全体をWorker1本へ隔離する内部候補をprimaryと検討しました。1pollを1request/responseとし、mainで捕捉したnow、固定startup、SharedArrayBuffer停止flagを渡します。worker内部だけのread-only sync syscallの前後で停止flagを確認し、既存coreのabort／finally closeを維持します。raw文書はIPCへ渡しません。

| scratch候補 | CPU | peak RSS | p95 | exit | 判定 |
|---|---:|---:|---:|---:|---|
| 元Worker（worker-result.json） | 5.9874% | 204.5156MiB | 131.9142ms | 1 | CPU／RSS超過 |
| normalized clone＋zero化pool、準備別process（worker-lean-both-result.json） | 4.7638% | 197.3906MiB | 108.1253ms | 1 | RSS超過 |
| 上記＋young領域4MB（worker-young-result.json） | 4.8494% | 136.2813MiB | 95.8802ms | 0 | ambient env未固定の比較証拠のみ |
| plain Awaitable＋合成ambient env（worker-plain-result.json） | 5.2084% | 127.5938MiB | 117.7496ms | 1 | CPU超過 |
| 上記＋early-read（worker-early-result.json） | 4.9382% | 129.2344MiB | 118.3901ms | 0 | 候補の同時合格、製品は未採用 |

各runは変更ごとに別job・別結果へ保存し、同じ候補を合格するまで繰り返していません。全process／全threadのCPU、Worker startupを初回と全体へ含め、old／stack／valid入力の追加容量上限や強制GCを使っていません。すべて30scan・peak scan/read1・input不変です。後半2runはWorker ambient envもHOME＋正規ORACLE3設定で合成fixtureへ固定しました。前半はstartupの明示fixtureによる実読取限定だけだったため境界不足と区別します。実Oracleの読取・データ保存はありません。

投影済みNormalizedSessionのstructuredCloneは保存値を変えず、元JSON文字列のbacking参照を切る候補です。worker限定のbuffer poolはdecode／parse完了後にゼロ化し、貸出1本・成長MAX+1・返却finallyを守る候補で、metadata cacheとは区別します。heap／external／ArrayBufferをprivate比較で確認しました。young領域4MBは一時object nurseryだけの設定です。

early-readは、最初のfstat.sizeへtotalがちょうど到達し、最後のbytesReadがrequested未満の場合だけ後段の全file／parent identity・size／mtime／ctime検査へ進みます。size未達のshort readは継続し、growでbufferが満たされればMAX+1まで検出します。scratchのsize0・1byte chunk・Unicode・growMAX+1・post-read変更5項目はexit0でした（early-checks.log）。候補の成功を製品合格へ流用しません。primaryが内部契約とP10順序を正式仕様へ固定し、次の製品実装・再測定へ進みました。

### 専用Workerの製品実装と再測定

`createInputCollector`は必要設定を固定コピーし、mainでnowを1回捕捉してから、遅延起動するWorker1本へ採取全体のrequestを送ります。1件だけの待機を持ち、poll間で再利用、同時要求を安全な内部失敗へ閉じます。worker ambient envはHOMEと正規ORACLE3項目だけ、execArgvは空です。注入I/O経路は既存の非同期coreを保ち、内部Awaitable型で同期値をPromiseと偽装しません。

Worker内だけのread-only sync adapterへ既存guardを適用し、各I/Oの前後で共有停止flagを確認します。finally close、descriptor追跡、borrow／decode・parse／finally release、成長旧領域と返却使用領域zero化、MAX+1上限を維持します。NormalizedSessionだけstructuredCloneし、raw文書・promptをIPC／cache／historyへ保存しません。nursery4MiB以外へold／stack／入力容量上限を追加しません。

stopは冪等・同期で、待機callerをabortedで解放し、unref・terminateを要求します。idleも停止対象、終了前のerror／exitは内部失敗、停止後の返信・障害は破棄、停止後に再生成しません。自分のlistenerだけを解除し、terminate決着まで有界error guardianを残せます。OS syscallの即時中断は主張しません。CLI snapshotはfinally stop、Node TUIは同じcollectorとdisposeを使い、Abort後dispose失敗でも端末復元を続け、130／143を保持します。

有限なmetrics3項目だけを任意observerへ渡します。実Worker2pollでreadPeak1／各readCalls3／初回確保あり・次回0を確認しました。未注入時に追加ログ・通知を作りません。1MiB有効JSON、日本語・結合文字・ZWJ emoji・未知effortの保存値、config再読込、停止・遅延返信・listener所有境界を公開結果で確認しました。reader全36件、limited cloneのnormalize／collectors回帰、接続後の全252件checkはいずれもexit0です（後続focused追加を含む最終件数は完了検証へ記録します）。

製品の初回正式60秒は`perf-product.json`／logへ保持し、CPU5.9186%でexit1でした。RSS136.7969MiB、p95120.1886ms、30scan、scan/read peak1、buffer実確保16388bytes／read30060回、fixture不変です。fixture生成と事前hashは別process、終了後inventoryはCPU／RSS固定後に行いました。source／dist identityはpath＋content SHAだけです。

差分原因の8scan比較では、syscallごとの短命operation closureをadapter作成時に一度だけ作るguard wrapperへ置き換え、CPU689870→668804µs（約3.1%減）でした（guard-cause.json／log）。全IO前後の停止flag・abort判定・例外伝播・closeを変えない等価整理をprimaryが承認し、4suite80件の回帰をexit0で確認しました。無変更の合格狙い再実行ではありません。変更後の正式60秒もCPU5.7168%でexit1でした（perf-product-guard.json／log）。RSS136.6875MiB、p95152.7255msです。旧失敗を保持して次の原因比較へ進みました。

decoder再利用とNormalizedSession配列単位cloneは、8scan CPUのcurrent668451µsに対し672772／726520µsで改善せず、不採用です。保存値の変更やraw文書cloneへは進んでいません。同期IO結果にもawaitしていたmicrotaskを省く比較は688687→663799µs（約3.6%減）。primary承認の等価整理としてreader／sessions／leasesへconditional awaitを適用し、内部AwaitableをT|PromiseLike<T>としてnative／cross-realm／合法thenableを正しく受理します。即時throw／遅延reject・変更検査・abort／close／pool返却の既存回帰を維持しました。reader post-fstat中abortで後続probeが始まる抜けも公開assertion Red→Greenで修復しました。

TUIの可視行だけtableLineを作る比較は、同一snapshot／viewportの出力一致を先に確認し、40描画CPU214868→78230µs（約63.6%減）でした。全件の保護列width計算・全snapshot出力・省略件数は維持し、永続cacheを追加していません。reports-omitted-rows-per-sectionと全renderer回帰を成功しました。

同じ最新製品Worker経路・metrics注入の正式60秒は`perf-product-conditional-visible.json`／logへ保存し、exit0です。CPU4.56811955%（user1153542＋system1587420µs／wall60001.976084ms）、peak RSS111.46875MiB、p95117.161208ms、initial117.161208ms、30scan、scan/read peak1、read30060回、buffer実新規確保16388bytesでした。1000件×16384bytes、2秒周期、入力tree不変です。Worker起動を初回と全体へ含め、全thread CPU／process全体RSSを使い、強制GC・old／stack／入力容量制限を加えていません。young4を維持し、8比較は不要となり未実施です。

sourceSHAは`eb72f81253886d7af827fef59f3314b4ecfd5bcb516c6ade34ddd2348da12e8a`、distSHAは`7cd1adf9991a20ce9508fd1c905054bd7aae673927a9146f4e15d4d5e186ee05`です。いずれもpath＋content SHAの集合から算出し、READMEやmtime変更を製品identityへ混ぜません。入力tree hashは`54ad10d428e7a558f34eda3287c7681e0433f89c31693295b032c45c9a7a4f77`。最新offline導入receiptともsource／dist両SHAが一致し、旧packの結果を流用していません。

### 局所最終検証

| command | exit | 結果・元ログ（.workbench/p10/） |
|---|---:|---|
| `npm run build` | 0 | conditional-render-build.log、最新smoke内でもbuild0 |
| `npm test -- tests/integration.test.ts tests/performance.test.ts --reporter=verbose` | 0 | 2suite9件、final-p10-suite.log |
| `npm test -- tests/render.test.ts -t '^reports-omitted-rows-per-section$' --reporter=verbose` | 0 | 対象1件、final-render-target.log |
| `npm test -- tests/cli.test.ts -t '^emits-one-json-document$' --reporter=verbose` | 0 | 対象1件、final-cli-target.log |
| `npm run typecheck` | 0 | final-typecheck.log |
| `npm run check` | 0 | format／typecheck／build／13suite257件、final-check.log |
| `npm run smoke:cli` | 0 | 最新pack→専用cacheのoffline導入→installed bin6ケース、final-smoke-cli.log |
| `npm run smoke:tty` | 0 | installed bin9ケース、final-smoke-tty.log／tty-result.json |
| `node scripts/performance.mjs --measure .workbench/p10/perf-fixture .workbench/p10/perf-product-conditional-visible.json` | 0 | package perfと同じ測定engine・正式60秒、perf-product-conditional-visible.log |
| `git diff --check` | 0 | 空白エラーなし、final-diff-check.log |
| `python3 scripts/check-planning.py` | 0 | 文書／readiness検査、final-planning.log |

配布36fileはdist／README.md／package.jsonだけです。leafのSTOP時点のtarball SHA256は`a76d11298be428964cff8cb0b565d6e43a3a131f71752f740d762213b80f91e4`。installed bin、現在時計起点の合成home／profile、tarballはinstalled-receipt.jsonで指定するscratchへ保持しました。fixture／spec／workbench／実データをpackへ含めず、global install／publishは行っていません。27件assertion Redと選択command、source／dist／tarball hashと主要ログSHAをfinal-proof.jsonへ記録しました。原ログと失敗runは保存しています。

### 手順・環境失敗の区別

- 最初のfixture Redのexit記録はzsh予約変数`status`で失敗しました。元VitestのAssertionError／1failedはcycles.logに残り、exit1を後からexits.txtへ記録しました。
- 最初のperf起動は相対cwdによるusage-errorで測定前終了exit1。rootを絶対化し、60秒正式runとは区別しました。
- pack初回は既定npm cache権限でexit1。packにも専用cacheを指定しました。offline installは最新transitive tarballがcache不足でexit1となり、ネットワークを使う専用cache準備を開発処理として分離して修復しました。
- CLI長slug失敗はfixtureがroot.slugへ置いた誤前提です。正本options.slugへ訂正し、製品バグ／Redから除外しました。一部CLI初期失敗の同名ログを上書きした記録手順不足があり、元command／exitはexits.txtとtool履歴に残ります。残る元ログは保持し、以後は試行別名で記録します。
- PTY初回はsession leader終了後のslave tcgetattrがENOTTYとなるharness失敗。controller版はtty readline／cleanup waitでdeadlineを越えて停止したため、元session23236へCtrl-Cを送りexit130で中断しました。元traceを保持し、別jobの重複起動はしていません。nonblocking master・専用ack pipe・有界cleanupへ修復しました。PENDINのみの誤比較も製品Redから除外します。
- Worker stubのbuildはoptional io narrowing不足でexit2、CLI seam追加buildはshebang前importでexit2、guard overloadの戻り型もexit2でした。各修復後build0を記録し、製品Redから除外します。Node TUI接続の最初の試行は早すぎるimport除去のReferenceErrorで除外、実行可能境界へ戻した後の公開期待値assertion Red→Greenだけを採用しました。
- 最初のcheckは追加したperformance testの未整形でformat exit1。Prettier後の再検証を別ログへ保存します。typecheck初回はexit0です。

native端末はprimaryのCUAでTerminal／Ghosttyがアプリ安全規則により拒否され、未検証を維持しています。この担当から別経路で操作していません。最終受け入れ表・納品artifact・文書全体・Gitはprimary所有です。このleafは2026-10-01 04:03 JST時点で局所実装・自動検証を完了してSTOPします。HEADはmain／33b6b38330206f626196ae95cd17e11a4b041025のままで、製品source／distの上記hashを固定します。native画面／shell入力、primaryの最終A01〜A49表・独立review／checkpoint・文書／artifact同期は残っています。

## Primaryによる最終自動検証とA01〜A49の照合

primaryはP10の製品差分、開発harnessとテストを読み、元cycles.logを独立に解析しました。対象各1件のAssertionError・Red1と後続の同名Green0が27組あり、ReferenceErrorの1試行を除外し、元ログhashがleafの記録と一致することを確認しました。証拠は`.workbench/p10/primary-cycles-proof.json`です。初回pass回帰をRedへ数えていません。

| primary command | exit | 結果・ログ |
|---|---:|---|
| `npm run check` | 0 | format／typecheck／build／257件・13suite、primary-check.log |
| `npm run smoke:cli` | 0 | 更新READMEを含む再pack・offline導入、installed bin6ケース、primary-smoke-cli.log |
| `npm run smoke:tty` | 0 | 同じ新installed binの9ケース、primary-smoke-tty.log／tty-result.json |
| `node /Users/iwasawayuuta/.agents/skills/japanese-explanatory-html/scripts/validate-plantuml-html.mjs docs/overview.html` | 0 | 1図のinline SVG、拡大・keyboard・focus復元、primary-html.log |
| `python3 scripts/check-planning.py` | 0 | 32要件／10工程／8境界／49ケースの文書整合 |

最新tarballは`928dd23cc5d6a07d5df40c15523f3c4192bf57097a31bf448f74058738686fcb`です。36fileのallowlistを通り、個人データを含みません。sourceSHA `eb72f81253886d7af827fef59f3314b4ecfd5bcb516c6ade34ddd2348da12e8a`、distSHA `7cd1adf9991a20ce9508fd1c905054bd7aae673927a9146f4e15d4d5e186ee05`は、primaryの再build・最新導入・正式性能の3者で一致しました（primary-identity.json）。README変更やmtimeだけの変更で同じ実行コードの性能を再測定せず、正式60秒の成功をこの一致から対応付けます。

以下は名称だけでなく、各公開境界のliteral assertionと全257件の成功、導入CLI／PTYの実行証拠に照合した表です。`pass`は記載した境界の検証成功を示します。`一部／未検証`の4ケースは、実端末の目視・shell入力と、それを含む最終完了条件が残るためです。製品の未修正不具合4件という意味ではありません。R-ID／D-IDの対応はacceptance.mdを正本とします。

| Case | 状態 | 検証境界・主要期待値／証拠 |
|---|---|---|
| A01 | pass | tui：初回即時、2,000msの開始grid、q=0。installed PTYでも起動・q復元 |
| A02 | pass | cli：1採取、text全行・ANSIなし、JSON一文書。installed CLI20current／40送信・全2警告 |
| A03 | pass | collectors／aggregate：8日前startedAtのrunningもcurrentへ残る |
| A04 | pass | config：JSON5のcomment／trailing commaを受理し、許可2項目だけ投影。project探索なし |
| A05 | pass | collectors：有効v1台帳2件はstale／duplicateでも2、欠損0、不正null |
| A06 | pass | collectors：壊れたmetadataを隔離し、正常レコードと解析警告だけを保持 |
| A07 | pass | integration／installed CLI：read-only能力・禁止API静的検査、tree／内容SHA／mtimeNs／mode不変 |
| A08 | pass | normalize／aggregate／render：pending／runningだけ、保存statusと6列を保持 |
| A09 | pass | aggregate：elapsed10s、20s、nullの順。同値はid UTF-16順 |
| A10 | pass | aggregate：24completed＋2partial＋4error＋1cancelled→evaluated30／success0.8 |
| A11 | pass | aggregate／render：分母0はnull／N/A、failureRate／errorRateなし |
| A12 | pass | normalize／aggregate：true＋hash nullは1、文字列true／falseは0 |
| A13 | pass | normalize／aggregate：completed＋初回true＋followUps2→3、error→1、false→0 |
| A14 | pass | normalize／aggregate：不正follow-up配列は全体拒否、初回1だけ＋warning |
| A15 | pass | aggregate：24H／7D下限とnowを含み、下限−1ms／now＋1msを指定窓から除外 |
| A16 | pass | aggregate：同conversation IDの別directoryを各1件、7D0行を非表示 |
| A17 | pass | aggregate：model／effort固定優先順、その他はraw UTF-16順、保存case保持 |
| A18 | pass | render／installed text：Oracle-only、direct ChatGPT除外、requested値・代理値の注記 |
| A19 | pass | aggregate／render：同profile current→env→config→3、4/3を保持しtext133.3% |
| A20 | pass | render：5領域、successだけ、quota領域なし |
| A21 | 一部／未検証 | renderの日本語・結合文字・emoji幅、project／slug優先短縮はpass。実端末の目視は未検証 |
| A22 | pass | render／cli：表別省略件数。単発text／JSONは省略せず、installed CLIでも全件 |
| A23 | pass | render：OSC／ESC／C0／C1／CRLF／TAB／Bidiを無害化、入力由来の単一セルを保持 |
| A24 | pass | package／installed CLI：Node24 ESM bin、runtime直接依存2つ、公開36fileだけ |
| A25 | pass | tui：scan5s／interval2sは次6s、同時scan1、drain中も重複採取なし |
| A26 | pass | 正式製品60s：1000×16384bytes、CPU4.5681%、RSS111.4688MiB、p95117.1612ms、30scan、scan/read peak1 |
| A27 | 一部／未検証 | tui＋PTY：q0／ETX・SIGINT130／SIGTERM143／例外1、raw flags・cursor・alternate復元はpass。実端末の画面・shell入力は未検証 |
| A28 | 一部／未検証 | 全check、CLI6／PTY9、readonly、性能、README／HTMLはpass。native確認とレビュー完了までR32全体をpassにしない |
| A29 | pass | cli／installed bin：非TTY既定はstdout空・exit2、snapshot JSONはexit0 |
| A30 | pass | json-reader／collectors／integration：配下symlink、1MiB+1、消失を隔離。log・他profileのopen0 |
| A31 | pass | aggregate：created8日前・completed1時間前はreliability対象／usage窓外 |
| A32 | pass | time／normalize／aggregate：欠損・不正の独立fallback、有効な未来はfallbackせずelapsed null |
| A33 | pass | normalize：未知model＋ChatGPT URLは保存名のまま対象、根拠なしは警告・除外 |
| A34 | pass | normalize：mode欠損をmodelから推測せず、browser残骸のあるapiも除外 |
| A35 | pass | normalize：ChatGPTとGemini根拠の同居をPROVIDER_CONFLICTで除外 |
| A36 | pass | normalize／aggregate：未知statusはcurrent／reliability外、送信trueのusageは1 |
| A37 | pass | config／normalize：home変更でprofile default不変、相対保存profileはsession cwd基準 |
| A38 | pass | collectors／aggregate：選択profileだけを読み、他profileのmaxを採用しない |
| A39 | pass | aggregate：同profileの古いmax3／新しいmax2→2＋競合警告、同時刻はid順 |
| A40 | pass | aggregate：所属不明max9を推測採用せず、env4へfallback |
| A41 | pass | time：不可能日付拒否、+09:00とUTC同値、0001／0099年を正しく保持 |
| A42 | pass | normalize／aggregate：未来startedAtは過去createdAtへ戻らず、usage窓外／elapsed null |
| A43 | pass | normalize／aggregate：不完全配列を全体拒否し追加0、duplicate有効文字列は長さ2 |
| A44 | pass | collectors／aggregate：全体取得不能は3領域null、正常空は[]／0、部分破損は読めた値＋警告 |
| A45 | pass | serializeJson：生C1・端末制御を出さず、JSON.parse後は保存文字列と一致 |
| A46 | pass | schema：実Ajv2020 strictでextra property／未知warning／負elapsed／不正null組合せを拒否。算術・順序等はaggregateの別assertion |
| A47 | 一部／未検証 | render／PTY：幅不足・高さ不足、全件保護列幅、最終行／列の余白、snapshot全件はpass。実端末の折返し・scrollは未検証 |
| A48 | pass | tui／cli：drain中resize／q／EPIPE、遅延error／closeの停止、重複write・late描画・無限待機なし |
| A49 | pass | json-reader／collectors：読取中変更を隔離、次poll正常file採用、last-good補完なし |

実端末確認には、最新installed receiptとtarball／dist一致を先に検査する`.workbench/p10/native-run.mjs`、寸法・終了4経路を記載した`native-check.md`を用意しました。これは未実施の開発用手順です。Terminal／GhosttyへのComputer Useがアプリ安全規則で拒否されているため、別経路で回避しません。操作許可の変更か、人間の実施結果を待ちます。自動PTYの成功を目視・shell入力の成功へ転記しません。

## 残工程と再開条件

| 工程 | 状態 | 残る証拠 |
|---|---|---|
| P03 | checkpoint済み | 上限付きreadの29テストとfocused履歴 |
| P04 | checkpoint済み | 設定・intervalの22テストとfocused履歴 |
| P05 | checkpoint済み | 限定投影・日時の46テストとfocused履歴 |
| P06 | checkpoint済み | 採取・集約の47テストとfocused履歴 |
| P07 | checkpoint済み | 描画・Schemaの23テストとfocused履歴 |
| P08 | checkpoint済み | CLI 25テスト、built argv／stdout／stderr／exit・pack dry-run |
| P09 | checkpoint済み | TUI25件＋CLI追加5件、終了・復元・resize・非重複poll |
| P10 | 局所自動検証成功、primary review前 | native画面／shell入力、最終A表・review・checkpoint・文書／artifact同期 |

P10はP09 checkpoint後にbranch／HEAD／worktreeと所有範囲を再確認して開始しました。後続も`tdd`に従い、一つの公開振る舞いごとにテスト選択commandとRed／Greenのexit・件数をこのreportまたは`.workbench`のログへ残します。製品受け入れ全体は未完了です。
