import { type UserSnapshot } from './types.js'
import { sortUsers } from './normalize.js'

/**
 * Compute added/removed users between two lists, matched by user ID.
 * A missing `previous` is treated as empty.
 */
export function diffUsers(
  previous: UserSnapshot[] | undefined,
  current: UserSnapshot[]
): { added: UserSnapshot[]; removed: UserSnapshot[] } {
  const prevMap = new Map((previous ?? []).map((user) => [user.id, user]))
  const currMap = new Map(current.map((user) => [user.id, user]))

  const added = sortUsers(current.filter((user) => !prevMap.has(user.id)))
  const removed = sortUsers(
    (previous ?? []).filter((user) => !currMap.has(user.id))
  )

  return { added, removed }
}
