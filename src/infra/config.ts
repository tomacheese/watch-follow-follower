import fs from 'node:fs'

export const CONFIG_PATH = process.env.CONFIG_PATH ?? './data/config.json'
export const OUTPUT_DIR = process.env.OUTPUT_DIR ?? './data'
export const COOKIE_CACHE_FILE =
  process.env.COOKIE_CACHE_PATH ?? './data/twitter-cookies.json'
export const COOKIE_EXPIRY_DAYS = 7

/**
 * Validated app config loaded from the config file.
 */
export interface AppConfig {
  twitter: {
    username: string
    password: string
    emailAddress?: string
  }
  discord?: {
    webhookUrl?: string
  }
}

/**
 * Raw, unvalidated config file contents.
 */
export interface AppConfigSource {
  twitter?: {
    username?: string
    password?: string
    emailAddress?: string
  }
  discord?: {
    webhookUrl?: string
  }
}

/**
 * Credentials resolved from environment variables or the config file.
 */
export interface Credentials {
  username: string
  password: string
  emailAddress?: string
  /** TOTP secret for 2FA. */
  twoFactorSecret?: string
}

/**
 * Discord notification settings.
 */
export interface DiscordConfig {
  webhookUrl?: string
}

/**
 * Read the config file without validating its fields. Throws if the file is missing or not an object.
 */
export function loadConfigSource(): AppConfigSource {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config file not found: ${CONFIG_PATH}`)
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid config format')
  }
  return parsed
}

/**
 * Read the config file and require `twitter.username` and `twitter.password`.
 */
export function loadConfig(): AppConfig {
  const config = loadConfigSource()
  if (!config.twitter || typeof config.twitter !== 'object') {
    throw new Error('Config is missing twitter section')
  }
  if (!config.twitter.username || !config.twitter.password) {
    throw new Error('Config is missing twitter.username or twitter.password')
  }
  return config as AppConfig
}

/**
 * Resolve credentials. Environment variables take precedence over the config file.
 */
export function getCredentials(): Credentials {
  const envUsername = process.env.TWITTER_USERNAME
  const envPassword = process.env.TWITTER_PASSWORD
  const envEmail = process.env.TWITTER_EMAIL_ADDRESS
  const envTwoFactor = process.env.TWITTER_AUTH_CODE_SECRET

  const config: AppConfig | null =
    !envUsername || !envPassword || (!envEmail && fs.existsSync(CONFIG_PATH))
      ? loadConfig()
      : null

  const username = envUsername ?? config?.twitter.username
  const password = envPassword ?? config?.twitter.password

  if (!username || !password) {
    throw new Error('TWITTER_USERNAME or TWITTER_PASSWORD is not set')
  }
  const emailAddress = envEmail ?? config?.twitter.emailAddress

  return {
    username,
    password,
    emailAddress,
    twoFactorSecret: envTwoFactor,
  }
}

/**
 * Get the Discord settings from the config file, or null if absent.
 */
export function getDiscordConfig(): DiscordConfig | null {
  if (!fs.existsSync(CONFIG_PATH)) {
    return null
  }
  const config = loadConfigSource()
  return config.discord ?? null
}

/**
 * Resolve the target username; `TWITTER_TARGET_USERNAME` takes precedence over `TARGET_USERNAME`.
 */
export function getTargetUsername(defaultUsername: string): string {
  return (
    process.env.TWITTER_TARGET_USERNAME ??
    process.env.TARGET_USERNAME ??
    defaultUsername
  )
}
