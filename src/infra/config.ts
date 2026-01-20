import fs from 'node:fs'

export const CONFIG_PATH = process.env.CONFIG_PATH ?? './data/config.json'
export const OUTPUT_DIR = process.env.OUTPUT_DIR ?? './data'
export const COOKIE_CACHE_FILE =
  process.env.COOKIE_CACHE_PATH ?? './data/twitter-cookies.json'
export const COOKIE_EXPIRY_DAYS = 7

/**
 * JSON から読み込むアプリ設定。
 */
export interface AppConfig {
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
export interface Credentials {
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
export interface DiscordConfig {
  /** 通知投稿先の Webhook URL。 */
  webhookUrl?: string
}

/**
 * 設定ファイルを読み込む。
 * @returns 設定内容。
 */
export function loadConfig(): AppConfig {
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
export function getCredentials(): Credentials {
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
export function getDiscordConfig(): DiscordConfig | null {
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
export function getTargetUsername(defaultUsername: string): string {
  return (
    process.env.TWITTER_TARGET_USERNAME ??
    process.env.TARGET_USERNAME ??
    defaultUsername
  )
}
