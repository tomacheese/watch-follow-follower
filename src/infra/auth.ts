import fs from 'node:fs'
import path from 'node:path'
import { Scraper } from '@the-convocation/twitter-scraper'
import { Logger } from '@book000/node-utils'
import { cycleTLSFetchWithProxy } from './cycletls.js'
import {
  COOKIE_CACHE_FILE,
  COOKIE_EXPIRY_DAYS,
  type Credentials,
} from './config.js'

const logger = Logger.configure('auth')

/**
 * Maximum length of an error message forwarded to GlitchTip.
 * Third-party API errors can embed whole HTTP response headers or bodies in
 * `message`, so cap the amount of data sent externally.
 */
const MAX_ERROR_MESSAGE_LENGTH = 2000

function truncateMessage(message: string): string {
  return message.length <= MAX_ERROR_MESSAGE_LENGTH
    ? message
    : `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}... [truncated]`
}

/**
 * Convert an unknown thrown value to an `Error`.
 * Non-Error values keep their structure via `JSON.stringify`, falling back to
 * `String()` only when they cannot be serialized.
 */
function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error.message.length <= MAX_ERROR_MESSAGE_LENGTH
      ? error
      : new Error(truncateMessage(error.message))
  }
  try {
    return new Error(truncateMessage(JSON.stringify(error)))
  } catch {
    return new Error(truncateMessage(String(error)))
  }
}

/**
 * Auth cookie cache persisted to disk.
 */
interface CachedCookies {
  auth_token: string
  ct0: string
  /** Save time (epoch milliseconds). */
  savedAt: number
}

function isValidCachedCookies(data: unknown): data is CachedCookies {
  if (typeof data !== 'object' || data === null) {
    return false
  }
  const obj = data as Record<string, unknown>
  return (
    typeof obj.auth_token === 'string' &&
    typeof obj.ct0 === 'string' &&
    typeof obj.savedAt === 'number'
  )
}

/**
 * Load the cookie cache. Returns null if missing, invalid, or older than `COOKIE_EXPIRY_DAYS`.
 */
function loadCachedCookies(): CachedCookies | null {
  try {
    if (!fs.existsSync(COOKIE_CACHE_FILE)) {
      return null
    }
    const data: unknown = JSON.parse(fs.readFileSync(COOKIE_CACHE_FILE, 'utf8'))
    if (!isValidCachedCookies(data)) {
      logger.warn('Invalid cookie cache structure')
      return null
    }
    const expiryMs = COOKIE_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    return Date.now() - data.savedAt > expiryMs ? null : data
  } catch (error) {
    logger.warn('Failed to load cached cookies', toError(error))
    return null
  }
}

function saveCookies(authToken: string, ct0: string): void {
  const dir = path.dirname(COOKIE_CACHE_FILE)
  if (dir && dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const data: CachedCookies = {
    auth_token: authToken,
    ct0,
    savedAt: Date.now(),
  }
  fs.writeFileSync(COOKIE_CACHE_FILE, JSON.stringify(data, null, 2))
}

/**
 * Log in, retrying with exponential backoff only on 503 / Service Unavailable.
 * Other errors are thrown immediately.
 */
async function loginWithRetry(
  scraper: Scraper,
  username: string,
  password: string,
  email?: string,
  twoFactorSecret?: string,
  maxRetries = 5
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`Login attempt ${attempt}/${maxRetries}...`)
      await scraper.login(username, password, email, twoFactorSecret)
      return
    } catch (error: unknown) {
      const is503 =
        error instanceof Error &&
        (error.message.includes('503') ||
          error.message.includes('Service Unavailable'))

      if (is503 && attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30_000)
        logger.info(`503 error, retrying in ${delay / 1000}s...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      } else {
        throw error
      }
    }
  }
}

/**
 * Get auth cookies, using the cookie cache when valid and logging in otherwise.
 * @returns `auth_token` and `ct0`.
 */
export async function getAuthCookies(
  credentials: Credentials
): Promise<{ authToken: string; ct0: string }> {
  const cached = loadCachedCookies()
  if (cached) {
    logger.info('Using cached cookies')
    return { authToken: cached.auth_token, ct0: cached.ct0 }
  }

  logger.info('Logging in with twitter-scraper + CycleTLS...')
  const scraper = new Scraper({
    fetch: cycleTLSFetchWithProxy,
  })

  await loginWithRetry(
    scraper,
    credentials.username,
    credentials.password,
    credentials.emailAddress,
    credentials.twoFactorSecret
  )

  if (!(await scraper.isLoggedIn())) {
    throw new Error('Login failed')
  }

  const cookies = await scraper.getCookies()
  const authToken = cookies.find((c) => c.key === 'auth_token')?.value
  const ct0 = cookies.find((c) => c.key === 'ct0')?.value

  if (!authToken || !ct0) {
    throw new Error('Failed to get auth_token or ct0 from cookies')
  }

  saveCookies(authToken, ct0)
  logger.info('Login successful, cookies saved')

  return { authToken, ct0 }
}
