# 設計相談の記録

## 取得と同期

参照「Oracle監視CLI調査」は全5往復を取得し、hasMore=falseを確認した。全文はGit管理外の.workbenchに保存し、公開リポジトリへは最後の合意だけを転記した。
初回準備コミットf14d483、相談入力コミットb2ff1f4をmainへpushした。Strict呼び出し前のlocal HEADとGitHub mainは完全SHA b2ff1f4ab8755145293485dfd1f62d0e14defec2で一致し、worktreeはcleanだった。

## 実行と結果

| 実行 | 対象会話 | 要求モデル・推論 | 結果 |
| --- | --- | --- | --- |
| oracle-top-design-plan | 指定会話の/c/URL | gpt-6-pro / pro | chat-mode-selection / conversation-unresolved、送信前error、exit1 |
| oracle-top-design-retry | ブラウザで確認した同じ会話のproject付きURL | gpt-6-pro / pro | ユーザーの再実行指示で1回実施。同じ送信前error、exit1 |

Oracle 0.21.3、実体CLIのリンク先、HEAD、source/build freshness、session metadata、output.logを確認した。新しいsourceはbuilt CLIより後に存在しない。両セッションはerror、promptSubmittedは未記録。設計回答は生成・取得されていない。
通常のChromeでは同じ会話の既存回答が表示できることを確認した。OracleのChat/Work判定はsidebarの信頼できるhistory要素を必要としており、今回の会話では確認できなかった。root causeを修復したとは主張しない。
新しい会話やAPIへ切り替えず、Oracle source/profile/leaseを変更しなかった。

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
