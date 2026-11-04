import fs from 'node:fs'
import path from 'node:path'

/**
 * Read a JSON file. Returns null if the file is missing or not valid JSON.
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
 * Write a JSON file, creating parent directories as needed.
 */
export function writeJsonFile(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath)
  if (dir && dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}
