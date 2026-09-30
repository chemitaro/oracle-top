# 設計書

状態: 正式版（2026-09-30採用）。同一会話のStrict相談をローカルOracle根拠へ照合済み。実装開始時に採用した契約です。現在の工程と検証証拠は[実装報告](implementation-report.md)に記録します。

## 5.1 構成と公開境界

小さな関数群で構成し、汎用的な監視フレームワークやリポジトリ層は作りません。

```text
CLI
 ├─ snapshot ── collectInputs ── buildDashboard ── renderText / serializeJson
 └─ TUI      ── 同じ経路を非重複poll ── viewport付きrenderText
```

| ファイル | 公開境界 | 責務 |
|---|---|---|
| `src/cli.ts` | `main(argv, deps)` | 引数、出力方式、終了コード |
| `src/config.ts` | `resolveMonitorConfig(...)` | home/profile/intervalと許可設定の解決 |
| `src/io/json-reader.ts` | `readJsonFile(...)` | 上限付き安全read、JSON／JSON5解析 |
| `src/io/sessions.ts` | `collectSessions(...)` | 直下走査、最大8並行、ファイル単位隔離 |
| `src/io/leases.ts` | `collectLeases(...)` | v1台帳、保存件数 |
| `src/model/normalize.ts` | `normalizeSession(raw, directoryId)` | unknown入力の限定投影・対象判定 |
| `src/model/time.ts` | `parseIsoTimestamp(...)` | 許容日時形式の検証 |
| `src/model/dashboard.ts` | 型定義 | 完全Snapshot契約 |
| `src/aggregate.ts` | `buildDashboard(inputs, nowMs)` | 窓、件数、順序、capacity |
| `src/render/width.ts` | 幅計測・安全表示関数 | 制御文字処理、grapheme単位省略 |
| `src/render/text.ts` | `renderText(snapshot, viewport?)` | 共通テキスト |
| `src/render/json.ts` | `serializeJson(snapshot)` | 値を保持する安全なJSON出力 |
| `src/tui.ts` | `runTui(deps, intervalMs)` | 端末、poll、resize、終了 |

`aggregate` とモデル層は `node:fs` をimportしません。I/O側からはraw全文ではなく、必要な値だけを投影して渡します。

現在のSnapshotをresize用にメモリへ保持することは許可します。これは描画状態であり、履歴保存やlast-goodデータキャッシュではありません。

---

## 5.2 入力schemaと未知値

### 共通規則

入力は最初に `unknown` として受け、無条件の `as OracleMetadata` は禁止します。

- JSONのrootは配列・null以外のobjectを要求します。
- `options`、`browser`、`config`、`runtime` などもobjectとして検査します。
- 未知キーは無視します。未知キーがあるだけでは警告しません。
- `__proto__` 等を含む入力を設定オブジェクトへspread／mergeしません。own propertyの許可項目だけを読みます。
- 表示・集約用文字列は外側空白だけtrimします。case、alias、内部文字列は変更しません。
- 不正な任意フィールドは、そのフィールドのfallbackを試し、他の正常な値まで破棄しません。

**入力schemaは前方互換、出力schemaは閉じた契約**とします。

### modeとproviderの判定順

1. `meta.mode` と `options.mode` の両方に既知の値があり、`api`／`browser` が矛盾している場合は除外し、`MODE_CONFLICT` を出します。
2. それ以外は `meta.mode` を優先し、欠損・null・空文字なら `options.mode` を使用します。
3. 採用値が `api` なら通常の対象外です。
4. 採用値が `browser` でなければ除外し、`MODE_UNRESOLVED` を出します。未知文字列をbrowserへ変換しません。
5. browserの場合だけproviderを判定します。

provider判定は次のとおりです。

| 入力 | 判定 |
|---|---|
| `meta.model` または `options.model` がGeminiを明示 | Geminiとして除外します。 |
| 保存URLが `https://gemini.google.com/...` を明示 | Geminiとして除外します。 |
| Gemini根拠とChatGPT根拠が同居 | 除外し、`PROVIDER_CONFLICT` を出します。 |
| 選択されたmodelがcase-insensitiveで `gpt-` 始まり | ChatGPTの肯定根拠とします。 |
| 未知model／model欠損だが、許可した保存URLのhostnameが `chatgpt.com` または `chat.openai.com` | 対象にします。未知の保存名は維持し、欠損なら `unknown` です。 |
| 肯定根拠がないbrowserセッション | 除外し、`PROVIDER_UNRESOLVED` を出します。 |

