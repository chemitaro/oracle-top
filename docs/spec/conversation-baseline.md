# 会話の合意ベースライン

出典: ChatGPT「Oracle監視CLI調査」、会話ID `6abaed0b-f140-83e8-989e-6a45257cf680`。2026-09-30に全5往復を取得し、`hasMore=false`を確認。以下は最後の合意の転記であり、技術的仮定は設計相談とローカル証拠で精査する。最初の調査で提案されたCDP・SQLite・独自状態は後続のユーザー回答で除外された。

## 修正版

ご指摘を反映し、以下のように確定します。

- `success`と`failure`は同じ母集団の補数なので、**successだけ表示**します。
- `PRO ALLOWANCE PROXY`は**全面的に削除**します。
- ChatGPTの利用上限値、推定残量、消化率は表示しません。
- 表示するのは、Oracleから実際に送信したと判定できる**モデル・推論レベル別の送信回数**だけです。
- モデル別一覧は、`gpt-6-astra`を先頭、次に`gpt-5.6-sol`とします。
- 同一モデル内では推論レベルの高い順にします。
- その他のモデルは単純な文字列順とし、能力比較のような複雑な並び替えは行いません。
- ご発言の「GPT-6 Astro」は、Oracleのモデルキーに合わせて`gpt-6-astra`として整理しています。

## 最終画面

以下をMVPの単一画面とします。数値はレイアウト確認用の例です。

```text
┌─ ORACLE TOP ───────────────────────────────────────────────────────────────────────────────┐
│ 2026-09-30 14:32:08 JST    refresh 2s                                                      │
│ Browser slots  2 / 3  [█████████████───────] 66.7%     current sessions  2                │
├─ CURRENT SESSIONS ─────────────────────────────────────────────────────────────────────────┤
│ STATUS    ELAPSED   PROJECT                SESSION / SLUG              MODEL          EFFORT│
│ running   00:02:18  housing-lifecycle      settlement-domain-review   gpt-6-astra    pro   │
│ running   00:17:42  spec-dock              provider-lifecycle-review  gpt-5.6-sol    pro   │
├─ RELIABILITY — ROLLING 24 HOURS ───────────────────────────────────────────────────────────┤
│ completed  24     partial  2     error  4     cancelled  1     evaluated  30              │
│ success  80.0%  [████████████████────]                                                   │
├─ SUBMITTED MESSAGES BY MODEL / EFFORT ─────────────────────────────────────────────────────┤
│ MODEL                    EFFORT          24H       7D                                      │
│ gpt-6-astra              pro              24       74                                      │
│ gpt-5.6-sol              pro             118      632                                      │
│ gpt-5.6-sol              extra-high       17      104                                      │
│ gpt-5.6-sol              extended          3       18                                      │
│ gpt-5.6-sol              standard          5       22                                      │
├────────────────────────────────────────────────────────────────────────────────────────────┤
│ Rolling Oracle-only counts. Direct ChatGPT usage is not included.                          │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

# Codex引き継ぎ用の確定要件

## 1. 目的

`oracle-top`は、OracleのChatGPTブラウザ実行をリアルタイムに確認するための、読み取り専用CLIダッシュボードです。

一つの画面で、次を確認します。

1. 現在実行中のOracleセッション
2. 現在のブラウザスロット使用数
3. 直近24時間の成功率とステータス別件数
4. 直近24時間および7日間のモデル・推論レベル別送信回数

独自の監視状態、異常判定、履歴管理は持ちません。Oracleが保存している状態を定期的に読み直して表示します。

## 2. 対象

対象はChatGPTブラウザモードだけです。

含めるもの：

- ローカルのOracleセッション
- `pending`および`running`の現在セッション
- ChatGPTへの送信回数
- Browser lease数
- 24時間・7日間の都度集計

含めないもの：

- APIモード
- Geminiブラウザモード
- Web UI
- メニューバー
- 通知
- SQLite
- 独自ログ
- Chrome DevTools Protocolによる解析
- セッション詳細画面
- Oracleの操作
- ChatGPTプラン上限値
- 推定残量
- Oracle以外からChatGPTを利用した回数

## 3. コマンド

```bash
# 常時更新TUI
oracle-top

# 同じ内容を一度だけテキスト表示
oracle-top snapshot

# 同じ内容をJSON表示
oracle-top snapshot --json

# 更新間隔指定。既定値は2秒
oracle-top --interval 2s
```

TUIの操作は終了だけです。

```text
q
Ctrl-C
```

選択、スクロール用詳細ペイン、ページ切替は実装しません。

## 4. CURRENT SESSIONS

対象statusはOracleの値をそのまま使います。

```text
pending
running
```

表示列：

```text
STATUS
ELAPSED
PROJECT
SESSION / SLUG
MODEL
EFFORT
```

値の取得方法：

- `STATUS`: `meta.status`
- `ELAPSED`: `now - startedAt`
- `startedAt`がなければ`now - createdAt`
- `PROJECT`: `cwd`の末尾ディレクトリ名
- `SESSION / SLUG`: `options.slug`、なければsession ID
- `MODEL`: `meta.model`、なければ`options.model`
- `EFFORT`: Oracleが保存したthinking level、なければ`unknown`

並び順は、経過時間の短い順です。

```text
elapsedMs ascending
```

つまり、新しく開始されたセッションが上、長時間動いているセッションが下です。

## 5. 直近24時間の信頼性

対象status：

```text
completed
partial
error
cancelled
```

集計式：

```text
evaluated = completed + partial + error

