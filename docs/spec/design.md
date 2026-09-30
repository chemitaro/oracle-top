# Oracle Top 設計書

状態: draft（同一会話でのStrict相談未完了）。要件定義書のR-IDを実装契約へ落とす。

## 1. 構成と責務

`config` → `collectInputs` → `normalizeSession` → `buildDashboard` → `renderText / JSON.stringify`。
TUIはこのパイプラインを2秒周期で呼び出すライフサイクルだけを担当する。集計やOracle状態の補正を描画側へ置かない。
依存方向はCLI/TUIから下へ一方向。domain/aggregateはnode:fsをimportしない。

| モジュール | 公開境界 | 責務 |
| --- | --- | --- |
| config.ts | resolveMonitorConfig(env, home, cwd, configProjection) | pathと周期、設定の優先順位 |
| io/json-reader.ts | readJsonFile(path, limit, signal) | 読込専用、size/errorの分類 |
| io/sessions.ts | collectSessions(root, signal) | directory列挙とmeta読込、最大8並行 |
| io/leases.ts | collectLeases(profile, signal) | version1/配列の解釈 |
| model/normalize.ts | normalizeSession(raw, directoryId) | unknownから限定型への投影 |
| aggregate.ts | buildDashboard(inputs, nowMs) | 日時窓、件数、sort、上限 |
| render/text.ts | renderText(snapshot, viewport?) | ANSIなしの共通テキスト |
| tui.ts | runTui(deps, intervalMs) | alternate screen、raw input、timer、cleanup |
| cli.ts | main(argv, deps) | option検査、入出力、終了コード |

JSON5とstring-widthをruntime依存、TypeScriptとテストランナーをdev依存とする。CLI parsingは小さな明示実装、ANSI生成は固定文字列。Oracle/Chrome SDK、react/ink、SQLiteは不要。
Node 24でIntl.Segmenterを使い、grapheme単位の省略をする。string-widthで表示セル数を測る。

## 2. Snapshot契約

```ts
interface DashboardSnapshot {
  schemaVersion: 1;
  generatedAt: string; // UTC ISO、one now captured at collection start
  browserCapacity: {
    active: number | null;
    maximum: number;
    utilization: number | null;
    maximumSource: "session" | "environment" | "user-config" | "default";
  };
  currentSessions: CurrentSessionRow[];
  reliability24h: {
    completed: number;
    partial: number;
    error: number;
    cancelled: number;
    evaluated: number;
    successRate: number | null;
  };
  submittedMessages: {
    model: string;
    effort: string;
    submitted24h: number;
    submitted7d: number;
  }[];
  dataWarnings: DataWarning[];
}
interface CurrentSessionRow {
  id: string;
  status: "pending" | "running";
  elapsedMs: number | null;
  project: string;
  slug: string;
  model: string;
  effort: string;
}
interface DataWarning {
  code: string; // 設計の固定警告コード
  source: "sessions" | "session" | "config" | "leases";
  sessionId?: string;
}
```

full path、profile名、prompt、cookie、stack、任意errorMessageはJSONへ出さない。warningはsourceとsessionIdから対象を識別する。
dataWarningsは常に配列。dedupキーはcode/source/sessionId。sortはsource/code/sessionIdのコード単位順。実装ごとの自由な警告文章を機械契約にしない。
schemaはdocs/spec/dashboard.schema.jsonとして一緒に管理する。

## 3. 設定

homeは非空ORACLE_HOME_DIR、なければos.homedir()/.oracle。relative値は起動cwd基準で絶対化。空envは未指定。
profileは非空ORACLE_BROWSER_PROFILE_DIR、ユーザー設定browser.manualLoginProfileDir、os.homedir()/.oracle/browser-profileの順。homeを変えてもprofile defaultは動かさない。
観測対象は一profile。セッション一覧と利用数は選択home内のChatGPT実行全体であることを説明する。
configはhome/config.jsonをJSON5として読む。allowlistはbrowser.manualLoginProfileDir / browser.maxConcurrentTabsのみ。project configは探索せず、秘密を含む他項目を保持しない。
rootがsymlinkであれば利用者の明示的なルート指定としてrealpathで解決可。配下session directoryとmeta/config/leaseのsymlinkは読まない。

intervalはASCII正整数+ms/s/mだけ、1000ms..60000ms、既定2000ms。小数、0、負、重複、単位なしはusage error。snapshotのintervalはusage error。

## 4. 入力検査と分類

