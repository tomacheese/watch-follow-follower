/**
 * スナップショット出力用に正規化したユーザー情報。
 */
export interface UserSnapshot {
  /** ユーザー ID（restId）。 */
  id: string
  /** スクリーンネーム（@なし）。 */
  screenName: string
  /** 表示名。 */
  name: string
  /** 従来の認証済みフラグ。 */
  verified: boolean
  /** Blue 認証フラグ。 */
  isBlueVerified: boolean
  /** 非公開アカウントフラグ。 */
  protected: boolean
}

/**
 * ディスクに保存するスナップショットファイル。
 */
export interface SnapshotFile {
  /** 対象のスクリーンネーム。 */
  targetUsername: string
  /** 対象のユーザー ID。 */
  targetUserId: string
  /** 取得時刻（ISO 文字列）。 */
  fetchedAt: string
  /** スナップショットのユーザー一覧。 */
  users: UserSnapshot[]
}

/**
 * ディスクに保存する差分ファイル。
 */
export interface DiffFile {
  /** 対象のスクリーンネーム。 */
  targetUsername: string
  /** 対象のユーザー ID。 */
  targetUserId: string
  /** 差分生成時刻（ISO 文字列）。 */
  generatedAt: string
  previousFetchedAt: {
    /** 前回の followers 取得時刻（なければ null）。 */
    followers: string | null
    /** 前回の following 取得時刻（なければ null）。 */
    following: string | null
  }
  currentFetchedAt: {
    /** 今回の followers 取得時刻。 */
    followers: string
    /** 今回の following 取得時刻。 */
    following: string
  }
  followers: {
    /** 追加された followers。 */
    added: UserSnapshot[]
    /** 削除された followers。 */
    removed: UserSnapshot[]
  }
  following: {
    /** 追加された following。 */
    added: UserSnapshot[]
    /** 削除された following。 */
    removed: UserSnapshot[]
  }
}
