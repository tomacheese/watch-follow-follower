import { type UserSnapshot } from './types.js'

/**
 * Normalize an API response item to a `UserSnapshot`.
 * Returns null if the user ID or screen name cannot be resolved.
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
  if (!restId) {
    return null
  }
  const legacy = user.legacy as
    | {
        screenName?: string
        screen_name?: string
        name?: string
        verified?: boolean
        protected?: boolean
      }
    | undefined
  // Since twitter-openapi v0.0.56, screen_name / name moved from legacy to core
  const core = user.core as { screenName?: string; name?: string } | undefined

  const screenName =
    legacy?.screenName ?? legacy?.screen_name ?? core?.screenName
  if (!screenName) {
    return null
  }
  const name = legacy?.name ?? core?.name ?? ''

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
 * Sort users by screen name, then ID, for a stable order. Does not mutate the input.
 */
export function sortUsers(users: UserSnapshot[]): UserSnapshot[] {
  return users.toSorted((a, b) => {
    const nameCompare = a.screenName.localeCompare(b.screenName, 'en')
    return nameCompare === 0 ? a.id.localeCompare(b.id, 'en') : nameCompare
  })
}
