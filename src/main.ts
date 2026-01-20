import path from 'node:path'
import { TwitterOpenApi } from 'twitter-openapi-typescript'
import { diffUsers } from './core/diff.js'
import { normalizeUserSnapshot } from './core/normalize.js'
import { type DiffFile, type SnapshotFile } from './core/types.js'
import { fetchAllUsers } from './app/fetchUsers.js'
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

    console.log(`Target user: @${targetUsername}`)

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
        operationName: `Resolve user @${targetUsername}`,
      },
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
      }),
    )

    const following = await fetchAllUsers('Following', (cursor) =>
      client.getUserListApi().getFollowing({
        userId: targetUserId,
        cursor,
        count: 200,
      }),
    )

    const targetDir = path.join(
      OUTPUT_DIR,
      targetUsername.replace(/[^a-zA-Z0-9_-]/g, '_'),
    )

    const followersPath = path.join(targetDir, 'followers.json')
    const followingPath = path.join(targetDir, 'following.json')
    const diffPath = path.join(targetDir, 'diff.json')

    const previousFollowers = readJsonFile<SnapshotFile>(followersPath)
    const previousFollowing = readJsonFile<SnapshotFile>(followingPath)

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

      console.log(
        `Followers: +${followersDiff.added.length} / -${followersDiff.removed.length}`,
      )
      console.log(
        `Following: +${followingDiff.added.length} / -${followingDiff.removed.length}`,
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
      console.log('Snapshot saved. No previous data to diff.')
    }

    console.log(
      `Saved followers (${followers.length}) and following (${following.length}) to ${targetDir}`,
    )
  } catch (error) {
    console.error('Fatal error occurred', error)
    exitCode = 1
  } finally {
    await cleanupCycleTLS()
  }

  process.exit(exitCode)
}

main()
