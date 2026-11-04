import { type UserSnapshot } from '../core/types.js'

/**
 * Maximum text length of each of the added / removed user lists.
 * Both go into one field (limit 1024 characters), so 480 leaves room for labels.
 */
const MAX_USERS_TEXT_LENGTH = 480

/**
 * Build a Discord embed. User-facing strings are intentionally Japanese.
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

  // A Discord embed field value is limited to 1024 characters; exceeding it returns 400,
  // the snapshot is never updated, and notification fails permanently. Keep each section within the limit.
  const formatUsers = (users: UserSnapshot[]): string => {
    if (users.length === 0) {
      return 'なし'
    }
    const links: string[] = []
    let length = 0
    for (const user of users.slice(0, 20)) {
      const link = `[@${user.screenName}](https://twitter.com/${encodeURIComponent(user.screenName)})`
      if (length + link.length > MAX_USERS_TEXT_LENGTH) {
        break
      }
      links.push(link)
      length += link.length + 2
    }
    const omitted = users.length - links.length
    return omitted > 0
      ? `${links.join(', ')} ほか ${omitted} 件`
      : links.join(', ')
  }

  const addedText = formatUsers(params.diff.added)
  const removedText = formatUsers(params.diff.removed)

  return {
    title: `${params.title === 'フォロワー' ? '👥' : '🔔'} ${params.title}`,
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
      text: `チェック対象ユーザー: @${params.targetUsername}`,
    },
    timestamp: params.checkedAt,
  }
}

/**
 * Notify a Discord webhook. Throws on a non-2xx response or network failure.
 */
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

  const embeds: Record<string, unknown>[] = [
    followerChanges > 0
      ? buildDiscordEmbed({
          title: 'フォロワー',
          diff: payload.followers,
          targetUsername: payload.targetUsername,
          checkedAt: payload.checkedAt,
        })
      : undefined,
    followingChanges > 0
      ? buildDiscordEmbed({
          title: 'フォロー',
          diff: payload.following,
          targetUsername: payload.targetUsername,
          checkedAt: payload.checkedAt,
        })
      : undefined,
  ].filter((embed): embed is Record<string, unknown> => embed !== undefined)

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

  if (response.ok) {
    return
  }

  const text = await response.text().catch(() => '')
  throw new Error(
    `Discord webhook failed: ${response.status} ${response.statusText} ${text}`.trim()
  )
}
