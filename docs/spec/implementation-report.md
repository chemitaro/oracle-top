# 実装報告

状態: P02はcheckpoint済み、P03の実装・局所検証が完了し、primaryによる差分確認とcheckpoint commitを待っています。P04〜P10は未実施で、製品実装は未完了です。

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

P03 checkpoint SHA: 未作成（primaryが差分確認・commitを担当）。集約／collector、配布CLI、実TTY、安全性の全製品証拠、性能値は後続工程です。readerは1readにつき最大1MiB+1のbufferを確保するため、P10で1,000件fixtureのCPU／RSS／p95を実測します。実測なしで性能passとは扱いません。

## 残工程と再開条件

| 工程 | 状態 | 残る証拠 |
|---|---|---|
| P03 | 実装・局所検証済み、checkpoint待ち | 上限付きreadの29テストとfocused履歴 |
| P04 | 未実施 | home/profile・設定・interval解決 |
| P05 | 未実施 | session投影・日時・未知値 |
| P06 | 未実施 | 走査・集計・capacity・Snapshot不変条件 |
| P07 | 未実施 | text／JSON描画・Schema検証 |
| P08 | 未実施 | built CLI・bin・単発プロセス契約 |
| P09 | 未実施 | TUI終了・復元・resize・非重複poll |
| P10 | 未実施 | 配布CLI・実TTY・安全性・性能・全受け入れと文書 |

P04開始条件は、primaryがP03の完全差分を確認してcheckpoint commitを完了し、branch／HEAD／worktreeと所有範囲を再確認することです。後続も`tdd`に従い、一つの公開振る舞いごとにテスト選択commandとRed／Greenのexit・件数をこのreportまたは`.workbench`のログへ残します。
