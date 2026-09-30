# Oracle実装の根拠と具体化する点

確認日: 2026-09-30。対象はローカルOracle 0.21.3、branch `personal-use-v2`、HEAD `8592e539143b7b09e62d616fe980036cb9dcb4a4`。`oracle`はこのcheckoutの `dist/bin/oracle-cli.js` へリンクされている。Oracle本体の変更・pushは行わない。この資料はローカル実装の観察であり、oracle-topのStrict対象コミットにOracleソースそのものが存在するとは主張しない。

## 保存データ

- `src/sessionManager.ts:321-360`: metadataにid/status/model/cwd/options/createdAt/startedAt/completedAt/mode/browserがある。modeはapiまたはbrowser。
- `src/sessionManager.ts:734-804`: 初期status=pending、browser.configとoptions.browserConfigへ設定を保存。options.slugはセッションID。browser.runtimeは初期hash=null。
- `src/sessionManager.ts:955-966`: Oracleの一覧APIはreconcileをpersistする。読み取り専用のoracle-topはOracleライブラリやstatusコマンドを呼ばず、JSONを直接読む。
- `src/oracleHome.ts:15`: session/configのhomeはORACLE_HOME_DIR、なければos.homedir()/.oracle。
- `src/config.ts:127-132,181-189`: ユーザー設定はhome/config.json。JSON5で解析する。project configもOracleでは存在するが、監視側は各プロジェクトを探索しない。

## プロファイルとスロット

- `src/browser/config.ts:101-104,198-205`: manualLoginProfileDirの指定、ORACLE_BROWSER_PROFILE_DIR、os.homedir()/.oracle/browser-profileの順。デフォルトはORACLE_HOME_DIRと連動しない。
- `src/browser/tabLeaseRegistry.ts:20-25,58-61`: 既定上限3、台帳はversion=1とleases配列。保存件数を読み、stale判定・cleanupを行わない。
- `src/browser/config.ts:126-129`: Oracle本体の解決は明示config、env、既定値。oracle-topで会話合意の保存済み現在セッション→env→ユーザー設定→3を採用する場合は、Oracle全設定の完全な再現とは呼ばない。
- 複数プロファイルや現在セッション間の異なるmax値を一つの値にまとめる規則、欠損台帳と壊れた台帳の区別が未具体化。

## 送信とfollow-up

- `src/browser/index.ts:940-945`: 送信操作でpromptSubmitted=true、submittedPromptHash=null、その後runtime hintを保存。hashなしでも初回1件とする会話合意に整合する。ChatGPTアカウント側の利用枠消費の証明ではない。
- `src/sessionManager.ts:309`: options.browserFollowUpsはstring[]。
- `src/cli/followup.ts:79-97` と `bin/oracle-cli.ts:2245-2260,2480-2490`: CLI --followupは親設定を引き継ぎ、同じ会話への新しいセッションを作成する。各セッションを一度ずつ数え、conversationIdで統合しない。
- 同一実行内browserFollowUpsについて、初回promptSubmitted=trueを必須としcompletedなら1+配列長、それ以外なら1という合意を維持する。途中送信の過小計上は許容する。
- requestedモデル／effortを表示し、UIで実際に使われた値や公式課金データと混同しない。

## 設計相談で解決する境界

1. browser判定、Gemini/API除外、unknownモデル、mode欠損の扱い。
2. rootとprofileの解決、対象profileが異なる現在セッション、複数上限値の決定規則。
3. ISO日時、窓の両端、未来日時、欠損、不正値、成功率分母0。
4. effortの保存値high等と会話の固定順位リストとの整合。モデルaliasは無断で統合しない。
5. read中の更新、消失、不正JSON、directory symlink、制御文字、巨大ファイル、警告の粒度。
6. 画面に収まらない行数／端末幅、全データを返すsnapshotとの関係、非TTY、終了／端末復元。
7. pollの重複禁止、低CPUの具体的な予算と検証条件。
8. Node/TypeScriptの最小依存、テストとCLI配布、実装担当GPT 6.1 Sol / High用の段階ゲート。

設計選択は既存MVPを拡張せず、挙動を一意にするためのものとする。Product判断が必要な追加機能は採用しない。
