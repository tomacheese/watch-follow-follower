import fs from 'node:fs'
import path from 'node:path'
import { Logger } from '@book000/node-utils'
import { withRetry } from '../core/retry.js'
import { OUTPUT_DIR } from './config.js'

const logger = Logger.configure('remote-config-fetch')

/**
 * 耐障害化の対象とする remote config URL の共通プレフィックス。
 */
const GUARDED_URL_PREFIX = 'https://raw.githubusercontent.com/fa0311/'

/**
 * 診断ログに残す body 先頭の最大文字数。
 */
const MAX_BODY_PREFIX_LENGTH = 200

/**
 * last-known-good cache の保存先ディレクトリ。
 */
const CACHE_DIR = path.join(OUTPUT_DIR, 'remote-config-cache')

/**
 * このアプリが実際に使用する必須オペレーションキー
 * (`twitter-openapi-typescript` の userApi/userListApi が参照するキー)。
 */
const REQUIRED_OPERATION_KEYS = ['UserByScreenName', 'Followers', 'Following']

/**
 * スキーマ検証関数の型。問題があれば説明文の配列を返し、問題なければ
 * 空配列を返す。
 */
type SchemaValidator = (data: unknown) => string[]

/**
 * header.json (latest-user-agent) のスキーマを検証する。
 * @param data パース済みレスポンス。
 * @returns 問題点のリスト（空なら妥当）。
 */
function validateHeaderJson(data: unknown): string[] {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return ['response is not an object']
  }
  const obj = data as Record<string, unknown>
  if (typeof obj['chrome-fetch'] !== 'object' || obj['chrome-fetch'] === null) {
    return ['missing or invalid key: chrome-fetch']
  }
  return []
}

/**
 * placeholder.json (flag) のスキーマを検証する。
 * @param data パース済みレスポンス。
 * @returns 問題点のリスト（空なら妥当）。
 */
function validatePlaceholderJson(data: unknown): string[] {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return ['response is not an object']
  }
  const obj = data as Record<string, unknown>
  const problems: string[] = []
  for (const key of REQUIRED_OPERATION_KEYS) {
    const entry = obj[key]
    if (typeof entry !== 'object' || entry === null) {
      problems.push(`missing or invalid key: ${key}`)
      continue
    }
    const queryId = (entry as Record<string, unknown>).queryId
    if (typeof queryId !== 'string') {
      problems.push(`missing or invalid key: ${key}.queryId`)
    }
  }
  return problems
}

/**
 * pair.json (x-client-transaction-pair-dict) のスキーマを検証する。
 * @param data パース済みレスポンス。
 * @returns 問題点のリスト（空なら妥当）。
 */
function validatePairJson(data: unknown): string[] {
  if (!Array.isArray(data) || data.length === 0) {
    return ['response is not a non-empty array']
  }
  for (const [index, item] of data.entries()) {
    if (typeof item !== 'object' || item === null) {
      return [`item at index ${index} is not an object`]
    }
    const obj = item as Record<string, unknown>
    if (
      typeof obj.animationKey !== 'string' ||
      typeof obj.verification !== 'string'
    ) {
      return [`item at index ${index} is missing animationKey or verification`]
    }
  }
  return []
}

/**
 * 耐障害化の対象 URL と、その検証関数・キャッシュファイル名の組。
 */
interface GuardedTarget {
  /** キャッシュファイル名(拡張子込み)。 */
  basename: string
  /** この URL のレスポンスを検証する関数。 */
  validate: SchemaValidator
}

/**
 * URL が耐障害化の対象かどうかを判定し、対象なら検証設定を返す。
 * @param url 判定対象の URL。
 * @returns 対象なら `GuardedTarget`、対象外なら null。
 */
function matchGuardedTarget(url: string): GuardedTarget | null {
  if (!url.startsWith(GUARDED_URL_PREFIX)) {
    return null
  }
  if (url.includes('/latest-user-agent/')) {
    return { basename: 'header.json', validate: validateHeaderJson }
  }
  if (url.includes('/twitter-openapi/')) {
    return { basename: 'placeholder.json', validate: validatePlaceholderJson }
  }
  if (url.includes('/x-client-transaction-pair-dict/')) {
    return { basename: 'pair.json', validate: validatePairJson }
  }
  return null
}

/**
 * 診断ログ用に body を切り詰める。
 * @param body 元の body 文字列。
 * @returns 切り詰め後の文字列。
 */
function truncateBody(body: string): string {
  if (body.length <= MAX_BODY_PREFIX_LENGTH) {
    return body
  }
  return `${body.slice(0, MAX_BODY_PREFIX_LENGTH)}... [truncated]`
}

