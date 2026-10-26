import { type UserSnapshot } from '../core/types.js'

/**
 * 追加 / 削除それぞれのユーザー一覧テキストの最大文字数。
 * 両方を 1 フィールド (上限 1024 文字) に入れるため、ラベル分の余白を残して 480 とする。
 */
const MAX_USERS_TEXT_LENGTH = 480

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

  // Discord の Embed フィールド値は 1024 文字までで、超過すると 400 になり
  // スナップショットが更新されず通知が永続的に失敗するため、各セクションを上限内に収める
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
 * Discord Webhook に通知する。
 * 非 2xx 応答やネットワーク失敗の場合は例外を throw する。
 * @param webhookUrl Webhook URL。
 * @param payload 通知内容。
 * @returns なし。
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
