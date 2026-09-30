# 受け入れ検証表

状態: 正式版（同一会話でのStrict相談・ローカル照合済み）。実装前のテスト契約。現時点では全て未実施。計画完成時点の文書検査と、製品実装後の動作検証を混同しない。

## 共通fixture

`now=2026-09-30T06:00:00.000Z`、homeとprofileは独立したtemp directory。選択profile=/tmp/oracle-top-profile、同profileのmax候補3を使用します。sessionの標準形:

```json
{
  "id": "sample-session",
  "createdAt": "2026-09-30T05:58:00.000Z",
  "startedAt": "2026-09-30T05:58:00.000Z",
  "status": "running",
  "mode": "browser",
  "model": "gpt-6-astra",
  "cwd": "/workspace/sample-project",
  "options": {
    "slug": "sample-session",
    "model": "gpt-6-astra",
    "browserConfig": { "thinkingTime": "pro", "maxConcurrentTabs": 3, "manualLoginProfileDir": "/tmp/oracle-top-profile" }
  },
  "browser": { "runtime": { "promptSubmitted": true, "submittedPromptHash": null } }
}
```

上記expected current.elapsedMs=120000、project=sample-project、24H=1、7D=1。lease2件ならactive=2、maximum=3、utilization=2/3。JSONの率は丸めず、textは66.7%。

## 振る舞い

| Case | R-ID | 公開境界 | 入力・期待値 | 計画 |
| --- | --- | --- | --- | --- |
| A01 | R-01,R-02,R-05 | runTui | 初回即時、2000ms tick、q exit0 | P09 |
| A02 | R-03,R-04,R-27 | built CLI | 1採取、ANSIなしtext、JSON1文書、同じ値 | P08 |
| A03 | R-06,R-11 | collector/dashboard | 8日前startedAtでrunningはcurrentに残る | P03/P06 |
| A04 | R-07 | config | comment/trailing comma付きJSON5、許可2項目以外を投影しない | P04 |
| A05 | R-08,R-22 | leases | version1/leases2件、staleでも2。欠損0、不正null | P03/P06 |
| A06 | R-09 | collector | 正常2、不正JSON1→正常2は残り警告1 | P03/P06 |
| A07 | R-10 | CLI integration | fixture hash/mtime/tree unchanged、read-only capability、禁止APIなし | P10 |
| A08 | R-11,R-12 | dashboard | pending/runningのみ、元status、全6列の値 | P05/P06 |
| A09 | R-13 | dashboard | elapsed10s/20s/null→10s,20s,null。同値はid昇順 | P06 |
| A10 | R-14,R-15 | dashboard | 24completed+2partial+4error+1cancelled→30,0.8 | P06 |
| A11 | R-15 | dashboard/text | evaluated=0→null/N/A。failureRate/errorRateなし | P06/P07 |
| A12 | R-16 | dashboard | hash=null+true→1、string true→0、false→0 | P06 |
| A13 | R-17 | dashboard | completed,true,followUps2→3、error→1、false→0 | P06 |
| A14 | R-17 | dashboard | 不正array、completed,true→1+warning | P05/P06 |
| A15 | R-18 | dashboard | 24H下限、7D下限、nowは含む。下限-1ms/now+1ms除外 | P06 |
| A16 | R-19 | dashboard | 異なるsessionが同じconversationIdでもそれぞれ1。7D0行非表示 | P06 |
| A17 | R-20 | dashboard | gpt-6-astra→gpt-5.6-sol→その他raw昇順、effort固定順 | P06 |
| A18 | R-21 | text | footerにOracle-only、直接利用除外の注記 | P07 |
| A19 | R-23,R-24 | dashboard | 同profile最新max→env→config→3。active4/max3は133.3% | P06 |
| A20 | R-25 | text | 5領域と成功率だけ、quota領域なし | P07 |
| A21 | R-26 | text | 日本語・emoji幅、project/slug優先短縮、保護列保持 | P07 |
| A22 | R-26,R-27 | text/JSON | TUI高さで省略件数、JSON/snapshotは全行 | P07/P08 |
| A23 | R-28 | text | slugにESC OSC CR LF TAB→制御列を起こさず単一行 | P07 |
| A24 | R-29 | package | Node24 ESM、npm packでbin動作、Oracle依存なし | P02/P08/P10 |
| A25 | R-30 | runTui | scan5s,interval2sでも同時1、missed tick追いかけなし | P09 |
| A26 | R-30 | perf fixture | 1,000件×16KiB、60sでCPU/RSS/p95を予算へ照合 | P10 |
| A27 | R-31 | terminal | q/SIGINT/SIGTERM/例外でraw/cursor/screen復元 | P09/P10 |
| A28 | R-32 | final check | typecheck/build/test、CLI/TUI smoke、README、R-IDの全証拠 | P10 |
| A29 | R-01,R-04 | CLI | nonTTY default→exit2、snapshot --json→exit0 | P08 |
| A30 | R-09,R-10 | reader | directory/file symlink、1MiB+1、消失を隔離、他fileを読まない | P03/P06 |
| A31 | R-14,R-18 | dashboard | created8日前、completed1時間前→信頼性には入る、usage窓外 | P06 |
| A32 | R-12,R-14,R-18 | normalizer | 時刻欠損・不正・未来は指定fallback/除外、未来または不明のcurrent.elapsedMsはnull | P05/P06 |

