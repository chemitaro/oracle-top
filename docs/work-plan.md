# 作業計画

## ゴールと完了条件

実装開始できる正式な要件定義書・設計書・実装計画書を用意し、Markdown一式ZIPと人間向け説明HTMLを提供する。実装担当はGPT 6.1 Sol / High。今回ツール本体は実装しない。

## 手順

- [x] 参照会話全件取得（5往復、hasMore=false）と最新合意の抽出
- [x] 空ディレクトリ確認、Git main 初期化、作業用 .workbench 確保
- [x] 初期環境整備、公開GitHubリポジトリ作成、初回コミットとpush（f14d483、chemitaro/oracle-top）
- [x] Oracle実装と会話の仮定を照合して根拠資料を作成
- [ ] clean HEAD / GitHub upstream SHA一致を確認し、同じChatGPT会話で chatgpt-use-strict 設計相談
- [ ] 回答をローカル証拠へ照合し、正式R/D/Pと受け入れ条件・実装ゲートを具体化
- [x] 相談前の具体的下書き（32要件・9実装工程・受け入れ検証表・JSON契約）を作成
- [x] 下書きの説明HTML作成、ブラウザ検証、ZIP作成と内容照合
- [ ] 最終成果物コミット・push、実装開始可能性を検証、ゴール完了

## 現在の状態

相談入力コミットb2ff1f4でclean状態とGitHub SHA一致を確認した。Oracle実行とユーザー指示による再実行は、いずれもchat-mode-selection / conversation-unresolvedで送信前に終了した。Strict相談の回答は取得できていない。

下書きチェックポイント9bb3a17をpush済み。手動入力準備はCAPTCHAで未送信のまま、ユーザー指示により直接Strictへ戻した。復旧後のpersonal-use-v3でもoracle-top-design-restoredは同じ送信前エラーで終了した。既存会話のモード確認が再開条件として残る。

下書きを検証・パッケージ化してチェックポイントとして保存する。正式化とready=trueは同じ会話でのStrict相談を完了してから行う。ゴールは未達であり、ツール本体の実装は開始しない。

検証の範囲と再開条件は[検証記録](spec/verification.md)および[相談記録](spec/consultation.md)に記載する。

## 制約

参照会話の最新ユーザー合意が初期調査の広い提案に優先する。会話全文とOracle実データは .workbench に留める。公開リポジトリに秘密や個人のセッション記録を含めない。