Geminiのmodel判定では、`gemini...` およびprovider-qualified名の最後の `/` 区切り成分が `gemini...` のものを除外します。分類時だけcase-insensitiveにし、集約キーは書き換えません。

URL根拠の読取対象は、以下に限定します。

```text
browser.runtime.tabUrl
browser.config.url
browser.config.chatgptUrl
options.browserConfig.url
options.browserConfig.chatgptUrl
```

文字列の部分一致ではなく `URL` とhostnameの完全一致を使います。URLへアクセスはしません。

### status、ID、表示値

未知statusは `STATUS_UNRECOGNIZED` とし、current／reliabilityには入りません。ただし、対象providerで送信trueなら、送信数には初回分を加えます。新しい独自statusへ変換しません。

保存ディレクトリ名をレコードの識別単位にします。`meta.id` がディレクトリ名と不一致ならディレクトリ名を採用し、`ID_MISMATCH` を出します。metadataのIDをファイルパスの構築には使用しません。

表示値の優先順位は次です。

| 値 | 解決規則 |
|---|---|
| slug | 非空 `options.slug` → 採用id |
| project | 有効な絶対 `cwd` の末尾名 → `unknown` |
| model | 非空 `meta.model` → 非空 `options.model` → `unknown` |
| effort | 非空 `browser.thinkingSelection.requestedLevel` → 非空 `options.browserConfig.thinkingTime` → `unknown` |

ここで表示するmodel／effortはrequested値です。UI上の実使用値やアカウント側の消費値として扱いません。この区別はOracle根拠資料にも明記されています。

---

## 5.3 home、profile、capacity

### パス解決

| 対象 | 優先順位 |
|---|---|
| Oracle home | 非空 `ORACLE_HOME_DIR` → `os.homedir()/.oracle` |
| 選択profile | 非空 `ORACLE_BROWSER_PROFILE_DIR` → user configの `browser.manualLoginProfileDir` → `os.homedir()/.oracle/browser-profile` |
| user config | 解決済みhomeの `config.json` |

**homeを変更しても、profileの既定値は移動しません。** これはCodexのOracle観察資料が示す境界です。

環境変数とuser configの相対パスは、oracle-top起動時のcwd基準で絶対化します。`~` や `$VAR` の独自展開はしません。NUL等を含む環境変数のパス指定はusage errorにし、黙って別のhome/profileを監視しません。

設定ファイルは各pollで読み直します。環境変数、起動cwd、OS homeは起動時に取得した値を使います。

JSON5はコメント・末尾カンマのほか、`Infinity` や `NaN` も構文上許容するため、解析成功と値の妥当性を分けます。maxには正のsafe integerだけを許可します。

### セッションとprofileの対応

セッションの保存profileは、以下の順で採用します。

```text
options.browserConfig.manualLoginProfileDir
browser.config.manualLoginProfileDir
```

両方が有効で異なる場合は先頭を採用し、`PROFILE_CONFLICT` を出します。相対パスは、そのセッションの有効な絶対cwd基準です。cwd不明ならprofileも不明です。

両方欠損なら `PROFILE_UNRESOLVED` とし、**選択profileへの帰属を推定しません**。この警告はcapacity候補になり得るcurrent sessionに対して出します。

比較は、選択rootの正規化した論理パスと、既に解決したrealpathとの一致で行います。metadataに書かれた未知のprofileパスを探索したり、他profileの台帳を読んだりしません。

異なるprofileのcurrent sessionも現在一覧・集計には残しますが、そのmaxは採用せず、`PROFILE_DIFFERENT` を出します。

### maximumの選択

同profileと確認できたcurrent sessionについて、次を候補にします。

```text
options.browserConfig.maxConcurrentTabs
browser.config.maxConcurrentTabs
```

各値はnumber型の正のsafe integerを要求します。数値文字列をcoerceしません。両保存箇所で有効値が異なる場合は先頭を採用し、`CAPACITY_CONFLICT` を出します。

複数セッションの候補間では、次の順です。

```text
有効かつ未来でない開始基準時刻の新しい順
→ 時刻不明は末尾
→ 同時刻はidのコード単位昇順
```

異なるmaxが併存した場合も `CAPACITY_CONFLICT` を出します。候補がなければ、正整数env → 有効user config → 3です。