## 独立した期待値の例

最新セッションA=00:01:00、B=00:05:00、unknown C=nullならA,B,Cの順。
24Hを1ms外れた送信は24H0/7D1。7Dを1ms外れた送信は行を生成しない。
completed true 2followUpsを24H境界に置けば24H3/7D3。途中error true 2followUpsは1/1。
集計関数と同じ処理でexpectedを作らず、ここにあるliteralをassertする。

## 証拠

実装reportはcaseごとのpass/fail/未検証、command、exit code、主要件数、実TTY所見、性能環境、commit SHAを残す。
個人のOracle履歴はテストfixture・成果物へ混ぜない。テストにOracleやChatGPTの通信は不要。

## 境界補足と追加ケースA33〜A49

| Case | R-ID／境界 | 具体的fixtureと期待値 | 主担当 |
|---|---|---|---|
| A01・A25 | R-01／R-30 | 初回即時、2秒周期、5秒scan後は6秒開始、同時scan1 | P09 |
| A02・A29 | R-03／R-04 | 全件text／JSON、非TTYのTUIはstdout空・exit2 | P08 |
| A03・A31 | R-06／R-14 | 開始8日前のrunningはcurrentに残る。作成8日前・完了1時間前はreliability対象、usage窓外 | P06 |
| A04 | R-07 | コメント・末尾カンマJSON5を受理、無関係な設定項目を投影しない | P04 |
| A05 | R-22 | `leases=[{},{}]` は2。stale・重複も除外しない。欠損0、不正null | P06 |
| A06 | R-09 | 正常2件＋不正JSON1件→正常2件を維持、解析警告1件 | P03・P06 |
| A07・A30 | R-10 | symlink拒否、1MiB境界、対象外logを読まない、fixture不変 | P03・P10 |
| A08・A09 | R-11〜R-13 | 6列。elapsed10秒／20秒／不明→10、20、null。同値はid順 | P05〜P07 |
| A10・A11 | R-15 | 24/2/4/1→evaluated30・success0.8。分母0→null／N/A | P06 |
| A12〜A14 | R-16／R-17 | true＋hash null→1、文字列true→0、completed＋2follow-ups→3、error→1、不正配列→1＋警告 | P05・P06 |
| A15・A32 | R-18 | 24H／7D下限とnowを含む。下限−1ms、now＋1msは対象窓外。未来elapsedはnullへ修正 | P05・P06 |
| A16 | R-19 | 同conversation IDの別session2件→2送信 | P06 |
| A17 | R-20 | gpt-6-astra→gpt-5.6-sol→その他。effortにhighを追加した固定順 | P06 |
| A18・A20 | R-21／R-25 | 5領域、successのみ、quota領域なし、Oracle-only注記あり | P07 |
| A19 | R-23／R-24 | 同profile最新max→env→config→3。active4/max3→JSON 4/3、text133.3% | P06 |
| A21〜A23 | R-26／R-28 | 日本語・結合文字・emoji、幅不足、表別省略、OSC／C1／CRLFを安全化 | P07 |
| A24 | R-29 | Node24 ESM、pack後のbin起動、runtime直接依存2つ | P02・P08・P10 |
| A26〜A28 | R-30〜R-32 | 性能予算、実TTY復元、最終check・文書証拠 | P09・P10 |
| **A33** | D-01 | browser＋未知model＋正規ChatGPT URL→保存名のまま対象。URLなし→除外＋警告 | P05 |
| **A34** | D-01 | mode欠損＋gpt model→除外。browser残骸のあるapi→除外 | P05 |
| **A35** | D-01 | gpt modelとGemini根拠が同居→除外＋`PROVIDER_CONFLICT` | P05 |
| **A36** | D-01 | 未知status＋送信true→current/reliability対象外、usage初回1 | P05・P06 |
| **A37** | D-02 | home上書きでもprofile default不変。相対保存profileはsession cwd基準 | P04・P06 |
| **A38** | D-02 | 選択A、他profile Bに最新max9、Aにmax3→3。Bの台帳は読まない | P06 |
| **A39** | D-02 | 同profileの古いmax3・新しいmax2→2＋競合警告。同時刻はid順 | P06 |
| **A40** | D-02 | 保存profile不明＋max9、env4→4。所属を推測しない | P06 |
| **A41** | D-03 | `2026-02-30...` は不正、`2026-09-30T15:00:00+09:00` は固定nowと同一。0001年/0099年を1901年/1999年へ変換しない | P05 |
| **A42** | D-03 | 有効な未来startedAt＋過去createdAt→usage除外・elapsed null。createdAtへ戻らない | P06 |
| **A43** | D-04 | `["a", ""]`／`["a", 1]`／null→追加0＋警告。`["a","a"]` は長さ2 | P05・P06 |
| **A44** | D-05 | root読取不能→3領域null。正常空root→[]と0。部分破損→観測分＋警告 | P06 |
| **A45** | D-05 | Unicode C1を含むmodel→JSONに生制御文字なし、parse後のmodel値は保持 | P07 |
| **A46** | R-27 | extra property、未知warning code、負elapsed、不正null組合せをSchemaで拒否 | P07 |
| **A47** | D-06 | 必要幅未満で通常表を描かない。高さ省略後もsnapshotは全件 | P07・P08 |
| **A48** | D-06／D-07 | drain待ち中のresize・q・EPIPEで重複write／無限待機／late描画なし | P09 |
| **A49** | D-05 | 読取中変更を隔離し、次tickの正常ファイルを採用。古い結果で穴埋めしない | P03・P06 |

