import fs from 'node:fs'
import path from 'node:path'
import { Scraper } from '@the-convocation/twitter-scraper'
import { cycleTLSExit } from '@the-convocation/twitter-scraper/cycletls'
import { TwitterOpenApi } from 'twitter-openapi-typescript'
import initCycleTLS, { type CycleTLSClient } from 'cycletls'
import { Headers } from 'headers-polyfill'

const CONFIG_PATH = process.env.CONFIG_PATH ?? './data/config.json'
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? './data'
const COOKIE_CACHE_FILE =
  process.env.COOKIE_CACHE_PATH ?? './data/twitter-cookies.json'
const COOKIE_EXPIRY_DAYS = 7

/**
 * JSON から読み込むアプリ設定。
 */
interface AppConfig {
  twitter: {
    /** ログイン用ユーザー名（スクリーンネーム）。 */
    username: string
    /** ログイン用パスワード。 */
    password: string
    /** ログイン用メールアドレス（任意）。 */
    emailAddress?: string
  }
  discord?: {
    /** Discord Webhook URL。 */
    webhookUrl?: string
  }
}

/**
 * 環境変数や設定ファイルから解決した認証情報。
 */
interface Credentials {
  /** ログイン用ユーザー名（スクリーンネーム）。 */
  username: string
  /** ログイン用パスワード。 */
  password: string
  /** ログイン用メールアドレス（任意）。 */
  emailAddress?: string
  /** 2FA シークレット（TOTP、任意）。 */
  twoFactorSecret?: string
}

/**
 * Discord 通知設定。
 */
interface DiscordConfig {
  /** 通知投稿先の Webhook URL。 */
  webhookUrl?: string
}

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
 * スナップショット出力用に正規化したユーザー情報。
 */
interface UserSnapshot {
  /** ユーザー ID（restId）。 */
  id: string
  /** スクリーンネーム（@なし）。 */
  screenName: string
  /** 表示名。 */
  name: string
  /** 従来の認証済みフラグ。 */
  verified: boolean
  /** Blue 認証フラグ。 */
  isBlueVerified: boolean
  /** 非公開アカウントフラグ。 */
  protected: boolean
}

/**
 * ディスクに保存するスナップショットファイル。
 */
interface SnapshotFile {
  /** 対象のスクリーンネーム。 */
  targetUsername: string
  /** 対象のユーザー ID。 */
  targetUserId: string
  /** 取得時刻（ISO 文字列）。 */
  fetchedAt: string
  /** スナップショットのユーザー一覧。 */
  users: UserSnapshot[]
}

/**
 * ディスクに保存する差分ファイル。
 */
interface DiffFile {
  /** 対象のスクリーンネーム。 */
  targetUsername: string
  /** 対象のユーザー ID。 */
  targetUserId: string
  /** 差分生成時刻（ISO 文字列）。 */
  generatedAt: string
  previousFetchedAt: {
    /** 前回の followers 取得時刻（なければ null）。 */
    followers: string | null
    /** 前回の following 取得時刻（なければ null）。 */
    following: string | null
  }
  currentFetchedAt: {
    /** 今回の followers 取得時刻。 */
    followers: string
    /** 今回の following 取得時刻。 */
    following: string
  }
  followers: {
    /** 追加された followers。 */
    added: UserSnapshot[]
    /** 削除された followers。 */
    removed: UserSnapshot[]
  }
  following: {
    /** 追加された following。 */
    added: UserSnapshot[]
    /** 削除された following。 */
    removed: UserSnapshot[]
  }
}

/**
 * undici/Headers 互換の Headers 形状。
 */
interface HeadersLike {
  /** entries がある場合のイテレータ。 */
  entries?: () => IterableIterator<[string, string]>
  /** イテレータ対応（任意）。 */
  [Symbol.iterator]?: () => Iterator<[string, string]>
}

let cycleTLSInstancePromise: Promise<CycleTLSClient> | null = null

/**
 * CycleTLS インスタンスを初期化し、共有する。
 * @returns CycleTLS クライアント。
 */
