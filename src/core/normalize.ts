import { type UserSnapshot } from './types.js'

/**
 * API レスポンスから UserSnapshot に正規化する。
 * @param data API レスポンス。
 * @returns 正規化済みユーザー。取得できない場合は null。
 */
export function normalizeUserSnapshot(data: unknown): UserSnapshot | null {
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
      (user.is_blue_verified as boolean | undefined)
    ),
    protected: Boolean(legacy?.protected),
  }
}

/**
 * ユーザー一覧を安定した順序でソートする。
 * @param users ユーザー一覧。
 * @returns ソート済みユーザー一覧。
 */
export function sortUsers(users: UserSnapshot[]): UserSnapshot[] {
  return [...users].sort((a, b) => {
    const nameCompare = a.screenName.localeCompare(b.screenName, 'en')
    if (nameCompare !== 0) {
      return nameCompare
    }
    return a.id.localeCompare(b.id, 'en')
  })
}