この優先順位は**合意したmonitor用の参照規則**であり、Oracleの全設定解決を完全再現したものではありません。根拠資料でもこの差が指摘されています。

### 台帳の扱い

有効な入力は次です。

```text
root object
version === 1
leases は配列
各要素はnull・配列ではないobject
```

各leaseのPIDや時刻までは検証しません。重複やstaleらしい値を含んでも件数をそのまま数えます。

| 台帳の状態 | `active` |
|---|---:|
| 有効な空配列 | `0` |
| 初回確認時点で台帳／profileが存在しない | `0`＋`FILE_MISSING` |
| 壊れたJSON、不正v1構造、権限不足 | `null`＋警告 |
| 読込中の置換・変更を検出 | `null`＋`FILE_CHANGED` |

台帳欠損の0は「保存leaseがない」という意味であり、実ブラウザの稼働0を証明しません。

---

## 5.4 日時と集計

### 許容日時

入力日時は、次の形式に限定します。

```text
YYYY-MM-DDTHH:mm:ss[.1〜3桁](Z または ±HH:mm)
```

年は0001〜9999、実在する年月日、通常の時分秒を要求します。timezoneなし、日付だけ、数値epoch、24時表記、閏秒表記は不正とします。offsetは時00〜23・分00〜59を許容します。

`Date.parse` の成功だけに依存せず、2月30日などの暦上の不正を拒否します。内部は整数epoch millisecondsです。

### 基準時刻とfallback

| 用途 | 優先順位 |
|---|---|
| elapsed、送信窓 | `startedAt` → `createdAt` |
| reliability窓 | `completedAt` → `createdAt` |

欠損・null・空文字は次候補へ進みます。不正値は `TIME_INVALID` を出して次候補へ進みます。

**構文・暦上有効な未来日時は、不正値fallbackの対象ではありません。** 当該集計から除外し、currentのelapsedは `null` にします。`TIME_FUTURE` を出します。

基準時刻を解決できなければ、currentには `elapsedMs:null` で残し、当該集計から除外して `TIME_UNAVAILABLE` を出します。

### 窓

採取開始時にwall clockの `nowMs` を一度だけ取得します。

```text
24H = [nowMs - 86_400_000, nowMs]
7D  = [nowMs - 604_800_000, nowMs]
```

両端を含みます。表示timezoneによって窓を変更しません。

### 送信・follow-up

初回は厳密なboolean trueだけです。`"true"`、`1`、欠損をtrue扱いしません。

保存位置は `options.browserFollowUps` です（Oracle根拠資料と会話基準に記録済み）。**すべての要素がtrim後非空のstringである配列**を有効とします。root直下の同名キーは読みません。

| 入力 | 初回true時の加算 |
|---|---:|
| 欠損、または `[]` | 1 |
| completed＋有効配列長2 | 3 |
| completed以外＋有効配列長2 | 1 |
| null、配列以外、非string要素、空文字要素を含む | 1＋`FOLLOWUPS_INVALID` |
| 初回がtrueでない | 0 |

配列の有効要素だけを部分的に数えたり、重複promptを除いたりしません。

terminal sessionで `promptSubmitted` が欠損・nullなら、送信の証拠を得られないため加算せず `SUBMISSION_UNRECORDED` を出します。pending/runningの未記録は準備中でも起こり得るため、それだけでは警告しません。

同一実行内のfollow-upは、すべて初回の開始基準時刻へ計上します。別セッションとして作られたCLI `--followup` は別件です。途中follow-upの過小計上、送信時刻代理、削除済み履歴の欠落は許容する制約であり、ログ解析で補いません。

### 固定順

```text
model:
gpt-6-astra
gpt-5.6-sol
その他をUTF-16コード単位昇順

effort:
pro
heavy
extra-high
extended
high
standard
light
unknown
その他をUTF-16コード単位昇順
```

`high` の位置は表示順の決定であり、OpenAI側の能力・計算量の序列を主張するものではありません。`High` と `high` も勝手に統合しません。

---

## 5.5 完全なJSON出力型

以下を `src/model/dashboard.ts` と `dashboard.schema.json` の共通契約にします。