async function initCycleTLSWithProxy(): Promise<CycleTLSClient> {
  cycleTLSInstancePromise ??= initCycleTLS()
  return cycleTLSInstancePromise
}

/**
 * CycleTLS を使った fetch 実装（プロキシ対応）。
 * @param input fetch の入力。
 * @param init fetch の初期化オプション。
 * @returns Fetch レスポンス。
 */
async function cycleTLSFetchWithProxy(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const instance = await initCycleTLSWithProxy()
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url

  const method = (init?.method ?? 'GET').toUpperCase()

  const headers: Record<string, string> = {}
  if (init?.headers) {
    const h = init.headers as HeadersLike
    if (h.entries && typeof h.entries === 'function') {
      for (const [key, value] of h.entries()) {
        headers[key] = value
      }
    } else if (Array.isArray(init.headers)) {
      for (const [key, value] of init.headers) {
        headers[key] = value
      }
    } else if (h[Symbol.iterator] && typeof h[Symbol.iterator] === 'function') {
      for (const [key, value] of init.headers as unknown as Iterable<
        [string, string]
      >) {
        headers[key] = value
      }
    } else {
      Object.assign(headers, init.headers as Record<string, string>)
    }
  }

  let body: string | undefined
  if (init?.body) {
    if (typeof init.body === 'string') {
      body = init.body
    } else if (init.body instanceof URLSearchParams) {
      body = init.body.toString()
    } else {
      body = JSON.stringify(init.body)
    }
  }

  let proxy: string | undefined
  const proxyServer = process.env.PROXY_SERVER
  if (proxyServer) {
    const normalizedProxyServer =
      proxyServer.startsWith('http://') || proxyServer.startsWith('https://')
        ? proxyServer
        : `http://${proxyServer}`

    const proxyUsername = process.env.PROXY_USERNAME
    const proxyPassword = process.env.PROXY_PASSWORD
    if (proxyUsername && proxyPassword) {
      try {
        const proxyUrl = new URL(normalizedProxyServer)
        proxyUrl.username = proxyUsername
        proxyUrl.password = proxyPassword
        proxy = proxyUrl.toString()
      } catch {
        throw new Error(
          `Invalid PROXY_SERVER URL: ${proxyServer}. Expected format: host:port, http://host:port or https://host:port`,
        )
      }
    } else {
      proxy = normalizedProxyServer
    }
  }

  const options: Record<string, unknown> = {
    body,
    headers,
    ja3: '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0',
    userAgent:
      headers['user-agent'] ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  }
  if (proxy) {
    options.proxy = proxy
  }

  const response = await instance(
    url,
    options,
    method.toLowerCase() as
      | 'head'
      | 'get'
      | 'post'
      | 'put'
      | 'delete'
      | 'trace'
      | 'options'
      | 'connect'
      | 'patch',
  )

  const responseHeaders = new Headers()
  for (const [key, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        responseHeaders.append(key, v)
      }
    } else if (typeof value === 'string') {
      responseHeaders.set(key, value)
    }
  }

  let responseBody: string
  if (response.data !== undefined && response.data !== null) {
    responseBody =
      typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data)
  } else {
    responseBody = ''
  }

  return new Response(responseBody, {
    status: response.status,
    statusText: '',
    headers: responseHeaders,
  })
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
 * 指数バックオフ付きの汎用リトライ。
 * @typeParam T 返却型。
 * @param fn 実行する関数。
 * @param options リトライ設定。
 * @returns 成功時の戻り値。
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number
    baseDelayMs?: number
    maxDelayMs?: number
    operationName?: string
  } = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30_000,
    operationName = 'operation',
  } = options

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error: unknown) {
      if (attempt >= maxRetries) {
        throw error
      }
      const rateLimitDelay = getRateLimitDelayMs(error)
      const delay =
        rateLimitDelay ??
        Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs)
      const delaySeconds = Math.ceil(delay / 1000)
      if (rateLimitDelay) {
        console.warn(
          `${operationName} hit rate limit, retrying in ${delaySeconds}s...`,
        )
      } else {
        console.warn(
          `${operationName} failed (attempt ${attempt}/${maxRetries}), retrying in ${delaySeconds}s...`,
        )
      }
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw new Error(`${operationName} failed after ${maxRetries} attempts`)
}

