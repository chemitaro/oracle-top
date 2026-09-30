# 設計相談の記録

## 取得と同期

参照「Oracle監視CLI調査」は全5往復を取得し、hasMore=falseを確認した。全文はGit管理外の.workbenchに保存し、公開リポジトリへは最後の合意だけを転記した。
初回準備コミットf14d483、相談入力コミットb2ff1f4をmainへpushした。Strict呼び出し前のlocal HEADとGitHub mainは完全SHA b2ff1f4ab8755145293485dfd1f62d0e14defec2で一致し、worktreeはcleanだった。

## 実行と結果

| 実行 | 対象会話 | 要求モデル・推論 | 結果 |
| --- | --- | --- | --- |
| oracle-top-design-plan | 指定会話の/c/URL | gpt-6-pro / pro | chat-mode-selection / conversation-unresolved、送信前error、exit1 |
| oracle-top-design-retry | ブラウザで確認した同じ会話のproject付きURL | gpt-6-pro / pro | ユーザーの再実行指示で1回実施。同じ送信前error、exit1 |
| oracle-top-design-restored | 同じproject付き会話URL、入力SHA 9bb3a1732c9e995bb173f1f1f0d6585da54f14ab | gpt-6-pro / pro、modelStrategy=select | Oracle復旧後の直接Strict実行指示で1回実施。2026-09-30 16:16 JSTに同じ送信前error、exit1 |

Oracle 0.21.3、実体CLIのリンク先、HEAD、source/build freshness、session metadata、output.logを確認した。新しいsourceはbuilt CLIより後に存在しない。両セッションはerror、promptSubmittedは未記録。設計回答は生成・取得されていない。
通常のChromeでは同じ会話の既存回答が表示できることを確認した。OracleのChat/Work判定はsidebarの信頼できるhistory要素を必要としており、今回の会話では確認できなかった。root causeを修復したとは主張しない。
新しい会話やAPIへ切り替えず、Oracle source/profile/leaseを変更しなかった。

## 手動準備と復旧後の確認

ユーザーの明示指示でchatgpt-manual-useを組み合わせ、Strict wrapperから9bb3a17に固定した入力bundleを出力した。8添付は元ファイルとバイト一致した。内蔵ブラウザはCAPTCHAで停止し、手動送信は行わなかった。その後ユーザーが手動方式を取り下げ、復旧後のOracleによる直接Strict実行を指定した。

復旧後のOracleは0.21.3、personal-use-v3、HEAD 5ebdd42b7a40b03bd6a14cb5e13f7d2124611b4c。PATHの実体は同じdist/bin/oracle-cli.js。buildより新しい入力sourceはなく、初回根拠のsessionManager.ts / oracleHome.ts / browser/config.ts / browser/tabLeaseRegistry.ts / cli/followup.tsは旧HEADから差分がなかった。

oracle-top-design-restoredはstatus=error、promptSubmitted未記録、submittedPromptHash=null、回答ファイルなし。leaseは解放され、実行は終了した。参照会話の最新turnは元の要件整理のままだった。進行中処理として再送待ちをしない。

src/browser/actions/navigation.tsの既存会話判定は、同じconversationIdのsidebar history linkと識別ラベルを確認できない場合にconversation-unresolvedを返す。既存会話では最大10秒確認してから停止する。この分岐に到達したことは確認できたが、どのDOM要素が欠けたかは未特定。別モデルや新規会話の成功を、この既存会話の復旧証拠とはしない。安全判定を回避するflagやsource変更は行わない。

## 現在のゲート

ready=false。正式版にする前に、同じ会話でStrict設計相談を完了し、GitHub connectorの完全SHA検証が成功した回答をローカル根拠へ照合する必要がある。
現在のR/D/PとHTMLは、合意・ローカル証拠から作った具体的な下書きである。準備は進んでいるが「相談済みの正式版」「実装開始可能」とは扱わない。

手動ブラウザ操作へ切り替える場合、chatgpt-use-strictの規則:
`Use the calling skill's wrapper with --export-input-bundle only when the user explicitly directs a switch from Oracle submission to manual ChatGPT browser operation`
に従って、ユーザーの方式変更指示を得てから同じwrapperでexportし、同じ会話へprompt全文と全添付を送る。export時にも最新のclean HEADとGitHub SHA一致を検証する。

## 再開順

1. ユーザー指定のOracle復旧または手動送信方式を確定する。
2. 必要なら最新下書きを相談対象としてcommit/pushし、clean状態とupstream SHAを確認する。
3. 同じ会話で決定表・設計・計画を相談する。GitHub検証失敗の場合はStrict routeを止める。
4. 回答をsourceと照合し、全技術境界とテスト契約を一致させる。
5. 未決Product判断がなければ正式版へ変更し、readiness.ready=trueと証拠を記録する。
6. HTML/ZIPを再生成・検証し、final commit/pushとSHA一致を確認してゴールを完了する。
