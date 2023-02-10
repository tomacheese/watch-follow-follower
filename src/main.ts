import { loadConfig, PATH } from './config'
import { Logger } from './logger'
import { TwApi } from './twitter'
import { IUserData, UsersManager } from './users-manager'
import { sendDiscordMessage, sliceArray } from './utils'

interface IUserStatusCodes {
  [key: string]: number | undefined
}

async function getUserData(twApi: TwApi, manager: UsersManager, ids: string[]) {
  // キャッシュに存在するユーザーのデータを取得
  // キャッシュに存在しない場合は getTwitterUsersData メソッドで取得
  const users: IUserData[] = [] // ユーザーのデータを格納する配列
  const notCachedIds = [] // キャッシュに存在しないユーザーの ID を格納する配列
  for (const id of ids) {
    const user = manager.getUserData(id)
    if (user) {
      users.push(user)
    } else {
      notCachedIds.push(id)
    }
  }

  // users/lookup は 100 件までしか取得できないので、100 件ごとに分割して取得
  const slicedIds = sliceArray(notCachedIds, 100)
  for (const ids of slicedIds) {
    const newUsers = await twApi.getUsersById(ids)
    users.push(
      ...newUsers.map((user) => ({
        user_id: user.id_str,
        name: user.name,
        screen_name: user.screen_name,
      }))
    )
    for (const user of newUsers.map((user) => ({
      user_id: user.id_str,
      name: user.name,
      screen_name: user.screen_name,
    }))) {
      manager.setUserData(user)
    }
  }

  return users
}

async function checkFollow(
  manager: UsersManager,
  twApi: TwApi,
  type: 'follow' | 'follower'
): Promise<{ newIds: string[]; removedIds: string[] }> {
  const getPreviousIdsMethod =
    type === 'follow'
      ? manager.getFollowIds.bind(manager)
      : manager.getFollowerIds.bind(manager)
  const getIdsMethod =
    type === 'follow'
      ? twApi.getFollowingIds.bind(twApi)
      : twApi.getFollowersIds.bind(twApi)
  const setIdsMethod =
    type === 'follow'
      ? manager.setFollowIds.bind(manager)
      : manager.setFollowerIds.bind(manager)

  /** 前回フォローしていた/フォロワーだったユーザーの ID */
  const previousIds = getPreviousIdsMethod()
  /** 現在フォローしている/フォロワーなユーザーの ID */
  const nowIds = await getIdsMethod()

  /** 新しくフォローした/フォロワーのユーザー ID */
  const newIds = nowIds.filter((id) => !previousIds.includes(id))
  /** フォローを外した/フォロワーではなくなったユーザーの ID */
  const removedIds = previousIds.filter((id) => !nowIds.includes(id))

  // 次回のチェックのためにフォローしている/フォロワーなユーザーの ID を保存
  setIdsMethod(nowIds)

  return {
    newIds,
    removedIds,
  }
}

function formatUser(
  userDataes: IUserData[],
  userStatusCodes: IUserStatusCodes,
  userId: string
) {
  const userData = userDataes.find((data) => data.user_id === userId)
  const userStatusCode = userStatusCodes[userId] || 'NULL'
  if (!userData) {
    return `*?* *@?* (${userStatusCode} https://twitter.com/i/user/${userId}`
  }
  return `\`${userData.name}\` \`@${userData.screen_name}\` (${userStatusCode}) https://twitter.com/i/user/${userId}`
}

async function main() {
  const logger = Logger.configure('main')
  logger.info('✨ main()')

  const config = loadConfig()
  const twApi = new TwApi(config)
  const manager = new UsersManager(PATH.USERS_FILE)

  const isFirstLoad = manager.isFirstLoad

  const { newIds: newFollowIds, removedIds: removedFollowIds } =
    await checkFollow(manager, twApi, 'follow')
  const { newIds: newFollowerIds, removedIds: removedFollowerIds } =
    await checkFollow(manager, twApi, 'follower')
  logger.info(
    `🆕 New following: ${newFollowIds.length} / New follower: ${newFollowerIds.length}`
  )
  logger.info(
    `👋 Unfollowing: ${removedFollowIds.length} / Unfollower: ${removedFollowerIds.length}`
  )

  // ユーザーデータを取得
  const userDataes = await Promise.all([
    getUserData(twApi, manager, newFollowIds),
    getUserData(twApi, manager, newFollowerIds),
    getUserData(twApi, manager, removedFollowIds),
    getUserData(twApi, manager, removedFollowerIds),
  ]).then((data) => data.flat())

  // 通知する
  if (isFirstLoad) {
    // 初回実行時は通知しない
    logger.info('💚 First running... saved! Skip notification.')
    return
  }

  // 通知するユーザーのステータスコードを取得
  const userStatusCodes: IUserStatusCodes = {}
  for (const id of new Set([
    ...newFollowIds,
    ...newFollowerIds,
    ...removedFollowIds,
    ...removedFollowerIds,
  ])) {
    // userStatusCodes[id] = await getTwitterUserStatusCode(twitterApi, id)
    userStatusCodes[id] = -1 // TODO
  }

  // 通知する : フォローした
  const newFollowUsers = newFollowIds.map((id) =>
    formatUser(userDataes, userStatusCodes, id)
  )
  if (newFollowUsers.length > 0) {
    logger.info(`📣 Notification: New follow users`)
    sendDiscordMessage(
      config.discord.follow,
      `:new: **New follow users**\n` + newFollowUsers.join('\n')
    )
  }

  // 通知する : フォロー解除した
  const removedFollowUsers = removedFollowIds.map((id) =>
    formatUser(userDataes, userStatusCodes, id)
  )
  if (removedFollowUsers.length > 0) {
    logger.info(`📣 Notification: Unfollow users`)
    sendDiscordMessage(
      config.discord.follow,
      `:wave: **Unfollow users**\n` + removedFollowUsers.join('\n')
    )
  }

  // 通知する : フォロワーになった
  const newFollowerUsers = newFollowerIds.map((id) =>
    formatUser(userDataes, userStatusCodes, id)
  )
  if (newFollowerUsers.length > 0) {
    logger.info(`📣 Notification: New follower users`)
    sendDiscordMessage(
      config.discord.follower,
      `:new: **New follower users**\n` + newFollowerUsers.join('\n')
    )
  }

  // 通知する : フォロワーではなくなった
  const removedFollowerUsers = removedFollowerIds.map((id) =>
    formatUser(userDataes, userStatusCodes, id)
  )
  if (removedFollowerUsers.length > 0) {
    logger.info(`📣 Notification: Unfollower users`)
    sendDiscordMessage(
      config.discord.follower,
      `:wave: **Unfollower users**\n` + removedFollowerUsers.join('\n')
    )
  }
}

;(async () => {
  await main()
})()