successRate = completed / evaluated
```

`cancelled`は件数だけ表示し、成功率の分母から除外します。

表示する値：

```text
completed
partial
error
cancelled
evaluated
success
```

表示しない値：

```text
failure rate
error rate
```

期間は現在時刻から24時間前までのローリング期間です。

結果時刻は次の順で判定します。

1. `completedAt`
2. `createdAt`

## 6. ChatGPTへの送信回数

セッションの完了数ではなく、ChatGPTへの送信が行われた回数を数えます。

初回送信の判定：

```text
browser.runtime.promptSubmitted == true
```

であれば1件として数えます。

次のstatusも、送信後であれば集計に含めます。

```text
running
completed
partial
error
cancelled
```

送信前に失敗し、`promptSubmitted`が`true`でない場合は含めません。

`submittedPromptHash`は必須にしません。Oracleでは送信操作後に`promptSubmitted=true`を記録し、その後でユーザーターンのコミット確認を行うためです。 

## 7. Follow-upのカウント

1セッション内で複数のfollow-upを送信した場合は、次の単純なルールとします。

```text
follow-upなし:
  promptSubmitted == true なら1件

follow-upあり、status == completed:
  1 + options.browserFollowUps.length

follow-upあり、status != completed:
  初回送信の1件だけ
```

Oracleはfollow-upを順番に送信しますが、現状のmetadataだけでは「何件目まで送信済みか」を完全には復元できません。

そのため、途中失敗したfollow-upを過小計上する可能性は許容します。

## 8. 集計期間

モデル・推論レベル別の送信回数は、次の二つを同時に表示します。

```text
24H: 現在時刻から24時間前まで
7D:  現在時刻から7日前まで
```

Oracleには専用の`promptSubmittedAt`がないため、期間判定には次を使用します。

1. `startedAt`
2. `createdAt`

実際の送信時刻とは多少ずれる可能性がありますが、独自履歴を保存しないMVPとして許容します。

## 9. モデル・推論レベルの取得

モデル：

1. `meta.model`
2. `meta.options.model`
3. `unknown`

推論レベル：

1. `browser.thinkingSelection.requestedLevel`
2. `options.browserConfig.thinkingTime`
3. `unknown`

モデル名と推論レベルは、Oracleの保存値を原則そのまま表示します。

## 10. モデル別一覧の並び順

複雑なモデル能力評価やバージョン解析は行いません。

モデルの固定優先順位：

```text
1. gpt-6-astra
2. gpt-5.6-sol
3. その他はmodel文字列の昇順
```

同一モデル内の推論レベル：

```text
1. pro
2. heavy
3. extra-high
4. extended
5. standard
6. light
7. unknown
8. 未知の値は文字列昇順
```

これにより、重要な`gpt-6-astra / pro`を常に上へ置きながら、その他のモデルも自動的に表示できます。

利用回数順には並べません。回数が変動しても、同じモデルが毎回同じ位置に表示されるため、監視画面として視認しやすくなります。

## 11. Browser slots

現在の使用数は、`oracle-tab-leases.json`に保存されたlease数を使用します。

```text
active = leases.length
```

独自のstale判定は行いません。

最大数は次の順で解決します。

1. 現在セッションの保存済み`browserConfig.maxConcurrentTabs`
2. `ORACLE_BROWSER_MAX_CONCURRENT_TABS`
3. Oracleユーザー設定の`browser.maxConcurrentTabs`
4. Oracle既定値`3`

表示：

```text
Browser slots 2 / 3
66.7%
```

「逼迫」「正常」といった独自ラベルは付けません。

## 12. データソース

使用するもの：

```text
$ORACLE_HOME_DIR/sessions/*/meta.json
$ORACLE_BROWSER_PROFILE_DIR/oracle-tab-leases.json
```

使用しないもの：

```text
output.log
models/*.log
Chrome DevTools Protocol
外部API
独自DB
```

## 13. レンダリング

TUI、単発テキスト、JSONはすべて、同じ`DashboardSnapshot`から生成します。

```ts
interface DashboardSnapshot {
  generatedAt: string;
  browserCapacity: BrowserCapacity;
  currentSessions: CurrentSessionRow[];
  reliability24h: Reliability24h;
  submittedMessages: SubmittedMessageRow[];
  dataWarnings?: string[];
}
```

端末幅が狭い場合は、次の列を切り詰めます。

```text
PROJECT
SESSION / SLUG
```

以下は切り詰めず優先して残します。

```text
STATUS
ELAPSED
MODEL
EFFORT
24H
7D
```

## 14. 最終的な非機能要件

- 読み取り専用
- ネットワーク通信なし
- Oracleファイルを変更しない
- OracleやChromeを操作しない
- DBなし
- デーモンなし
- 低CPU使用率
- 壊れた1件の`meta.json`で画面全体を停止させない
- macOSを第一対象にする
- TypeScript／Node.jsで実装する
- 重量級TUIフレームワークは必須としない

## 15. 受け入れ条件

1. `oracle-top`が一画面を2秒ごとに更新する
2. `snapshot`と`snapshot --json`が同じ情報を出す
3. 現在セッションは`pending`と`running`だけ
4. statusを独自変換しない
5. 現在セッションは経過時間の短い順
6. 24時間の成功率だけを表示し、failure rateを表示しない
7. Pro allowance proxyを表示しない
8. 利用上限値や残量を表示しない
9. `promptSubmitted=true`を送信回数として数える
10. 24時間と7日間の送信回数を表示する
11. `gpt-6-astra`を`gpt-5.6-sol`より上に表示する
12. 同一モデルでは推論レベルの高い順にする
13. ログ、詳細、通知、操作、独自保存を実装しない
14. Oracle以外のChatGPT利用を含まない旨を画面下部に表示する
