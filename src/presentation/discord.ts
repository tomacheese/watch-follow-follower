import { type UserSnapshot } from '../core/types.js'

/**
 * Discord Webhook に通知する。
 * @param webhookUrl Webhook URL。
 * @param payload 通知内容。
 * @returns なし。
 */
/**
 * Discord 用の Embed を組み立てる。
 * @param parameters パラメータ。
 * @returns Embed オブジェクト。
 */
function buildDiscordEmbed(parameters: {
  title: string
  diff: { added: UserSnapshot[]; removed: UserSnapshot[] }
  targetUsername: string
  checkedAt: string
}): Record<string, unknown> {
  const addedCount = parameters.diff.added.length
  const removedCount = parameters.diff.removed.length
  const total = addedCount + removedCount

  const formatUsers = (users: UserSnapshot[]): string => {
    if (users.length === 0) {
      return 'なし'
    }
    return users
      .slice(0, 20)
      .map(
        (user) =>
          `[@${user.screenName}](https://twitter.com/${encodeURIComponent(user.screenName)})`
      )
      .join(', ')
  }

  const addedText = formatUsers(parameters.diff.added)
  const removedText = formatUsers(parameters.diff.removed)

  return {
    title: `${parameters.title === 'フォロワー' ? '👥' : '🔔'} ${parameters.title}`,
    color: 0x1d_a1_f2,
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
      text: `チェック対象ユーザー: @${parameters.targetUsername}`,
    },
    timestamp: parameters.checkedAt,
  }
}

export async function sendDiscordNotification(
  webhookUrl: string,
  payload: {
    targetUsername: string
    checkedAt: string
    followers: { added: UserSnapshot[]; removed: UserSnapshot[] }
    following: { added: UserSnapshot[]; removed: UserSnapshot[] }
  }
): Promise<void> {
  const followerChanges =
    payload.followers.added.length + payload.followers.removed.length
  const followingChanges =
    payload.following.added.length + payload.following.removed.length

  const embeds: Record<string, unknown>[] = []

  if (followerChanges > 0) {
    embeds.push(
      buildDiscordEmbed({
        title: 'フォロワー',
        diff: payload.followers,
        targetUsername: payload.targetUsername,
        checkedAt: payload.checkedAt,
      })
    )
  }

  if (followingChanges > 0) {
    embeds.push(
      buildDiscordEmbed({
        title: 'フォロー',
        diff: payload.following,
        targetUsername: payload.targetUsername,
        checkedAt: payload.checkedAt,
      })
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
    let text = ''
    try {
      text = await response.text()
    } catch {
      // レスポンスボディが読めなくてもログ出力自体は継続する
    }
    console.warn(
      `Discord webhook failed: ${response.status} ${response.statusText} ${text}`.trim()
    )
  }
}
