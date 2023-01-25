import axios from 'axios'
import {
  ApiPartialResponseError,
  ApiResponseError,
  TwitterApi,
  UserV1,
} from 'twitter-api-v2'
import { DestinationConfig } from './config'

export async function sendDiscordMessage(
  destinationConfig: DestinationConfig,
  text: string
): Promise<void> {
  // webhook or bot
  if (destinationConfig.webhook_url) {
    // webhook
    const response = await axios.post(destinationConfig.webhook_url, {
      content: text,
    })
    if (response.status !== 204) {
      throw new Error(`Discord webhook failed (${response.status})`)
    }
    return
  }
  if (destinationConfig.token && destinationConfig.channel_id) {
    // bot
    const response = await axios.post(
      `https://discord.com/api/channels/${destinationConfig.channel_id}/messages`,
      {
        content: `${text}`,
      },
      {
        headers: {
          Authorization: `Bot ${destinationConfig.token}`,
        },
      }
    )
    if (response.status !== 200) {
      throw new Error(`Discord bot failed (${response.status})`)
    }
  }
}

export async function getTwitterFollowids(
  twitterApi: TwitterApi,
  targetUserId: string
): Promise<string[]> {
  const follows = await twitterApi.v1.userFollowingIds({
    user_id: targetUserId,
    stringify_ids: true,
    count: 5000,
  })
  await follows.fetchLast()
  return follows.ids
}

export async function getTwitterFollowerIds(
  twitterApi: TwitterApi,
  targetUserId: string
): Promise<string[]> {
  const followers = await twitterApi.v1.userFollowerIds({
    user_id: targetUserId,
    stringify_ids: true,
    count: 5000,
  })
  await followers.fetchLast()
  return followers.ids
}

export async function getTwitterUserStatusCode(
  twitterApi: TwitterApi,
  userId: string
): Promise<number | undefined> {
  try {
    await twitterApi.v1.user({
      user_id: userId,
      include_entities: false,
      skip_status: true,
    })
    return 200
  } catch (error) {
    if (error instanceof ApiPartialResponseError && error.response.statusCode) {
      return error.response.statusCode
    }
    if (error instanceof ApiResponseError && error.code) {
      return error.code
    }
    return undefined
  }
}

export async function getTwitterUsersData(
  twitterApi: TwitterApi,
  userIds: string[]
): Promise<UserV1[]> {
  return await twitterApi.v1.users({
    user_id: userIds,
    include_entities: false,
    skip_status: true,
  })
}

export function sliceArray<T>(array: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(array.length / size) }, (_, index) =>
    array.slice(index * size, index * size + size)
  )
}
