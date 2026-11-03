import fs from 'node:fs'
import path from 'node:path'
import { Logger } from '@book000/node-utils'
import { withRetry } from '../core/retry.js'
import { OUTPUT_DIR } from './config.js'

const logger = Logger.configure('remote-config-fetch')

const GUARDED_URL_PREFIX = 'https://raw.githubusercontent.com/fa0311/'

/**
 * Maximum number of leading body characters kept in diagnostic logs.
 */
const MAX_BODY_PREFIX_LENGTH = 200

const CACHE_DIR = path.join(OUTPUT_DIR, 'remote-config-cache')

/**
 * Operation keys this app actually uses
 * (referenced by userApi/userListApi in `twitter-openapi-typescript`).
 */
const REQUIRED_OPERATION_KEYS = ['UserByScreenName', 'Followers', 'Following']

/**
 * Schema validator. Returns a list of problem descriptions, or an empty array if valid.
 */
type SchemaValidator = (data: unknown) => string[]

function validateHeaderJson(data: unknown): string[] {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return ['response is not an object']
  }
  const obj = data as Record<string, unknown>
  return typeof obj['chrome-fetch'] !== 'object' || obj['chrome-fetch'] === null
    ? ['missing or invalid key: chrome-fetch']
    : []
}

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
 * Validation settings and cache file name for a guarded URL.
 */
interface GuardedTarget {
  /** Cache file name, including extension. */
  basename: string
  validate: SchemaValidator
}

/**
 * Return the validation settings if the URL is guarded, otherwise null.
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
  return url.includes('/x-client-transaction-pair-dict/')
    ? { basename: 'pair.json', validate: validatePairJson }
    : null
}

function truncateBody(body: string): string {
  return body.length <= MAX_BODY_PREFIX_LENGTH
    ? body
    : `${body.slice(0, MAX_BODY_PREFIX_LENGTH)}... [truncated]`
}

function cachePath(basename: string): string {
  return path.join(CACHE_DIR, basename)
}

/**
 * Read the last-known-good cache. Returns null if missing or unreadable.
 */
function readCache(basename: string): unknown {
  try {
    const file = cachePath(basename)
    return fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, 'utf8'))
      : null
  } catch (error) {
    logger.warn(
      `Failed to read remote config cache for ${basename}`,
      error instanceof Error ? error : new Error(String(error))
    )
    return null
  }
}

/**
 * Write the last-known-good cache. Failures are logged and ignored.
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
 * Rebuild a `Response` from parsed data so downstream `.json()` calls work.
 */
function toJsonResponse(data: unknown): Response {
  return Response.json(data, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Fetch the URL once and validate status, Content-Type, JSON, and schema.
 * On failure, log diagnostics and throw.
 * @returns Validated, parsed data.
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
  } catch (error) {
    const parseErrorMessage =
      error instanceof Error ? error.message : String(error)
    logger.error(
      `Remote config response is not valid JSON: url=${url} status=${response.status} content-type=${contentType} parseError=${parseErrorMessage} body=${truncateBody(bodyText)}`
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
 * Create a `fetch` wrapper for the remote configs that `twitter-openapi-typescript`
 * loads at runtime (header.json / placeholder.json / pair.json). It validates
 * HTTP status / Content-Type / JSON schema, retries a bounded number of times,
 * falls back to the last-known-good cache, and logs diagnostics.
 * URLs outside the guarded set pass straight through to `baseFetch`.
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
          `Falling back to last-known-good cache for ${target.basename} after fetch failure`,
          error instanceof Error ? error : new Error(String(error))
        )
        return toJsonResponse(cached)
      }
      throw error
    }
  }
}
