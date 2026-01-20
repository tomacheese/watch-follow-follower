import fs from 'node:fs'
import path from 'node:path'

/**
 * JSON ファイルを読み込む。
 * @param filePath ファイルパス。
 * @returns 読み込み結果。失敗時は null。
 */
export function readJsonFile(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    return null
  }
  const raw = fs.readFileSync(filePath, 'utf8')
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

/**
 * JSON ファイルを書き込む。
 * @param filePath ファイルパス。
 * @param data 書き込みデータ。
 */
export function writeJsonFile(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath)
  if (dir && dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}
