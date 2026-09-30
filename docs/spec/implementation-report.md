# 実装報告

状態: P02〜P06はcheckpoint済み、P07の実装・局所検証が完了し、primaryによる差分確認とcheckpoint commitを待っています。P08〜P10は未実施で、製品実装は未完了です。

## 実装環境と基準

- 実装担当: GPT 6.1 Sol / High。
- 開始branch: `main`。
- 開始HEAD: `f5b745107f09421655e05c92c8aef7603e9ee68d`。
- 開始worktree: clean。作業中の`docs/work-plan.md`、`docs/spec/readiness.json`、`scripts/check-planning.py`はprimary所有の変更です。
- 環境: macOS、Node `v24.14.0`、npm `11.18.0`。
- scratch/cache: `use-workbench ensure`で解決・ignore確認したプロジェクト内`.workbench`。実Oracleデータ・会話は使用していません。

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

P07の最終検証に新たな警告・失敗はありません。fixtureはメモリ内の合成Snapshotと正式な合成例だけで、実Oracleデータ・秘密値を使っていません。元ログを保持し、除去すべき一時fixture配置はありません。P07 checkpoint SHAは未作成で、primaryが完全差分・元ログ確認とcommitを担当します。この実装担当はGit書込み、外部分析、追加agentを実行していません。

配布CLI・default TTYの実動作・PTY／実TTY終了とresize・採取から描画まで含めたCPU／RSS／p95は未検証です。P10実測で改善の必要性を判断し、予備計測を正式性能passとして扱いません。P08〜P10と製品受け入れ全体は未完了です。

## 残工程と再開条件

| 工程 | 状態 | 残る証拠 |
|---|---|---|
| P03 | checkpoint済み | 上限付きreadの29テストとfocused履歴 |
| P04 | checkpoint済み | 設定・intervalの22テストとfocused履歴 |
| P05 | checkpoint済み | 限定投影・日時の46テストとfocused履歴 |
| P06 | checkpoint済み | 採取・集約の47テストとfocused履歴 |
| P07 | 実装・局所検証済み、checkpoint待ち | 描画・Schemaの23テストとfocused履歴 |
| P08 | 未実施 | built CLI・bin・単発プロセス契約 |
| P09 | 未実施 | TUI終了・復元・resize・非重複poll |
| P10 | 未実施 | 配布CLI・実TTY・安全性・性能・全受け入れと文書 |

P08開始条件は、primaryがP07の完全差分とRed／Greenログを確認してcheckpoint commitを完了し、branch／HEAD／worktreeと所有範囲を再確認することです。後続も`tdd`に従い、一つの公開振る舞いごとにテスト選択commandとRed／Greenのexit・件数をこのreportまたは`.workbench`のログへ残します。製品受け入れ全体は未完了です。
