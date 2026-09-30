# 作業計画

## ゴールと完了条件

実装開始できる正式な要件定義書・設計書・実装計画書を用意し、Markdown一式ZIPと人間向け説明HTMLを提供する。実装担当はGPT 6.1 Sol / High。今回ツール本体は実装しない。

## 手順

- [x] 参照会話全件取得（5往復、hasMore=false）と最新合意の抽出
- [x] 空ディレクトリ確認、Git main 初期化、作業用 .workbench 確保
- [x] 初期環境整備、公開GitHubリポジトリ作成、初回コミットとpush（f14d483、chemitaro/oracle-top）
- [x] Oracle実装と会話の仮定を照合して根拠資料を作成
- [x] clean HEAD / GitHub upstream SHA一致を確認し、同じChatGPT会話で chatgpt-use-strict 設計相談
- [x] 回答をローカル証拠へ照合し、正式R/D/Pと受け入れ条件・実装ゲートを具体化
- [x] 正式R/D/P（32要件・10工程・受け入れ検証表・JSON契約）を作成
- [x] 正式版の説明HTML作成、ブラウザ検証、ZIP作成と内容照合
- [x] 最終成果物コミット・push、実装開始可能性を検証、ゴール完了

## 現在の状態

同じChatGPT会話へ、展開済みの既存Chromeタブを指定する操作でStrict依頼を送信できました。送信確認timeout後は再送せず同じ会話を回収し、新しい回答のGitHub完全SHA一致とterminal captureを確認しました。Oracle本体の修正は行っていません。

全8境界をローカルOracle根拠へ照合し、正式R/D/P、30 warning code、nullable JSON契約、49の受け入れケース、10工程を同期しました。ready=true、implementationStarted=falseです。実装担当はGPT 6.1 Sol / High、開始工程はP02です。

資料検証と最終パッケージ化を完了しました。この変更一式を最終コミット・pushし、SHA一致確認をもってこの準備ゴールを完了します。製品本体の実装はこのタスクに含めません。

検証の範囲は[検証記録](spec/verification.md)、操作回避とStrict結果は[相談記録](spec/consultation.md)に記載します。

## 制約

参照会話の最新ユーザー合意が初期調査の広い提案に優先する。会話全文とOracle実データは .workbench に留める。公開リポジトリに秘密や個人のセッション記録を含めない。