/**
 * キャッシュファイルの絶対パスを返す。
 * @param basename キャッシュファイル名。
 * @returns ファイルパス。
 */
function cachePath(basename: string): string {
  return path.join(CACHE_DIR, basename)
}

/**
 * last-known-good cache を読み込む。
 * @param basename キャッシュファイル名。
 * @returns キャッシュ済みデータ、なければ null。
 */
function readCache(basename: string): unknown {
  try {
    const file = cachePath(basename)
    if (!fs.existsSync(file)) {
      return null
    }
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    logger.warn(
      `Failed to read remote config cache for ${basename}`,
      error instanceof Error ? error : new Error(String(error))
    )
    return null
  }
}

/**
 * last-known-good cache を保存する。
 * @param basename キャッシュファイル名。
 * @param data 保存するデータ。
 */
function writeCache(basename: string, data: unknown): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true })
    }
    fs.writeFileSync(cachePath(basename), JSON.stringify(data, null, 2))
  } catch (error) {
    logger.warn(
      `Failed to write remote config cache for ${basename}`,
      error instanceof Error ? error : new Error(String(error))
    )
  }
}

/**
 * パース済みデータから、下流の `.json()` 呼び出しに応答できる
 * `Response` を再構築する。
 * @param data レスポンスとして返すデータ。
 * @returns Response インスタンス。
 */
function toJsonResponse(data: unknown): Response {
  return Response.json(data, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * 対象 URL を 1 回取得し、status/Content-Type/JSON/schema を検証する。
 * 検証に失敗した場合は診断情報をログに残してエラーを送出する。
 * @param baseFetch 実際の通信に使う fetch 互換関数。
 * @param url 取得対象 URL。
 * @param init fetch のオプション。
 * @param target この URL の検証設定。
 * @returns 検証済みのパース済みデータ。
 */
async function fetchAndValidate(
  baseFetch: typeof fetch,
  url: string,
  init: RequestInit | undefined,
  target: GuardedTarget
): Promise<unknown> {
  const response = await baseFetch(url, init)
  const contentType = response.headers.get('content-type') ?? ''
  const bodyText = await response.text()

  if (!response.ok) {
    logger.error(
      `Remote config fetch failed: url=${url} status=${response.status} content-type=${contentType} body=${truncateBody(bodyText)}`
    )
    throw new Error(
      `Remote config fetch failed with status ${response.status}: ${url}`
    )
  }

  if (contentType.includes('text/html')) {
    logger.error(
      `Remote config fetch returned HTML content: url=${url} status=${response.status} content-type=${contentType} body=${truncateBody(bodyText)}`
    )
    throw new Error(`Remote config fetch returned HTML content: ${url}`)
  }

  let data: unknown
  try {
    data = JSON.parse(bodyText)
  } catch {
    logger.error(
      `Remote config response is not valid JSON: url=${url} status=${response.status} content-type=${contentType} body=${truncateBody(bodyText)}`
    )
    throw new Error(`Remote config response is not valid JSON: ${url}`)
  }

  const problems = target.validate(data)
  if (problems.length > 0) {
    logger.error(
      `Remote config schema validation failed: url=${url} problems=${problems.join(', ')} body=${truncateBody(bodyText)}`
    )
    throw new Error(`Remote config schema validation failed: ${url}`)
  }

  return data
}

/**
 * `twitter-openapi-typescript` が実行時に取得する remote config
 * (header.json / placeholder.json / pair.json)に限定して、
 * HTTP status / Content-Type / JSON schema の検証、bounded retry、
 * last-known-good cache へのフォールバック、診断ログを行う fetch
 * ラッパーを生成する。対象外の URL は `baseFetch` にそのまま素通しする。
 * @param baseFetch ラップ対象の fetch 互換関数。
 * @returns fetch 互換の関数。
 */
export function createGuardedFetch(baseFetch: typeof fetch): typeof fetch {
  return async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url

    const target = matchGuardedTarget(url)
    if (!target) {
      return baseFetch(input, init)
    }

    try {
      const data = await withRetry(
        () => fetchAndValidate(baseFetch, url, init, target),
        {
          maxRetries: 3,
          baseDelayMs: 1000,
          operationName: `Fetch remote config (${target.basename})`,
        }
      )
      writeCache(target.basename, data)
      return toJsonResponse(data)
    } catch (error) {
      const cached = readCache(target.basename)
      if (cached !== null) {
        logger.warn(
          `Falling back to last-known-good cache for ${target.basename} after fetch failure: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
        return toJsonResponse(cached)
      }
      throw error
    }
  }
}
