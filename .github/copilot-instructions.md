# GitHub Copilot コードレビュー指示

このファイルは GitHub Copilot のコードレビュー機能向けのレビュー基準です。開発作業手順は `CLAUDE.md` を参照。

## プロジェクト概要

X (Twitter) のフォロー・フォロワーの変更を監視し、差分を検出して Discord に通知する TypeScript / Node.js 製ツール。非公式 API に依存する。

## レビュー時の言語

- レビューコメントは日本語で記述する。
- 日本語と英数字の間には半角スペースを入れる。

## 規約（lint / formatter で強制）

- ESLint (`@book000/eslint-config`) と Prettier で整形・静的解析している。フォーマット指摘は原則ツールに委ねる。
- TypeScript は `strict: true`（`noImplicitAny` / `strictNullChecks` / `noUnusedLocals` / `noUnusedParameters` など）。`any` や型エラーの握り潰しがあれば指摘する。
- 直接 `fetch` を使わず、`twitter-openapi-typescript` / `@the-convocation/twitter-scraper` / `cycletls` のラップ済みクライアント経由で HTTP 通信しているか確認する。
- コミットメッセージは Conventional Commits に従う。

## 重点的に確認する点

- **機密情報の混入**: API キー・パスワード・認証トークン・Discord Webhook URL・Cookie が、コード・ログ出力・コミット差分に含まれていないか。認証情報は `config.json`（`data/` 配下）または環境変数で管理される。
- **エラーハンドリング**: 非公式 API・ネットワーク・認証は失敗しうる。例外の握り潰しがないか、致命的エラーが `src/main.ts` の `logFatalError` 経由で扱われているか。
- **設定値のハードコード**: パスや出力先は環境変数（`CONFIG_PATH` / `OUTPUT_DIR` / `COOKIE_CACHE_PATH`）で上書き可能な設計。新しい設定はハードコードせず `src/infra/config.ts` のパターンに従っているか。
- **ドキュメント同期**: 新しい設定項目の追加時に `config.sample.json` と `src/infra/config.ts` の型定義が更新されているか。

## フラグすべきでない既知パターン

- 自動テストコードは存在しない。テスト欠如そのものは指摘不要（品質確認は `pnpm lint` / `pnpm lint:tsc` の静的解析で担保）。
- `data/` 配下（スナップショット・Cookie キャッシュ）は `.gitignore` 済みで意図的に追跡外。
- コード内コメント・JSDoc が日本語であること、およびエラーメッセージが英語であることはプロジェクト規約であり指摘不要。