/**
 * 429 の Rate Limit から待機時間を計算する。
 * @param error 例外。
 * @returns 待機ミリ秒。判定できない場合は null。
 */
function getRateLimitDelayMs(error: unknown): number | null {
  const err = error as { response?: Response; message?: string }
  if (!err?.response || err.response.status !== 429) {
    return null
  }
  const resetHeader = err.response.headers.get('x-rate-limit-reset')
  const remaining = err.response.headers.get('x-rate-limit-remaining')
  const limit = err.response.headers.get('x-rate-limit-limit')
  if (resetHeader) {
    const resetSeconds = Number(resetHeader)
    if (!Number.isNaN(resetSeconds) && resetSeconds > 0) {
      const resetMs = resetSeconds * 1000
      const now = Date.now()
      const waitMs = Math.max(resetMs - now, 1000)
      const resetTime = new Date(resetMs).toISOString()
      console.warn(
        `Rate limit hit (remaining ${remaining ?? 'unknown'}/${limit ?? 'unknown'}). Reset at ${resetTime}.`,
      )
      return waitMs + 2000
    }
  }
  if (err.message) {
    console.warn(`Rate limit hit: ${err.message}`)
  }
  return 30_000
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
 * 設定ファイルを読み込む。
 * @returns 設定内容。
 */
function loadConfig(): AppConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config file not found: ${CONFIG_PATH}`)
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid config format')
  }
  const config = parsed as AppConfig
  if (!config.twitter?.username || !config.twitter?.password) {
    throw new Error('Config is missing twitter.username or twitter.password')
  }
  return config
}

/**
 * 認証情報を環境変数/設定ファイルから解決する。
 * @returns 認証情報。
 */
function getCredentials(): Credentials {
  const envUsername = process.env.TWITTER_USERNAME
  const envPassword = process.env.TWITTER_PASSWORD
  const envEmail = process.env.TWITTER_EMAIL_ADDRESS
  const envTwoFactor = process.env.TWITTER_AUTH_CODE_SECRET

  let config: AppConfig | null = null
  if (!envUsername || !envPassword) {
    config = loadConfig()
  } else if (!envEmail && fs.existsSync(CONFIG_PATH)) {
    config = loadConfig()
  }

  const username = envUsername ?? config?.twitter.username
  const password = envPassword ?? config?.twitter.password
  const emailAddress = envEmail ?? config?.twitter.emailAddress

  if (!username || !password) {
    throw new Error('TWITTER_USERNAME or TWITTER_PASSWORD is not set')
  }

  return {
    username,
    password,
    emailAddress,
    twoFactorSecret: envTwoFactor,
  }
}

/**
 * Discord 設定を取得する。
 * @returns Discord 設定。なければ null。
 */
function getDiscordConfig(): DiscordConfig | null {
  if (!fs.existsSync(CONFIG_PATH)) {
    return null
  }
  const config = loadConfig()
  return config.discord ?? null
}

/**
 * 取得対象のユーザー名を決定する。
 * @param defaultUsername 既定のユーザー名。
 * @returns 対象ユーザー名。
 */
function getTargetUsername(defaultUsername: string): string {
  return (
    process.env.TWITTER_TARGET_USERNAME ??
    process.env.TARGET_USERNAME ??
    defaultUsername
  )
}

/**
 * 認証 Cookie を取得する（キャッシュ利用あり）。
 * @param credentials 認証情報。
 * @returns auth_token と ct0。
 */
async function getAuthCookies(
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

/**
 * API レスポンスから UserSnapshot に正規化する。
 * @param data API レスポンス。
 * @returns 正規化済みユーザー。取得できない場合は null。
 */
function normalizeUserSnapshot(data: unknown): UserSnapshot | null {
  if (!data || typeof data !== 'object') {
    return null
  }
  const item = data as { user?: Record<string, unknown> }
  const user = item.user
  if (!user) {
    return null
  }
  const restId =
    (user.restId as string | undefined) ??
    (user.rest_id as string | undefined) ??
    (user.legacy as { idStr?: string } | undefined)?.idStr
  const legacy = user.legacy as
    | {
        screenName?: string
        screen_name?: string
        name?: string
        verified?: boolean
        protected?: boolean
      }
    | undefined

  const screenName = legacy?.screenName ?? legacy?.screen_name
  const name = legacy?.name ?? ''

  if (!restId || !screenName) {
    return null
  }

  return {
    id: restId,
    screenName,
    name,
    verified: Boolean(legacy?.verified),
    isBlueVerified: Boolean(
      (user.isBlueVerified as boolean | undefined) ??
        (user.is_blue_verified as boolean | undefined),
    ),
    protected: Boolean(legacy?.protected),
  }
}

/**
 * ユーザー一覧を安定した順序でソートする。
 * @param users ユーザー一覧。
 * @returns ソート済みユーザー一覧。
 */
function sortUsers(users: UserSnapshot[]): UserSnapshot[] {
  return [...users].sort((a, b) => {
    const nameCompare = a.screenName.localeCompare(b.screenName, 'en')
    if (nameCompare !== 0) {
      return nameCompare
    }
    return a.id.localeCompare(b.id, 'en')
  })
}

/**
 * カーソルを辿って全ページ取得する。
 * @param label ログ用ラベル。
 * @param fetchPage 1ページ取得関数。
 * @returns ユーザー一覧。
 */
async function fetchAllUsers(
  label: string,
  fetchPage: (cursor?: string) => Promise<{
    data: { data: unknown[]; cursor: { bottom?: { value?: string } } }
  }>,
): Promise<UserSnapshot[]> {
  const users: UserSnapshot[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  let page = 0
  let emptyPageStreak = 0
  while (true) {
    page += 1
    console.log(
      `${label} page ${page} fetching...${cursor ? ` cursor=${cursor}` : ''}`,
    )
    const response = await withRetry(() => fetchPage(cursor), {
      maxRetries: 5,
      baseDelayMs: 2000,
      operationName: `${label} page ${page}`,
    })

    let pageAdded = 0
    for (const item of response.data.data) {
      const snapshot = normalizeUserSnapshot(item)
      if (!snapshot) {
        continue
      }
      if (seen.has(snapshot.id)) {
        continue
      }
      seen.add(snapshot.id)
      users.push(snapshot)
      pageAdded += 1
    }

    const nextCursor = response.data.cursor.bottom?.value
    console.log(
      `${label} page ${page} fetched: +${pageAdded} (total ${users.length})`,
    )
    if (pageAdded === 0) {
      emptyPageStreak += 1
    } else {
      emptyPageStreak = 0
    }

    if (!nextCursor || nextCursor === cursor || emptyPageStreak >= 2) {
      break
    }
    if (pageAdded === 0 && nextCursor?.startsWith('0|')) {
      break
    }
    cursor = nextCursor
  }

  return sortUsers(users)
}

/**
 * JSON ファイルを読み込む。
 * @typeParam T 返却型。
 * @param filePath ファイルパス。
 * @returns 読み込み結果。失敗時は null。
 */
function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null
  }
  const raw = fs.readFileSync(filePath, 'utf8')
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/**
 * JSON ファイルを書き込む。
 * @param filePath ファイルパス。
 * @param data 書き込みデータ。
 */
function writeJsonFile(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath)
  if (dir && dir !== '.' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

/**
 * 前回と今回の差分を計算する。
 * @param previous 前回の一覧。
 * @param current 今回の一覧。
 * @returns 追加/削除の差分。
 */
function diffUsers(
  previous: UserSnapshot[] | undefined,
  current: UserSnapshot[],
): { added: UserSnapshot[]; removed: UserSnapshot[] } {
  const prevMap = new Map(
    (previous ?? []).map((user) => [user.id, user]),
  )
  const currMap = new Map(current.map((user) => [user.id, user]))

  const added = sortUsers(
    current.filter((user) => !prevMap.has(user.id)),
  )
  const removed = sortUsers(
    (previous ?? []).filter((user) => !currMap.has(user.id)),
  )

  return { added, removed }
}

/**
 * CycleTLS インスタンスを終了する。
 * @returns なし。
 */
async function cleanup(): Promise<void> {
  if (cycleTLSInstancePromise) {
    try {
      const instance = await cycleTLSInstancePromise
      await instance.exit()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.warn(`CycleTLS instance exit failed: ${message}`)
    }
  }
  try {
    cycleTLSExit()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.debug(
      `twitter-scraper CycleTLS exit error (may not be initialized): ${message}`,
    )
  }
}

/**
 * メイン処理。
 * @returns なし。
 */
async function main(): Promise<void> {
  let exitCode = 0
  try {
    const credentials = getCredentials()
    const discordConfig = getDiscordConfig()
    const targetUsername = getTargetUsername(credentials.username)

    console.log(`Target user: @${targetUsername}`)

    const { authToken, ct0 } = await getAuthCookies(credentials)
    TwitterOpenApi.fetchApi = cycleTLSFetchWithProxy

    const api = new TwitterOpenApi()
    const client = await api.getClientFromCookies({
      auth_token: authToken,
      ct0,
    })

    const targetResponse = await withRetry(
      () =>
        client.getUserApi().getUserByScreenName({
          screenName: targetUsername,
        }),
      {
        maxRetries: 3,
        baseDelayMs: 2000,
        operationName: `Resolve user @${targetUsername}`,
      },
    )

    const targetUser = normalizeUserSnapshot(targetResponse.data) ??
      normalizeUserSnapshot({ user: targetResponse.data.user })
    if (!targetUser) {
      throw new Error(`Failed to resolve user: ${targetUsername}`)
    }

    const targetUserId = targetUser.id

    const followers = await fetchAllUsers('Followers', (cursor) =>
      client.getUserListApi().getFollowers({
        userId: targetUserId,
        cursor,
        count: 200,
      }),
    )

    const following = await fetchAllUsers('Following', (cursor) =>
      client.getUserListApi().getFollowing({
        userId: targetUserId,
        cursor,
        count: 200,
      }),
    )

    const targetDir = path.join(
      OUTPUT_DIR,
      targetUsername.replace(/[^a-zA-Z0-9_-]/g, '_'),
    )

    const followersPath = path.join(targetDir, 'followers.json')
    const followingPath = path.join(targetDir, 'following.json')
    const diffPath = path.join(targetDir, 'diff.json')

    const previousFollowers = readJsonFile<SnapshotFile>(followersPath)
    const previousFollowing = readJsonFile<SnapshotFile>(followingPath)

    const followersFetchedAt = new Date().toISOString()
    const followingFetchedAt = new Date().toISOString()

    const followersSnapshot: SnapshotFile = {
      targetUsername,
      targetUserId,
      fetchedAt: followersFetchedAt,
      users: followers,
    }

    const followingSnapshot: SnapshotFile = {
      targetUsername,
      targetUserId,
      fetchedAt: followingFetchedAt,
      users: following,
    }

    writeJsonFile(followersPath, followersSnapshot)
    writeJsonFile(followingPath, followingSnapshot)

    if (previousFollowers || previousFollowing) {
      const followersDiff = diffUsers(previousFollowers?.users, followers)
      const followingDiff = diffUsers(previousFollowing?.users, following)

      const diff: DiffFile = {
        targetUsername,
        targetUserId,
        generatedAt: new Date().toISOString(),
        previousFetchedAt: {
          followers: previousFollowers?.fetchedAt ?? null,
          following: previousFollowing?.fetchedAt ?? null,
        },
        currentFetchedAt: {
          followers: followersFetchedAt,
          following: followingFetchedAt,
        },
        followers: followersDiff,
        following: followingDiff,
      }

      writeJsonFile(diffPath, diff)

      console.log(
        `Followers: +${followersDiff.added.length} / -${followersDiff.removed.length}`,
      )
      console.log(
        `Following: +${followingDiff.added.length} / -${followingDiff.removed.length}`,
      )

      const totalChanges =
        followersDiff.added.length +
        followersDiff.removed.length +
        followingDiff.added.length +
        followingDiff.removed.length

      if (totalChanges > 0 && discordConfig?.webhookUrl) {
        await sendDiscordNotification(discordConfig.webhookUrl, {
          targetUsername,
          checkedAt: new Date().toISOString(),
          followers: followersDiff,
          following: followingDiff,
        })
      }
    } else {
      console.log('Snapshot saved. No previous data to diff.')
    }

    console.log(
      `Saved followers (${followers.length}) and following (${following.length}) to ${targetDir}`,
    )
  } catch (error) {
    console.error('Fatal error occurred', error)
    exitCode = 1
  } finally {
    await cleanup()
  }

  process.exit(exitCode)
}

main()

/**
 * Discord Webhook に通知する。
 * @param webhookUrl Webhook URL。
 * @param payload 通知内容。
 * @returns なし。
 */
async function sendDiscordNotification(
  webhookUrl: string,
  payload: {
    targetUsername: string
    checkedAt: string
    followers: { added: UserSnapshot[]; removed: UserSnapshot[] }
    following: { added: UserSnapshot[]; removed: UserSnapshot[] }
  },
): Promise<void> {
  const followerChanges =
    payload.followers.added.length + payload.followers.removed.length
  const followingChanges =
    payload.following.added.length + payload.following.removed.length

  const embeds: Array<Record<string, unknown>> = []

  if (followerChanges > 0) {
    embeds.push(
      buildDiscordEmbed({
        title: 'フォロワー',
        diff: payload.followers,
        targetUsername: payload.targetUsername,
        checkedAt: payload.checkedAt,
      }),
    )
  }

  if (followingChanges > 0) {
    embeds.push(
      buildDiscordEmbed({
        title: 'フォロー',
        diff: payload.following,
        targetUsername: payload.targetUsername,
        checkedAt: payload.checkedAt,
      }),
    )
  }

  if (embeds.length === 0) {
    return
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'Follow/Follower Checker',
      embeds,
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    console.warn(
      `Discord webhook failed: ${response.status} ${response.statusText} ${text}`.trim(),
    )
  }
}

/**
 * Discord 用の Embed を組み立てる。
 * @param params パラメータ。
 * @returns Embed オブジェクト。
 */
function buildDiscordEmbed(params: {
  title: string
  diff: { added: UserSnapshot[]; removed: UserSnapshot[] }
  targetUsername: string
  checkedAt: string
}): Record<string, unknown> {
  const addedCount = params.diff.added.length
  const removedCount = params.diff.removed.length
  const total = addedCount + removedCount

  const formatUsers = (users: UserSnapshot[]): string => {
    if (users.length === 0) {
      return 'なし'
    }
    return users
      .slice(0, 20)
      .map((user) => `@${user.screenName}`)
      .join(', ')
  }

  const addedText = formatUsers(params.diff.added)
  const removedText = formatUsers(params.diff.removed)

  return {
    title: `${params.title === 'フォロワー' ? '👥' : '🔔'} ${params.title}`,
    color: 0x1da1f2,
    fields: [
      {
        name: '差異件数',
        value: `${total} (追加 ${addedCount} / 削除 ${removedCount})`,
        inline: false,
      },
      {
        name: '内訳',
        value: `追加: ${addedText}\n削除: ${removedText}`,
        inline: false,
      },
    ],
    footer: {
      text: `チェック対象ユーザー: @${params.targetUsername}`,
    },
    timestamp: params.checkedAt,
  }
}
