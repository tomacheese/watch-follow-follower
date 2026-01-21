# AGENTS.md

## プロジェクト概要
- パッケージマネージャは pnpm を使用します。
- Node.js のバージョンは `.node-version` を参照します。
- 設定ファイルは `./data/config.json` で、`CONFIG_PATH` で変更できます。

## 実装メモ
- Twitter 認証が必要な処理では `loadConfig()` または `getCredentials()` を使い、必須項目の検証を行います。
- Twitter 設定が不要な読み取りでは `loadConfigSource()` を使い、未設定でも落ちないようにします。
