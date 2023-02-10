import axios from 'axios'
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

export function sliceArray<T>(array: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(array.length / size) }, (_, index) =>
    array.slice(index * size, index * size + size)
  )
}
