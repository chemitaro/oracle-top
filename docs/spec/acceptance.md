# 受け入れ検証表

状態: draft（同一会話でのStrict相談未完了）。実装前のテスト契約。現時点では全て未実施。計画完成時点の文書検査と、製品実装後の動作検証を混同しない。

## 共通fixture

`now=2026-09-30T06:00:00.000Z`、homeとprofileは独立したtemp directory。sessionの標準形:

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
    "browserConfig": { "thinkingTime": "pro", "maxConcurrentTabs": 3 }
  },
  "browser": { "runtime": { "promptSubmitted": true, "submittedPromptHash": null } }
}
```

上記expected current.elapsedMs=120000、project=sample-project、24H=1、7D=1。lease2件ならactive=2、maximum=3、utilization=2/3。JSONの率は丸めず、textは66.7%。

## 振る舞い

| Case | R-ID | 公開境界 | 入力・期待値 | 計画 |
| --- | --- | --- | --- | --- |
| A01 | R-01,R-02,R-05 | runTui | 初回即時、2000ms tick、q exit0 | P08 |
| A02 | R-03,R-04,R-27 | built CLI | 1採取、ANSIなしtext、JSON1文書、同じ値 | P07 |
| A03 | R-06,R-11 | collector/dashboard | 8日前startedAtでrunningはcurrentに残る | P04/P05 |
| A04 | R-07 | config | comment/trailing comma付きJSON5、許可2項目以外を投影しない | P02 |
| A05 | R-08,R-22 | leases | version1/leases2件、staleでも2。欠損0、不正null | P04 |
| A06 | R-09 | collector | 正常2、不正JSON1→正常2は残り警告1 | P04 |
| A07 | R-10 | CLI integration | fixture hash/mtime/tree unchanged、read-only capability、禁止APIなし | P09 |
| A08 | R-11,R-12 | dashboard | pending/runningのみ、元status、全6列の値 | P03/P05 |
| A09 | R-13 | dashboard | elapsed10s/20s/null→10s,20s,null。同値はid昇順 | P05 |
| A10 | R-14,R-15 | dashboard | 24completed+2partial+4error+1cancelled→30,0.8 | P05 |
| A11 | R-15 | dashboard/text | evaluated=0→null/N/A。failureRate/errorRateなし | P05/P06 |
| A12 | R-16 | dashboard | hash=null+true→1、string true→0、false→0 | P05 |
| A13 | R-17 | dashboard | completed,true,followUps2→3、error→1、false→0 | P05 |
| A14 | R-17 | dashboard | 不正array、completed,true→1+warning | P03/P05 |
| A15 | R-18 | dashboard | 24H下限、7D下限、nowは含む。下限-1ms/now+1ms除外 | P05 |
| A16 | R-19 | dashboard | 異なるsessionが同じconversationIdでもそれぞれ1。7D0行非表示 | P05 |
| A17 | R-20 | dashboard | gpt-6-astra→gpt-5.6-sol→その他raw昇順、effort固定順 | P05 |
| A18 | R-21 | text | footerにOracle-only、直接利用除外の注記 | P06 |
| A19 | R-23,R-24 | dashboard | 同profile最新max→env→config→3。active4/max3は133.3% | P05 |
| A20 | R-25 | text | 5領域と成功率だけ、quota領域なし | P06 |
| A21 | R-26 | text | 日本語・emoji幅、project/slug優先短縮、保護列保持 | P06 |
| A22 | R-26,R-27 | text/JSON | TUI高さで省略件数、JSON/snapshotは全行 | P06/P07 |
| A23 | R-28 | text | slugにESC OSC CR LF TAB→制御列を起こさず単一行 | P06 |
| A24 | R-29 | package | Node24 ESM、npm packでbin動作、Oracle依存なし | P01/P07/P09 |
| A25 | R-30 | runTui | scan5s,interval2sでも同時1、missed tick追いかけなし | P08 |
| A26 | R-30 | perf fixture | 1,000件×16KiB、60sでCPU/RSS/p95を予算へ照合 | P09 |
| A27 | R-31 | terminal | q/SIGINT/SIGTERM/例外でraw/cursor/screen復元 | P08/P09 |
| A28 | R-32 | final check | typecheck/build/test、CLI/TUI smoke、README、R-IDの全証拠 | P09 |
| A29 | R-01,R-04 | CLI | nonTTY default→exit2、snapshot --json→exit0 | P07 |
| A30 | R-09,R-10 | reader | directory/file symlink、1MiB+1、消失を隔離、他fileを読まない | P04 |
| A31 | R-18 | dashboard | created8日前、completed1時間前→信頼性には入る、usage窓外 | P05 |
| A32 | R-12,R-14,R-18 | normalizer | 時刻欠損・不正・未来は指定fallback/除外、currentはnull/0 | P03/P05 |

## 独立した期待値の例

最新セッションA=00:01:00、B=00:05:00、unknown C=nullならA,B,Cの順。
24Hを1ms外れた送信は24H0/7D1。7Dを1ms外れた送信は行を生成しない。
completed true 2followUpsを24H境界に置けば24H3/7D3。途中error true 2followUpsは1/1。
集計関数と同じ処理でexpectedを作らず、ここにあるliteralをassertする。

## 証拠

実装reportはcaseごとのpass/fail/未検証、command、exit code、主要件数、実TTY所見、性能環境、commit SHAを残す。
個人のOracle履歴はテストfixture・成果物へ混ぜない。テストにOracleやChatGPTの通信は不要。
