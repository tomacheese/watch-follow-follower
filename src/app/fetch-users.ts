import { normalizeUserSnapshot, sortUsers } from '../core/normalize.js'
import { withRetry } from '../core/retry.js'
import { type UserSnapshot } from '../core/types.js'
import { Logger } from '@book000/node-utils'

const logger = Logger.configure('fetch-users')

/**
 * カーソルを辿って全ページ取得する。
 * @param label ログ用ラベル。
 * @param fetchPage 1ページ取得関数。
 * @returns ユーザー一覧。
 */
export async function fetchAllUsers(
  label: string,
  fetchPage: (cursor?: string) => Promise<{
    data: { data: unknown[]; cursor: { bottom?: { value?: string } } }
  }>
): Promise<UserSnapshot[]> {
  const users: UserSnapshot[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  let page = 0
  let emptyPageStreak = 0
  while (true) {
    page += 1
    logger.info(
      `${label} page ${page} fetching...${cursor ? ` cursor=${cursor}` : ''}`
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
    logger.info(
      `${label} page ${page} fetched: +${pageAdded} (total ${users.length})`
    )
    if (pageAdded === 0) {
      emptyPageStreak += 1
    } else {
      emptyPageStreak = 0
    }

    if (!nextCursor || nextCursor === cursor || emptyPageStreak >= 2) {
      break
    }
    if (pageAdded === 0 && nextCursor.startsWith('0|')) {
      break
    }
    cursor = nextCursor
  }

  return sortUsers(users)
}
