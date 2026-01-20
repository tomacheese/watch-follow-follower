import { type UserSnapshot } from './types.js'
import { sortUsers } from './normalize.js'

/**
 * 前回と今回の差分を計算する。
 * @param previous 前回の一覧。
 * @param current 今回の一覧。
 * @returns 追加/削除の差分。
 */
export function diffUsers(
  previous: UserSnapshot[] | undefined,
  current: UserSnapshot[],
): { added: UserSnapshot[]; removed: UserSnapshot[] } {
  const prevMap = new Map((previous ?? []).map((user) => [user.id, user]))
  const currMap = new Map(current.map((user) => [user.id, user]))

  const added = sortUsers(current.filter((user) => !prevMap.has(user.id)))
  const removed = sortUsers(
    (previous ?? []).filter((user) => !currMap.has(user.id)),
  )

  return { added, removed }
}