### 実TTYの必須検証

実TTYでは少なくとも、120×32、80×24、幅不足、高さ不足、連続resizeを確認します。終了経路はq、Ctrl-C、SIGTERM、制御された例外です。

Python標準ライブラリのPTY harness等を開発用に使用でき、製品runtime依存を増やす必要はありません。PTY検査と、macOSの実端末での画面・復元確認は両方記録します。

確認対象はraw flag、cursor、alternate screen、画面の折返し・スクロール、終了後のshell入力です。SIGKILL等の復元不能経路を正常復元の受け入れ条件に混ぜません。

### 読み取り専用の証拠

証拠は三つを組み合わせます。

| 証拠 | 確認内容 |
|---|---|
| runtime I/O能力の限定 | 注入する対象データI/Oにread系しかないこと |
| 静的検査 | 製品コードにOracle呼出し、child process、ネットワーク、対象へのwrite／rename／rm／chmod、PID probeがないこと |
| 隔離fixtureの前後比較 | file内容、tree、mtime、modeが不変であること |

fixture生成やpack等の開発作業の書込みと、製品動作の書込み禁止は分離します。ネットワーク禁止も、依存取得作業ではなく製品実行に適用します。

### 最終完了条件

最終reportには、各A-caseのpass／fail／未検証、コマンド、exit code、テスト件数、Node・OS・ハードウェア、性能値、TTY所見、実装revisionを記録します。

`check`、`typecheck`、`build`、`test`、isolated installed-CLI smoke、TTY終了／resize、安全性、性能、READMEのどれかが未検証なら、**製品実装完了にはしません**。

既存の `scripts/check-planning.py` が通ることは文書整合性の一部であり、この実装完了条件の代替にはなりません。

---
