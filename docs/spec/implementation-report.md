# 実装報告

状態: P02の実装・局所検証が完了し、primaryによる差分確認とcheckpoint commitを待っています。P03〜P10は未実施で、製品実装は未完了です。

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

P02 checkpoint SHA: 未作成（primaryが差分確認・commitを担当）。この実装担当はstage・commit・push・branch変更をしていません。

## 残工程と再開条件

| 工程 | 状態 | 残る証拠 |
|---|---|---|
| P03 | 未実施 | 上限付きreadの公開結果でfocused Red→Green |
| P04 | 未実施 | home/profile・設定・interval解決 |
| P05 | 未実施 | session投影・日時・未知値 |
| P06 | 未実施 | 走査・集計・capacity・Snapshot不変条件 |
| P07 | 未実施 | text／JSON描画・Schema検証 |
| P08 | 未実施 | built CLI・bin・単発プロセス契約 |
| P09 | 未実施 | TUI終了・復元・resize・非重複poll |
| P10 | 未実施 | 配布CLI・実TTY・安全性・性能・全受け入れと文書 |

P03開始条件は、primaryがP02の完全差分を確認してcheckpoint commitを完了し、branch／HEAD／worktreeと所有範囲を再確認することです。P03では`tdd`に従い、一つの公開振る舞いごとに実行したテスト選択commandとRed／Greenのexit・件数をこのreportまたは`.workbench`のログへ残します。