```ts
export type MaximumSource =
  | "session"
  | "environment"
  | "user-config"
  | "default";

export interface BrowserCapacity {
  active: number | null;
  maximum: number;
  utilization: number | null;
  maximumSource: MaximumSource;
}

export interface CurrentSessionRow {
  id: string;
  status: "pending" | "running";
  elapsedMs: number | null;
  project: string;
  slug: string;
  model: string;
  effort: string;
}

export interface Reliability24h {
  completed: number;
  partial: number;
  error: number;
  cancelled: number;
  evaluated: number;
  successRate: number | null;
}

export interface SubmittedMessageRow {
  model: string;
  effort: string;
  submitted24h: number;
  submitted7d: number;
}

export type DataWarningCode =
  | "SESSIONS_MISSING"
  | "SESSIONS_UNREADABLE"
  | "FILE_MISSING"
  | "FILE_UNREADABLE"
  | "FILE_TOO_LARGE"
  | "FILE_NOT_REGULAR"
  | "FILE_CHANGED"
  | "SYMLINK_SKIPPED"
  | "INVALID_ENCODING"
  | "INVALID_JSON"
  | "INVALID_JSON5"
  | "INVALID_ROOT"
  | "INVALID_FIELD"
  | "MODE_UNRESOLVED"
  | "MODE_CONFLICT"
  | "PROVIDER_UNRESOLVED"
  | "PROVIDER_CONFLICT"
  | "STATUS_UNRECOGNIZED"
  | "ID_MISMATCH"
  | "TIME_INVALID"
  | "TIME_FUTURE"
  | "TIME_UNAVAILABLE"
  | "FOLLOWUPS_INVALID"
  | "SUBMISSION_UNRECORDED"
  | "PROFILE_UNRESOLVED"
  | "PROFILE_DIFFERENT"
  | "PROFILE_CONFLICT"
  | "CAPACITY_CONFLICT"
  | "LEASES_INVALID"
  | "DISPLAY_SANITIZED";

export type DataWarning =
  | {
      code: DataWarningCode;
      source: "session";
      sessionId: string;
    }
  | {
      code: DataWarningCode;
      source: "sessions" | "config" | "leases";
    };

export interface DashboardSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  browserCapacity: BrowserCapacity;
  currentSessions: CurrentSessionRow[] | null;
  reliability24h: Reliability24h | null;
  submittedMessages: SubmittedMessageRow[] | null;
  dataWarnings: DataWarning[];
}
```

### 数値とnullの契約

件数・elapsedは非負safe integer、maximumは正のsafe integerです。`NaN`／Infinityは出力しません。

`generatedAt` は採取開始時刻のUTC表記 `YYYY-MM-DDTHH:mm:ss.sssZ` です。

| 状況 | 出力 |
|---|---|
| sessionsを正常に列挙でき、対象なし | current／submittedは `[]`、reliability件数は0 |
| sessions root欠損・読取不能・拒否したsymlink | current／reliability／submittedの3領域はすべて `null` |
| 一部metadataが壊れている | 読めたレコードで計算した値＋全警告 |
| evaluated=0 | `successRate:null` |
| active不明 | `utilization:null` |

一部欠落時の成功率は「読めたレコード内の成功率」であり、全件の成功率の下限ではありません。TUI／単発テキストでは警告とともに `Values from readable records only` と表示します。

警告0件も、Oracle retention等で削除された履歴がないことまでは保証しません。

### Schemaへ反映する規則

既存Schemaは件数の基本型等を定義していますが、警告codeが任意文字列で、elapsedの非負整数制約などが不足しています。

正式Schemaは次を満たすものにします。

- Draft 2020-12を維持し、すべてのobjectで `additionalProperties:false`。
- 上記interfaceの全propertyをrequiredにします。warningの `sessionId` だけはunionに従います。
- 件数の上限は `9007199254740991`、最小値は0。maximumの最小値は1。
- elapsedは `integer | null`、最小値0。
- utilizationは `number | null`、最小値0。**上限1を設けません。**
- successRateは `number | null`、0〜1。
- `submitted7d` は行が存在する場合1以上。
- 文字列は非空。model／effortはenumにしません。
- warning codeは上記30種類のenum。
- `source:"session"` のwarningだけ `sessionId` を必須にします。
- セッション関連3領域は、全nullか、すべて通常型のどちらかとします。
- `evaluated=0 ⇒ successRate=null`、`active=null ⇒ utilization=null` を条件式で検査します。

以下はSchemaだけでなく、公開集計関数の不変条件として検査します。

