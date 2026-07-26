import path from 'node:path'
import { TwitterOpenApi } from 'twitter-openapi-typescript'
import { Logger } from '@book000/node-utils'
import { diffUsers } from './core/diff.js'
import { normalizeUserSnapshot } from './core/normalize.js'
import { type DiffFile, type SnapshotFile } from './core/types.js'
import { fetchAllUsers } from './app/fetch-users.js'
import { cycleTLSFetchWithProxy, cleanupCycleTLS } from './infra/cycletls.js'
import {
  OUTPUT_DIR,
  getCredentials,
  getDiscordConfig,
  getTargetUsername,
} from './infra/config.js'
import { readJsonFile, writeJsonFile } from './infra/fs.js'
import { getAuthCookies } from './infra/auth.js'
import { withRetry } from './core/retry.js'
import { sendDiscordNotification } from './presentation/discord.js'

const logger = Logger.configure('main')

/**
 * GlitchTip へ転送されるログメッセージの最大文字数。
 * サードパーティ API のエラーには HTTP レスポンスヘッダーやボディ全体が
 * message に埋め込まれることがあるため、外部送信時の情報量を抑える。
 */
const MAX_ERROR_MESSAGE_LENGTH = 2000

/**
 * エラーメッセージが長すぎる場合に切り詰める。
 * @param message - 元のメッセージ。
 * @returns 切り詰め後のメッセージ。
 */
function truncateMessage(message: string): string {
  if (message.length <= MAX_ERROR_MESSAGE_LENGTH) {
    return message
  }
  return `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}... [truncated]`
}

/**
 * unknown な例外情報を Error に変換する。
 * Error 以外の値は JSON.stringify で構造化情報を保持しつつ、
 * シリアライズできない場合のみ String() にフォールバックする。
 * @param error - 例外情報。
 * @returns Error インスタンス。
 */
function toError(error: unknown): Error {
  if (error instanceof Error) {
    if (error.message.length <= MAX_ERROR_MESSAGE_LENGTH) {
      return error
    }
    return new Error(truncateMessage(error.message))
  }
  try {
    return new Error(truncateMessage(JSON.stringify(error)))
  } catch {
    return new Error(truncateMessage(String(error)))
  }
}

/**
 * メイン処理。
 * @returns なし。
 */
async function main(): Promise<void> {
  let exitCode = 0
  try {
    const credentials = getCredentials()
    const discordConfig = getDiscordConfig()
    const targetUsername = getTargetUsername(credentials.username)

    logger.info('Target user resolved.')

    const { authToken, ct0 } = await getAuthCookies(credentials)
    TwitterOpenApi.fetchApi = cycleTLSFetchWithProxy

    const api = new TwitterOpenApi()
    const client = await api.getClientFromCookies({
      auth_token: authToken,
      ct0,
    })

    const targetResponse = await withRetry(
      () =>
        client.getUserApi().getUserByScreenName({
          screenName: targetUsername,
        }),
      {
        maxRetries: 3,
        baseDelayMs: 2000,
        operationName: 'Resolve user',
      }
    )

    const targetUser =
      normalizeUserSnapshot(targetResponse.data) ??
      normalizeUserSnapshot({ user: targetResponse.data.user })
    if (!targetUser) {
      throw new Error(`Failed to resolve user: ${targetUsername}`)
    }

    const targetUserId = targetUser.id

    const followers = await fetchAllUsers('Followers', (cursor) =>
      client.getUserListApi().getFollowers({
        userId: targetUserId,
        cursor,
        count: 200,
      })
    )

    const following = await fetchAllUsers('Following', (cursor) =>
      client.getUserListApi().getFollowing({
        userId: targetUserId,
        cursor,
        count: 200,
      })
    )

    const targetDir = path.join(
      OUTPUT_DIR,
      targetUsername.replaceAll(/[^a-zA-Z0-9_-]/g, '_')
    )

    const followersPath = path.join(targetDir, 'followers.json')
    const followingPath = path.join(targetDir, 'following.json')
    const diffPath = path.join(targetDir, 'diff.json')

    const previousFollowers = readJsonFile(followersPath) as SnapshotFile | null
    const previousFollowing = readJsonFile(followingPath) as SnapshotFile | null

    const followersFetchedAt = new Date().toISOString()
    const followingFetchedAt = new Date().toISOString()

    const followersSnapshot: SnapshotFile = {
      targetUsername,
      targetUserId,
      fetchedAt: followersFetchedAt,
      users: followers,
    }

    const followingSnapshot: SnapshotFile = {
      targetUsername,
      targetUserId,
      fetchedAt: followingFetchedAt,
      users: following,
    }

    writeJsonFile(followersPath, followersSnapshot)
    writeJsonFile(followingPath, followingSnapshot)

    if (previousFollowers || previousFollowing) {
      const followersDiff = diffUsers(previousFollowers?.users, followers)
      const followingDiff = diffUsers(previousFollowing?.users, following)

      const diff: DiffFile = {
        targetUsername,
        targetUserId,
        generatedAt: new Date().toISOString(),
        previousFetchedAt: {
          followers: previousFollowers?.fetchedAt ?? null,
          following: previousFollowing?.fetchedAt ?? null,
        },
        currentFetchedAt: {
          followers: followersFetchedAt,
          following: followingFetchedAt,
        },
        followers: followersDiff,
        following: followingDiff,
      }

      writeJsonFile(diffPath, diff)

      logger.info(
        `Followers: +${followersDiff.added.length} / -${followersDiff.removed.length}`
      )
      logger.info(
        `Following: +${followingDiff.added.length} / -${followingDiff.removed.length}`
      )

      const totalChanges =
        followersDiff.added.length +
        followersDiff.removed.length +
        followingDiff.added.length +
        followingDiff.removed.length

      if (totalChanges > 0 && discordConfig?.webhookUrl) {
        await sendDiscordNotification(discordConfig.webhookUrl, {
          targetUsername,
          checkedAt: new Date().toISOString(),
          followers: followersDiff,
          following: followingDiff,
        })
      }
    } else {
      logger.info('Snapshot saved. No previous data to diff.')
    }

    logger.info(
      `Saved followers (${followers.length}) and following (${following.length}).`
    )
  } catch (error) {
    logger.error('Fatal error occurred', toError(error))
    exitCode = 1
  } finally {
    await cleanupCycleTLS()
    Logger.closeAll()
  }

  process.exitCode = exitCode
}

main().catch((error: unknown) => {
  // main() の finally 内で Logger.closeAll() 済みのためキャッシュがクリアされており、
  // モジュールスコープの logger をそのまま使うとログが失われる可能性がある。再取得する。
  const finalLogger = Logger.configure('main')
  finalLogger.error('Fatal error occurred', toError(error))
  Logger.closeAll()
  process.exitCode = 1
})
