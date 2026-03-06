# GitHub Copilot Instructions

## プロジェクト概要
- 目的: X (Twitter) のフォロー・フォロワーの変更を監視し、Discord に通知する
- 主な機能: ユーザー情報の取得、差分検出、通知
- 対象ユーザー: 開発者、Twitter ユーザー

## 共通ルール
- 会話は日本語で行う。
- PR とコミットは Conventional Commits に従う。
- 日本語と英数字の間には半角スペースを入れる。

## 技術スタック
- 言語: TypeScript
- ランタイム: Node.js v24.11.1
- パッケージマネージャー: pnpm
- 主要ライブラリ: twitter-openapi-typescript, cycletls

## 開発コマンド
```bash
# 依存関係のインストール
pnpm install

# 開発実行
pnpm dev

# ビルド（型チェック含む）
pnpm lint:tsc

# Lint / Format チェック
pnpm lint

# Lint / Format 自動修正
pnpm fix
```

## テスト方針
- 現在、自動テストコードは存在しません。
- 品質の確認は `pnpm lint` および `pnpm lint:tsc` を使用して、静的解析と型チェックを行ってください。

## セキュリティ / 機密情報
- API キー、パスワード、認証トークンなどの機密情報は `config.json` や環境変数で管理し、絶対に Git にコミットしない。
- ログ出力時に、認証情報や個人情報が含まれないように注意する。

## リポジトリ固有
- `src/infra/cycletls.ts` は TLS フィンガープリント対策のために `cycletls` を使用している。
- 設定ファイルは `config.sample.json` をコピーして `config.json` (または `data/config.json`) として使用する想定。