```text
evaluated = completed + partial + error
successRate = completed / evaluated        （evaluated > 0）
utilization = active / maximum             （active != null）
submitted24h <= submitted7d
(model, effort) は各行で一意
current id は各行で一意
配列は所定の順序
```

Schema検証にはdev依存としてAjvを1つ追加します。**公開JSON契約と例のドリフトを実際のvalidatorで検出するため**です。runtimeには含めません。Draft 2020-12対応クラスとstrict modeを使い、日時formatは本仕様の検証関数を登録するため、`ajv-formats` は追加しません。

### 警告の粒度

警告は「ファイル／レコード＋code」単位です。重複排除キーは次です。

```text
(source, code, sessionId ?? "")
```

並び順も上記のコード単位昇順です。任意の例外文、stack、prompt、URL全文、フルパスをwarningへ入れません。

JSON解析失敗の1件から、さらにmode欠損・日時欠損等の派生警告を増殖させません。解析できなかった段階で当該レコードを隔離します。

---

## 5.6 安全な直接read

### 読取手順

`meta.json`、config、台帳はすべて以下の同じ境界を使用します。

1. 設定されたhome/profile rootを解決します。指定root自体のsymlinkはrealpathで解決して使用できます。
2. root配下の `sessions`、個別session directory、対象fileのsymlinkは拒否します。
3. 最終fileをread-onlyでopenします。macOSでは `O_RDONLY | O_NOFOLLOW | O_NONBLOCK` を使用します。
4. `fstat` で通常fileかつsize≤1,048,576 bytesを確認します。
5. 最大1,048,577 bytesまでのbounded readとし、上限超を検出します。1ファイルにつき最大1MiBまでしか採用しません。
6. UTF-8をfatal decodeし、不正encodingを隔離します。
7. file／親directoryのidentityとfileのsize・mtime・ctimeを再確認し、変更を検出したら採用しません。
8. `finally` でhandleを閉じます。

`O_NOFOLLOW` はsymlinkを指すopenを失敗させるためのフラグです。通常file検査と併用し、FIFO等を誤って読み続けない設計にします。

UTF-8は `TextDecoder` のfatal設定を使用できます。デコードエラーを文字置換で黙って通すのではなく、当該ファイルの失敗として扱います。

### 更新・消失

同一tick内の再試行待ちやlast-good fallbackは作りません。

- 初回からmetadataがない：`FILE_MISSING`。
- 読取中の消失／差替えを検出：`FILE_CHANGED`。
- JSON不正：`INVALID_JSON`。
- configのJSON5不正：`INVALID_JSON5`。
- 次の通常pollで自然に再読込します。

ファイル群の全体原子性は保証しません。`generatedAt` は一度だけ取得した基準時刻であって、全ファイルが同時点の状態であることの保証ではありません。

### セキュリティ境界の限界

これは利用者管理下のローカルファイルを対象にした防御です。**同一UIDの攻撃者が親ディレクトリを並行差替えする状況まで、Nodeのpath-based APIだけで完全に封じたとは主張しません。**

静的symlink拒否、最終componentのno-follow、identity再検査で通常の誤読を防ぎます。より強いOS固有のsandboxやnative openat実装はMVPに追加しません。

### 制御文字

集約キーはtrim後の保存文字列です。無害化によって別のmodelを同じキーに統合しません。

テキストではC0／C1／DEL、CR／LF／TAB、Unicode改行文字、bidi制御文字を空白へ置換します。これで表示が変わったレコードには `DISPLAY_SANITIZED` を出します。

JSONでは `JSON.stringify` に加え、C1／DEL／bidi制御文字等を `\uXXXX` 表記へ変換します。**JSON.parse後の文字列値は維持し、出力ストリームに生の制御文字を残さない**方式です。

---

## 5.7 TUIと単発表示

### 基本画面

以下は合成fixtureを用いた表示イメージです。`SESSION / SLUG` は一列です。

```text
ORACLE TOP   2026-09-30 15:00:00 GMT+9   refresh 2s
Browser slots (stored): 2 / 3  66.7%     Current sessions: 2

CURRENT SESSIONS
STATUS   ELAPSED   PROJECT       SESSION / SLUG         MODEL          EFFORT
running  00:02:00  sample-app    review-current-change  gpt-6-astra    pro
running  00:15:00  sample-tools  review-cli-contract    gpt-5.6-sol    high

RELIABILITY — ROLLING 24 HOURS
completed 24   partial 2   error 4   cancelled 1   evaluated 30
success 80.0%

SUBMITTED MESSAGES BY MODEL / EFFORT
MODEL          EFFORT      24H    7D
gpt-6-astra    pro          24    74
gpt-5.6-sol    pro         118   632
gpt-5.6-sol    high          3    18

Oracle-only submission-operation counts; direct ChatGPT usage is excluded.
Requested model/effort. Slots: selected profile; sessions: selected home.
```

