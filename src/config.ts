import fs from 'node:fs'
import { TwitterApi } from 'twitter-api-v2'

export const PATH = {
  CONFIG_FILE: process.env.CONFIG_FILE || 'data/config.json',
  USERS_FILE: process.env.USERS_FILE || 'data/users.json',
}

export interface DestinationConfig {
  /** Discord webhook URL (required if using webhook) */
  webhook_url?: string
  /** Discord bot token (required if using bot) */
  token?: string
  /** Discord channel ID (required if using bot) */
  channel_id?: string
}

export interface Configuration {
  /** Twitter API keys */
  twitter: {
    /** Twitter API (v1) consumer key */
    consumer_key: string
    /** Twitter API (v1) consumer secret */
    consumer_secret: string
    /** Twitter API (v1) access token */
    access_token?: string
    /** Twitter API (v1) access token secret */
    access_token_secret?: string
    /** Target user id */
    target_user_id: string
  }
  /* tomacheese/twapi */
  twapi?: {
    base_url: string
    basic_username: string
    basic_password: string
    target_user_id: string
  }
  /** Discord webhook URL or bot token */
  discord: {
    /** Notification recipients when you follow/unfollow */
    follow: DestinationConfig
    /** Notification recipient when you are followed / no longer a follower. */
    follower: DestinationConfig
  }
}

export function loadConfig(): Configuration {
  return JSON.parse(fs.readFileSync(PATH.CONFIG_FILE, 'utf8'))
}

export async function loadTwitterApi(
  config: Configuration,
): Promise<TwitterApi> {
  const api = new TwitterApi({
    appKey: config.twitter.consumer_key,
    appSecret: config.twitter.consumer_secret,
    accessToken: config.twitter.access_token,
    accessSecret: config.twitter.access_token_secret,
  })
  if (!config.twitter.access_token || !config.twitter.access_token_secret) {
    return await api.appLogin()
  }
  return api
}
