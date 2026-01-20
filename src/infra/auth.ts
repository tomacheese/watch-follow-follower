import fs from 'node:fs'
import path from 'node:path'
import { Scraper } from '@the-convocation/twitter-scraper'
import { cycleTLSFetchWithProxy } from './cycletls.js'
import {
  COOKIE_CACHE_FILE,
  COOKIE_EXPIRY_DAYS,
  type Credentials,
} from './config.js'

/**
 * ディスクに保存する認証 Cookie キャッシュ。
 */
interface CachedCookies {
  /** auth_token の値。 */
  auth_token: string
  /** ct0 の値。 */
  ct0: string
  /** 保存時刻（ミリ秒の epoch）。 */
  savedAt: number
}

/**
 * Cookie キャッシュの構造が妥当か判定する。
 * @param data 判定対象。
 * @returns 妥当なら true。
 */
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
 * Cookie キャッシュを読み込む（期限切れは無効）。
 * @returns 有効なキャッシュ、なければ null。
 */
function loadCachedCookies(): CachedCookies | null {
  try {
    if (!fs.existsSync(COOKIE_CACHE_FILE)) {
      return null
    }
    const data: unknown = JSON.parse(fs.readFileSync(COOKIE_CACHE_FILE, 'utf8'))
    if (!isValidCachedCookies(data)) {
      console.warn('Invalid cookie cache structure')
      return null
    }
    const expiryMs = COOKIE_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    if (Date.now() - data.savedAt > expiryMs) {
      return null
    }
    return data
  } catch (error) {
    console.warn('Failed to load cached cookies', error)
    return null
  }
}

/**
 * Cookie キャッシュを保存する。
 * @param authToken auth_token の値。
 * @param ct0 ct0 の値。
 */
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
 * 503 対応のログインリトライ。
 * @param scraper Scraper インスタンス。
 * @param username ユーザー名。
 * @param password パスワード。
 * @param email メールアドレス（任意）。
 * @param twoFactorSecret 2FA シークレット（任意）。
 * @param maxRetries 最大リトライ回数。
 * @returns なし。
 */
async function loginWithRetry(
  scraper: Scraper,
  username: string,
  password: string,
  email?: string,
  twoFactorSecret?: string,
  maxRetries = 5,
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Login attempt ${attempt}/${maxRetries}...`)
      await scraper.login(username, password, email, twoFactorSecret)
      return
    } catch (error: unknown) {
      const is503 =
        error instanceof Error &&
        (error.message.includes('503') ||
          error.message.includes('Service Unavailable'))

      if (is503 && attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30_000)
        console.warn(`503 error, retrying in ${delay / 1000}s...`)
        await new Promise((resolve) => setTimeout(resolve, delay))
      } else {
        throw error
      }
    }
  }
}

/**
 * 認証 Cookie を取得する（キャッシュ利用あり）。
 * @param credentials 認証情報。
 * @returns auth_token と ct0。
 */
export async function getAuthCookies(
  credentials: Credentials,
): Promise<{ authToken: string; ct0: string }> {
  const cached = loadCachedCookies()
  if (cached) {
    console.log('Using cached cookies')
    return { authToken: cached.auth_token, ct0: cached.ct0 }
  }

  console.log('Logging in with twitter-scraper + CycleTLS...')
  const scraper = new Scraper({
    fetch: cycleTLSFetchWithProxy,
  })

  await loginWithRetry(
    scraper,
    credentials.username,
    credentials.password,
    credentials.emailAddress,
    credentials.twoFactorSecret,
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
  console.log('Login successful, cookies saved')

  return { authToken, ct0 }
}
