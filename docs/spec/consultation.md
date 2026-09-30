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

## 操作による回避と今回の回答

共有された「Oracle再開障害調査」の分析を助言として読み、現行source/buildと実際のChrome表示へ照合しました。プロジェクトのShow moreで対象会話を一覧に表示できましたが、通常起動が作る新しいタブでは表示が先頭5件へ戻り、同じ送信前エラーになりました。

そこで既存の展開済みタブを、Strict wrapperの `--remote-chrome <host:port>` と `--browser-tab <exact-target-id>` で指定しました。会話モード判定を通過し、Pro選択確認と送信へ進みました。Oracle本体、設定、プロファイル、lease cleanupは変更していません。ピン留めは不要となり、適用していません。

`oracle-top-existing-tab-recovery` は `Prompt did not appear in conversation before timeout` でexit1になりました。しかしread_threadで新しいユーザー発言を取得し、元のprompt全文と完全SHAの一致、および添付bundleを確認しました。送信済みと判断し、再送しませんでした。

直後のharvestは30秒以内に新しい回答がなく、古い回答の取得を拒否しました。liveは60秒無変化でstalledとなり前回応答を出力しましたが、stop=yesだったため正式回答として採用しませんでした。完成後に同じセッション・exact targetをharvestし、state=completed、stop=no、assistant count増加、新しいGitHub検証節を含む非空の本文、exit0、保存ファイルを確認しました。

## Strict検証と採用

- 相談入力: `chemitaro/oracle-top`、`main`、`4f37e12b902547cba877f5ffaecaaef64ef9c811`。wrapperがclean worktreeと2回のlive upstream SHA一致を確認しました。
- ChatGPTの報告: `GitHub.fetch` による `GET /repos/chemitaro/oracle-top/branches/main` の `commit.sha` がexpected SHAに完全一致しました。OUS-R001はありません。
- このGitHub確認はChatGPTの本文に記録された、promptで強制するStrict検証です。機械署名付きconnector attestationを取得したとは主張しません。
- 要求入力: `gpt-6-pro / pro`。Oracleはgpt-6-proを `Latest` に変換し、その選択をverified=trueと保存しました。harvestの `Thinking effortPro` 表記だけから正確なモデル世代を断定しません。
- user turn: `fa6dfcd3-2c05-41a6-8db3-f98506b2e665`。assistant turn: `f91e596d-523e-4381-9023-f04fd52754f0`。元の会話で一度だけ依頼したことを確認しました。
- 回答全文はGit管理外の.workbenchへ保存しました。全文hashはreadiness.consultResult.responseSha256です。公開文書へは採用した契約と短い検証記録だけを反映しています。

型・mode・provider判定、root/profileの独立、既定max=3、v1台帳、string[]のbrowserFollowUps、CLI follow-upが別セッションになる点をローカルOracle sourceへ照合しました。8境界の採用判断は[決定記録](boundary-decisions.md)です。提出元のモデル名を公式利用枠の証拠にしません。

## 現在のゲート

ready=true。正式なR/D/P、JSON契約、A01〜A49、説明HTML、ZIPを同期して検証しました。P01は完了し、GPT 6.1 Sol / HighがP02から本体実装を開始できます。implementationStarted=falseを維持します。

これは既存タブの操作による回避です。Oracleの通常起動や送信確認・長時間応答回収の根本修復をした証拠ではありません。送信済みまたは不明なときは同じ会話の回収を優先し、promptを再送しません。

## 実装への引き継ぎ

1. readinessと正式R/D/Pを読み、branch/HEAD/worktreeと担当モデル・推論を確認します。
2. P02〜P10を順番に実行し、各振る舞いを一件ずつ検証してcheckpoint commitします。
3. A01〜A49、製品check、配布・TTY・安全性・性能・文書の全ゲートが揃って製品実装完了にします。