modeはmeta.mode、なければoptions.mode。browser以外は除外。明示api優先でbrowser残骸から救済しない。
Geminiは選んだmodelまたはoptions.modelがcase-insensitiveでgemini先頭なら除外。
ChatGPTの肯定根拠はgpt-モデル、または保存URLのhostnameがchatgpt.comであること。model欠損・別ラベルでもURL根拠があればunknown/保存ラベルで対象にできる。
不明のbrowser providerは除外してwarning。unknown statusは現在/信頼性には入れず、対象providerかつ送信trueなら送信回数には数える。unknown statusを独自statusへ変換しない。この具体化も正式相談で精査する。
optionsなどnested objectはplain JSON objectのみ。配列/nullをobjectとしてアクセスしない。
非空文字列の外側空白をtrimする。model/effortのcaseやaliasは変えない。空は次fallback。
idはmeta.idが安全なnonemptyでdirectoryと一致するとき採用、なければdirectoryId。相違はdirectoryIdを採用しwarning。レコードはdirectoryごとに一度処理する。

日時はtimezone付ISO8601 stringで有効な実日付、epochへ投影する。欠損／invalidは次fallback。未来値は集計から除外、current elapsedは0にclampしwarning。両方ない時はcurrent null、集計除外。
集計窓は[ now - duration, now ]のinclusive。timezone表示と窓計算を混ぜない。

## 5. capacity

選択profileと一致するcurrent sessionの正のsafe整数maxを候補にする。profile候補はoptions.browserConfig.manualLoginProfileDir、browser.config.manualLoginProfileDir、monitor profileとする。
候補の最新開始時刻（startedAt→createdAt）を優先し、同時刻はid昇順。時刻不明は末尾。異なる値が複数あればCAPACITY_CONFLICT warning。
候補がなければ正整数env、positive safe整数user-config、3。不正な候補は警告して次へ進む。
台帳欠損0。不正version/非配列/配列要素がnonobject/IO失敗はactive=null。leaseは保存件数をそのまま数え、staleやpid判定しない。
比率nullはN/A。active>maximumでも100%超をそのまま文字表示し、棒だけclamp。

## 6. 読取方式

fs.readdir({withFileTypes:true})で直下通常directoryのみ。各meta.jsonをread-only openし、fstatで通常fileかつ≤1,048,576 bytesを確認。さらにlimit+1以内しか読まない。8並行で処理、終了signalを確認。
config/leasesも同じ1MiB上限。Oracle状態の一時ファイル、log、models、Chrome profileの他ファイルへ入らない。
read中ENOENTはskipしてFILE_DISAPPEARED warning。JSON parse失敗はそのtickでskip、次tickで自然再試行。独自リトライ待機、last-good cacheは設けない。
sessions root ENOENTは空+SESSIONS_MISSING。EACCES等root全体失敗は空+SESSIONS_UNREADABLE。statsは読めたレコードによる下限集計となるため警告を必ず表示。
warnによるデータ欠落はsnapshot exit0（有効JSONを返す）。usage exit2、fatalな内部例外exit1、SIGINTは130、SIGTERMは143、qは0、EPIPEは0。

## 7. 表示

同じrenderTextをTUI/snapshotで使用し、viewportがなければ全行・全値を出す。値はECMA48/OSC/ESC、C0/C1、CR/LF/TABを空白にし、ANSI操作文字を資料入力から出さない。JSONは保存文字列を安全なJSON escapingで出し、terminalがそれを実行しない。
TUI標準画面は120x32程度、セクションの順序固定。stdoutのcolumns/rowsを毎描画時に参照。
project/slugは最小幅0まで縮小可。保護列と区切りの必要幅を動的に計算し、80セルを下限としてmax(80,必要幅)より狭ければ「Terminal too narrow; use snapshot」を表示する。model/effortは切らない。
高さは固定ヘッダー／信頼性／footerを予約し、currentとusageへ残行を半分ずつ、奇数余りはcurrent、片方が空なら他方へ配分。省略時は各表に「… N more; use snapshot」を1行予約。
極小高さは「Terminal too small; use snapshot」。全状態はSnapshotとsnapshot出力に残る。
warningsは最大2行のcode要約と総件数、snapshot textは全warning、JSONは全配列。
画面clockはlocal timezone（macOSの設定）でtimezone略記つき。集計・JSON generatedAtはUTC。

## 8. ライフサイクルと性能

初回即時収集、その後開始時刻+intervalを目標にする。前採取が長い場合はmissed tickを飛ばし、catch-upせず次一回。各tickでnowを一度だけ採取する。resizeは最新Snapshotの描画だけで、追加scanを始めない。
alternate screen/cursor hide/raw modeを設定し、finallyで前raw状態/cursor/screenを復元する。qとsignalでAbortControllerへ通知し、timer/listenerを外し、終了後のresultは破棄する。
出力backpressureを尊重し、drain待ちで次描画を重複させない。EPIPEで追加writeなし。
性能fixture1,000件各≤16KiB、2s、60sで平均CPU≤5%（1core比）、RSS≤150MiB、採取p95≤500msを目標・受入予算とする。測定機・Node・ファイル数をreportへ残す。遅い環境は理由を記録し、勝手にキャッシュを追加しない。