表示clockはOSのlocal timezoneとoffsetを使用します。集計とJSONはUTCです。

### 幅

表示幅はgraphemeを壊さずセル数で計測します。

- 現在一覧の保護列：STATUS、ELAPSED、MODEL、EFFORT。
- 送信表の保護列：MODEL、EFFORT、24H、7D。
- project／slugを先に縮めます。両列の最小幅は1セルです。
- 狭い場合は当該列の見出しも省略できますが、列そのものは消しません。
- model／effortの名前を黙って切り詰めません。
- 比率の棒は装飾なので、数値を守るため非表示にできます。

必要最小幅は、**全Snapshotの保護列の最大幅、区切り、project／slug各1セル**から求めます。物理端末幅の下限は80列です。自動折返し防止のため最後の1列を予約します。

```text
requiredColumns = max(80, 必要な描画幅 + 1)
```

収まらなければ通常画面を出さず、次を表示します。

```text
Terminal too narrow: need N columns. Use oracle-top snapshot.
```

メッセージ自体が収まらない極小幅では `!` を表示し、通常ダッシュボードは描きません。最後の1列を予約した後の利用可能列は `max(0, columns - 1)` です。幅0または1では本文を出力せずresizeを待ち、幅2以上の極小幅で `!` を表示します。これは最後の1列を使わない規則から導く境界です。

### 高さ

最後の1行を予約し、残りを使用します。

固定領域を先に組み立て、その実際の行数を `F` とします。固定領域には、見出し、reliability全値、注記、最大2行のwarning要約を含めます。

残りのbody行をcurrent表とusage表へ半分ずつ配分し、奇数余りはcurrentへ渡します。片方の余りはもう片方へ渡します。

表の割当てが `B` 行で対象が `N>B` 件なら、次のようにします。

```text
表示データ行 = max(0, B - 1)
最終行       = "... 残件数 more; use oracle-top snapshot"
```

空表にも `No current sessions` 等の1行を使います。固定領域＋両表各1行すら収まらない高さでは、通常画面を出さずサイズ不足を明示します。

予約後の利用可能行が0となる高さ0または1では、サイズ不足メッセージも本文として出力せずresizeを待ちます。最後の1行を予約し、画面の折返し・スクロールを防ぐ規則を維持します。

**TUIの省略はSnapshotを書き換えません。** 単発テキスト／JSONは全件を返します。単発テキストは行幅制限もしません。

---

## 5.8 CLI、poll、終了

### CLI

`--help`／`-h`、`--version`／`-V` は診断用として認めます。それ以外のコマンド・組合せは明示されたものに限定します。

TUIへの `--json`、snapshotへの `--interval`、未知引数、重複指定はexit 2です。

TUIにはstdinとstdoutの両方がTTYであることを要求します。`TERM=dumb` もTUI不可とし、stderrでsnapshotを案内します。stdoutへbanner等を出してから失敗しません。

### poll

```text
初回は即時
次回は単調時計による開始基準＋intervalのグリッド上
採取＋描画完了後より後の最初のtickを選ぶ
missed tickは捨てる
```

interval=2秒で最初の処理が5秒かかった場合、次回は6秒です。5秒時点で追いつき実行しません。

resizeは最新Snapshotの再描画だけです。連続resizeは最後のサイズへまとめ、採取や描画の並行起動をしません。

stdoutのwriteがfalseを返した場合はdrainを待ちます。無制限にframeをbufferしません。これはNodeのWritable契約に従うものです。

### 終了・復元

raw modeではCtrl-CがSIGINTとして発生しないため、入力のETX、すなわち `\u0003` も扱います。

終了は冪等な一つの経路へ集約します。

```text
停止フラグ
→ 次tick停止
→ Abort要求
→ 自分のlistener解除
→ raw modeを保存値へ戻す
→ cursor表示・SGR reset・alternate screen解除
→ 遅れて返った採取結果を破棄
```

