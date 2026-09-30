# 作業計画

## 準備段階のゴールと完了条件（完了）

実装開始できる正式な要件定義書・設計書・実装計画書を用意し、Markdown一式ZIPと人間向け説明HTMLを提供する。実装担当はGPT 6.1 Sol / High。準備段階ではツール本体を実装しませんでした。

## 準備段階の手順

- [x] 参照会話全件取得（5往復、hasMore=false）と最新合意の抽出
- [x] 空ディレクトリ確認、Git main 初期化、作業用 .workbench 確保
- [x] 初期環境整備、公開GitHubリポジトリ作成、初回コミットとpush（f14d483、chemitaro/oracle-top）
- [x] Oracle実装と会話の仮定を照合して根拠資料を作成
- [x] clean HEAD / GitHub upstream SHA一致を確認し、同じChatGPT会話で chatgpt-use-strict 設計相談
- [x] 回答をローカル証拠へ照合し、正式R/D/Pと受け入れ条件・実装ゲートを具体化
- [x] 正式R/D/P（32要件・10工程・受け入れ検証表・JSON契約）を作成
- [x] 正式版の説明HTML作成、ブラウザ検証、ZIP作成と内容照合
- [x] 最終成果物コミット・push、実装開始可能性を検証、ゴール完了

## 準備完了時点の記録

同じChatGPT会話へ、展開済みの既存Chromeタブを指定する操作でStrict依頼を送信できました。送信確認timeout後は再送せず同じ会話を回収し、新しい回答のGitHub完全SHA一致とterminal captureを確認しました。Oracle本体の修正は行っていません。

全8境界をローカルOracle根拠へ照合し、正式R/D/P、30 warning code、nullable JSON契約、49の受け入れケース、10工程を同期しました。ready=true、implementationStarted=falseです。実装担当はGPT 6.1 Sol / High、開始工程はP02です。

資料検証と最終パッケージ化、コミット・push、SHA一致確認を完了しました。準備ゴールはf5b7451で完了しています。製品本体の実装は下記の実装ゴールとして開始しました。

検証の範囲は[検証記録](spec/verification.md)、操作回避とStrict結果は[相談記録](spec/consultation.md)に記載します。

## 制約

参照会話の最新ユーザー合意が初期調査の広い提案に優先する。会話全文とOracle実データは .workbench に留める。公開リポジトリに秘密や個人のセッション記録を含めない。

## 実装ゴール（2026-09-30追記）

ユーザーの実装開始指示に従い、正式仕様のP02〜P10をGPT 6.1 Sol／Highで実装します。公開境界の一つの振る舞いごとにTDDのRed→Greenを実施します。必要な具体化にはGPT 5.6 ProによるImplementation Brief Strict、技術相談には仕様策定と同じ会話のChatGPT Use Strictを利用できます。Final Quality Gateは実施しません。

- [x] P02 開発基盤・型契約
- [x] P03 上限付き読み取り
- [x] P04 設定・root/profile解決
- [x] P05 セッション・日時投影
- [x] P06 走査・集計・capacity
- [x] P07 テキスト・JSON表示
- [x] P08 CLI
- [x] P09 TUI
- [x] コードレビューと必要な修正
- [ ] P10 配布CLI・実TTY・安全性・性能・文書の最終確認
- [ ] 全検証済み工程のコミットと動作するツールの納品

実装開始基準はmainのf5b745107f09421655e05c92c8aef7603e9ee68dです。製品完成の判定は受け入れ表A01〜A49と実装報告の実行証拠に従い、計画資料のreadyと区別します。

P10初回候補はf33402a8dc664ff02f63c0b09bf9280ab8c64104へcheckpointしました。初回コードレビュー後、大量行の幅計算を反復maxへ修復し、開発用測定harnessの期限前タイマー復帰も修復しました。現在の全261テスト・13suite、隔離導入CLI6件、自動PTY9件、読み取り専用検査は成功です。通常ホスト上の最新製品60秒測定はCPU4.7249%、peak RSS111.7813MiB、採取p9597.6203ms、30scan、scan/read peak1、入力不変で予算内です。

レビュー修復は75a84e74422818676821d3afb58a250b0ee1a208へcheckpointしました。ユーザー指定のf5b7451からの全実装を同じ2軸で再レビューし、新規指摘0、SP-2/3解消、native不足SP-1継続を確認しました。初回/再レビュー全文と対応判断はcode-review.mdへ記録しています。CPU超過したsandbox測定、8scanのA/B/A診断、通常ホストの正式成功を別証拠として保持し、旧未合格を合格へ補正していません。primaryの元テスト証拠・全261件・source/dist一致照合は完了しています。最終記録を文書/ZIP/manifestのcheckpointとして保存します。Final Quality Gateは実施しません。

2026-10-01、ユーザーの指示に従い内部実行PTYで対話検証を追加しました。120×32/80×24、幅不足40×24、高さ不足120×10、連続resizeの最終描画を確認し、q0/Ctrl-C130/SIGTERM143/制御例外1は全て期待どおりでした。4経路それぞれでstty完全一致、shellの通常入力・削除・実行が成功しました。別private fixtureの短い日本語・結合文字・ZWJ emojiも80/120列に全文残り、保護列のセル位置と入力inventory不変を確認しました。製品コード/配布packageは変更せず、元logと集計を.workbench/p10/internal-terminalへ保持します。

残る受け入れは実端末画面の描画・復元の目視です。内部PTYは既定TERM=dumbのため、ANSI採取時に起動側だけxterm-256colorを指定しました。端末の実pixelsを得た確認とは区別します。Ghosttyに加えCodexもCUAアプリ安全規則で拒否され、Codex terminal panelのopenはqueuedでした。A21/A27/A28/A47・R32が一部/未検証のため、P10全体と製品納品完了のcheckboxを保留します。許可された画面操作又は準備済み手順による人間の画面観測が必要です。private native-run/native-checkにはUnicodeが見える別fixtureを指定する手順を準備しています。
