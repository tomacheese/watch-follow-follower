# Claude Code Guidelines

## 目的
このドキュメントは、Claude Code がこのプロジェクトで作業する際の方針とルールを定義します。

## 判断記録のルール
1. **判断内容の要約**: 何を決定したかを簡潔に記載
2. **検討した代替案**: 他にどのようなアプローチを検討したか
3. **採用しなかった案とその理由**: なぜ他の案を採用しなかったか
4. **前提条件・仮定・不確実性**: 判断の根拠となった前提や不明確な点
5. **他エージェントによるレビュー可否**: 複雑な変更の場合、他のエージェントによるレビューが必要か

前提・仮定・不確実性を明示し、仮定を事実のように扱わないでください。

## プロジェクト概要
- **目的**: X (Twitter) のフォロー・フォロワーの変更を監視し、Discord に通知するツール
- **主な機能**:
    - 定期的なユーザー情報の取得
    - 前回取得時との差分抽出
    - Discord Webhook への通知

## 重要ルール
- **会話言語**: 日本語
- **コミットメッセージ**: [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) に従う（`<description>` は日本語）
- **コード内コメント**: 日本語
- **エラーメッセージ**: 英語（ユーザー向けのログ出力含む）
- **テキスト整形**: 日本語と英数字の間に半角スペースを挿入

## 環境のルール
- **ブランチ命名**: [Conventional Branch](https://conventional-branch.github.io) に従う (`feat/`, `fix/` など)
- **パッケージマネージャー**: `pnpm` を使用
- **Node.js**: `.node-version` (v24.18.0) に従う

## コード改修時のルール
- **エラーメッセージ**: 絵文字の使用はプロジェクトの既存スタイルに合わせる（現状は標準的なテキストログ）。致命的なエラーは `src/main.ts` の `logFatalError` を使用してファイル出力する。
- **TypeScript**: `tsconfig.json` は `strict: true`（`noImplicitAny` / `strictNullChecks` / `noUnusedLocals` / `noUnusedParameters` など）を有効化している。`any` や型エラーの握り潰しに頼らず、型定義を正しく行う。
- **ドキュメント**: 関数やクラスには日本語で JSDoc を記載する。

## 開発コマンド
```bash
# 依存関係インストール
pnpm install

# 開発モード実行
pnpm dev

# 本番実行
pnpm start

# 静的解析 (Lint & Format)
pnpm lint

# 自動修正
pnpm fix

# 型チェック
pnpm lint:tsc
```

## アーキテクチャと主要ファイル
- **`src/main.ts`**: エントリーポイント。全体のフロー制御と `logFatalError`。
- **`src/app/fetch-users.ts`**: ユーザーリスト取得ロジック。
- **`src/core/diff.ts`**: フォロー・フォロワーの差分計算。`src/core/` には他に `normalize.ts` / `retry.ts` / `types.ts` がある。
- **`src/infra/auth.ts`**: X (Twitter) へのログイン・認証ロジック。
- **`src/infra/cycletls.ts`**: CycleTLS を使用した HTTP 通信（TLS フィンガープリント対策）。
- **`src/infra/config.ts`**: 設定・環境変数の読み込み。
- **`src/infra/fs.ts`**: JSON スナップショット等のファイル入出力。
- **`src/presentation/discord.ts`**: Discord 通知。

## 実装パターン
- **HTTP リクエスト**: `twitter-openapi-typescript`・`@the-convocation/twitter-scraper`・`cycletls` を組み合わせて使用している。直接 `fetch` を使わず、ラップされたクライアントを使用すること。
- **設定管理**: 環境変数と設定ファイル (`config.json`) の両方をサポートする `src/infra/config.ts` のパターンに従う。設定パスやデータ出力先はすべて環境変数で上書き可能: `CONFIG_PATH`（デフォルト `./data/config.json`）、`OUTPUT_DIR`（デフォルト `./data`）、`COOKIE_CACHE_PATH`（デフォルト `./data/twitter-cookies.json`）。新しい設定項目を追加する際はハードコードせずこのパターンに従う。
- **データ出力**: スナップショットと差分は `<OUTPUT_DIR>/<targetUsername>/{followers.json,following.json,diff.json}` に保存される。`data/` はコミット対象外（`.gitignore` 済み）。

## セキュリティ / 機密情報
- API キー・パスワード・認証トークン・Discord Webhook URL などの機密情報は絶対に Git にコミットしない。認証情報は `config.json`（`data/` 配下）または環境変数で管理する。
- ログ出力に認証情報・Cookie・個人情報が含まれないよう配慮する。
- Cookie キャッシュ（`data/twitter-cookies.json`）は機密情報として扱う。

## テスト
- 現在、自動テストコードは存在しません。
- 機能追加・修正時は、`pnpm lint` および `pnpm lint:tsc` を通過することを最低限の品質基準とする。
- 可能であれば手動での動作確認手順を確立する。

## ドキュメント更新ルール
- 機能追加時は `README.md` の更新を検討する。
- 新しい設定項目を追加した場合は、`config.sample.json` と `src/infra/config.ts` の型定義を更新する。

## 作業チェックリスト

### 新規改修時
1. プロジェクトの構造と目的を理解する
2. 適切なブランチを作成する (`feat/...`, `fix/...`)
3. `pnpm install` で依存関係を整える

### コミット・プッシュ前
1. Conventional Commits 形式であることを確認する
2. 機密情報（トークンなど）が含まれていないことを確認する
3. `pnpm lint` と `pnpm lint:tsc` がパスすることを確認する
4. 動作確認を行う

### PR 作成前
1. ユーザーからの作成依頼または作業完了のタイミングであることを確認する
2. コンフリクトの恐れがないか確認する

### PR 作成後
1. CI (GitHub Actions) の結果を確認する
2. PR の説明文が日本語で適切に記述されているか確認する
