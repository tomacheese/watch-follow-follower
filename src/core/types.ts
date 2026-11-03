/**
 * User info normalized for snapshot output.
 */
export interface UserSnapshot {
  /** User ID (`restId`). */
  id: string
  /** Screen name without the leading `@`. */
  screenName: string
  name: string
  /** Legacy verified flag. */
  verified: boolean
  /** Blue (paid) verification flag. */
  isBlueVerified: boolean
  protected: boolean
}

/**
 * Snapshot file (`followers.json` / `following.json`) persisted to disk.
 */
export interface SnapshotFile {
  targetUsername: string
  targetUserId: string
  /** Fetch time (ISO string). */
  fetchedAt: string
  users: UserSnapshot[]
}

/**
 * Diff file (`diff.json`) persisted to disk.
 */
export interface DiffFile {
  targetUsername: string
  targetUserId: string
  /** Diff generation time (ISO string). */
  generatedAt: string
  previousFetchedAt: {
    /** Previous followers fetch time (null if none). */
    followers: string | null
    /** Previous following fetch time (null if none). */
    following: string | null
  }
  currentFetchedAt: {
    /** Current followers fetch time. */
    followers: string
    /** Current following fetch time. */
    following: string
  }
  followers: {
    added: UserSnapshot[]
    removed: UserSnapshot[]
  }
  following: {
    added: UserSnapshot[]
    removed: UserSnapshot[]
  }
}
