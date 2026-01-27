# Gemini CLI Guidelines

## 目的
このドキュメントは、Gemini CLI がこのプロジェクトで作業する際のコンテキストと方針を定義します。

## 出力スタイル
- **言語**: 日本語
- **トーン**: 簡潔、専門的、丁寧
- **形式**: Markdown

## 共通ルール
- **会話言語**: 日本語
- **コミットメッセージ**: [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) に従う。
    - 形式: `<type>(<scope>): <description>`
    - `<description>` は日本語
- **テキスト整形**: 日本語と英数字の間に半角スペースを挿入する。

## プロジェクト概要
- **目的**: X (Twitter) のフォロー・フォロワー監視および Discord 通知
- **技術スタック**: TypeScript, Node.js (v24.11.1), pnpm

## コーディング規約
- **フォーマット/Lint**: プロジェクトの `eslint.config.mjs` および `.prettierrc.yml` に従う。
- **命名規則**: 既存のコード（キャメルケース、パスカルケースなど）に合わせる。
- **コメント**: 日本語で記述する。JSDoc を推奨。
- **エラーメッセージ**: 英語で記述する。

## 開発コマンド
```bash
# 依存関係インストール
pnpm install

# 開発実行
pnpm dev

# ビルド・型チェック
pnpm lint:tsc

# Lint 実行
pnpm lint

# 自動修正
pnpm fix
```

## 注意事項
- **セキュリティ**:
    - `config.json` や `.env` に含まれる認証情報はコミットしない。
    - ログに機密情報を含めない。
- **既存ルールの優先**: プロジェクト内の設定ファイル（`tsconfig.json`, `eslint.config.mjs` 等）を最優先する。
- **制約**: 現在テストコードが存在しないため、変更時は静的解析 (`lint`, `tsc`) を確実に通し、可能な範囲で論理的な検証を行うこと。

## リポジトリ固有情報
- 認証ロジックは `src/infra/auth.ts` および `cycletls` を利用した `src/infra/cycletls.ts` に集約されている。
- ファイル操作は `src/infra/fs.ts` を通じて行うことが多い。
- データは `OUTPUT_DIR` (デフォルト `./data`) に保存される。