一つの復元処理が失敗しても、残りを試みます。通常終了でstdioを強制破棄しません。

AbortはOSの進行中readまで即座に中止する保証ではありません。したがって「採取終了を待たず復元開始」と「すべてのOS readが即時完了」を分けます。

| 終了理由 | exit code |
|---|---:|
| 正常snapshot、q | 0 |
| データ警告を含む有効snapshot | 0 |
| stdoutのEPIPE | 0 |
| usage error、TUI非TTY | 2 |
| 内部例外、EPIPE以外の出力障害、復元失敗 | 1 |
| Ctrl-C／SIGINT | 130 |
| SIGTERM | 143 |

signal終了時はsignalのcodeを維持します。EPIPE後に同じstdoutへ復元文字列を再送しません。raw mode等のローカル復元は試みます。SIGKILLや端末そのものの切断に対して、画面復元完了は保証しません。

---

## 5.9 依存と性能

runtime直接依存は、**`json5` と `string-width` の2つ**にします。grapheme処理は `Intl.Segmenter`、CLI解析とANSI制御は小さな明示実装です。

dev依存はTypeScript、Node 24用型定義、Vitest、Prettier、前述のAjvです。CLI parser、日付ライブラリ、色ライブラリ、TUI frameworkは追加しません。

Nodeの基準は既存.node-versionの24.14.0です。2026-09-30にnpm registryのversion/enginesを照会し、採用する依存版を以下に固定しました。P02で実インストール、Node 24互換性、コンパイルを確認してlockfileへ固定します。仕様作成時には製品依存のインストールや互換テストは実施していません。

性能の受け入れ条件は、通常のローカルSSD上、Node 24、合成metadata 1,000件・各16KiB以下、2秒間隔、60秒です。

```text
平均CPU     1コア換算で5%以下
peak RSS    150MiB以下
採取p95     500ms以下
同時scan    1
同時read    最大8
```

初回採取時間も別に記録します。測定には採取・投影・集計・描画を含め、fixture生成とnpm処理は含めません。

予算超過を理由の記録だけでpassにしてはいけません。余分な全文保持、無制限Promise、二重走査等を修正し、キャッシュや履歴DBへ逃げず再測定します。

---

## 一次資料の照合

JSON5のコメント・末尾カンマ・非有限数の構文は[JSON5公式](https://json5.org/)を確認しました。最終ファイルのno-followとread-onlyフラグは[Node 24 fs公式](https://nodejs.org/docs/latest-v24.x/api/fs.html)を確認しました。Draft 2020-12では専用クラスを使うことを[Ajv公式](https://ajv.js.org/json-schema.html)で確認しました。これは将来の実装で検証する設計契約であり、製品動作検証の結果ではありません。

## 依存版の固定と実装時の確認

| 種別 | パッケージ | 採用版 |
| --- | --- | --- |
| runtime | json5 | 2.2.3 |
| runtime | string-width | 8.3.0 |
| dev | typescript | 7.0.2 |
| dev | @types/node | 24.19.0 |
| dev | vitest | 5.0.2 |
| dev | prettier | 3.9.9 |
| dev | ajv | 8.20.0 |

registryの存在とengine宣言の確認は、実際のビルド成功を意味しません。P02で互換性が成立しなければ、エラーと理由を報告し、同じ公開契約を保つ最小の版調整を記録してから進めます。黙って依存やフレームワークを増やしません。

## 警告生成と型不正の補足

modeの不正な型はINVALID_FIELDを出してoptions.modeのfallbackを試します。非空の未知mode文字列はfallbackせずMODE_UNRESOLVEDです。その他の任意フィールドも型不正は警告して指定順のfallbackを試します。両方のprofileやmaxが有効で異なる場合だけCONFLICTを出し、無効な候補は採用しません。

DISPLAY_SANITIZEDは投影段階で、将来のtext表示で変わる文字列を検知してSnapshotへ加えます。JSON出力でも同じ警告集合を保持します。表示で文字が同じになっても、異なる保存model/effortを統合しません。

aggregate/modelはfsをimportしない純粋な境界です。collectInputsは解決済み設定、読み取れた限定投影レコードまたはnull、台帳件数またはnull、警告を返します。buildDashboardはその入力と一度取得したnowMsだけで完全Snapshotを返します。rendererはSnapshotを変更しません。I/Oとterminal/timerは注入できる小さなadapterにし、汎用フレームワークは作りません。
