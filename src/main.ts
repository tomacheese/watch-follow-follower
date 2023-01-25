import { TwitterApi } from 'twitter-api-v2'
import { Configuration, loadConfig, loadTwitterApi, PATH } from './config'
import { IUserData, UsersManager } from './users-manager'
import {
  getTwitterFollowerIds,
  getTwitterFollowids,
  getTwitterUsersData,
  getTwitterUserStatusCode,
  sendDiscordMessage,
  sliceArray,
} from './utils'

interface IUserStatusCodes {
  [key: string]: number | undefined
}

async function getUserData(
  twitterApi: TwitterApi,
  manager: UsersManager,
  ids: string[]
) {
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
    const newUsers = await getTwitterUsersData(twitterApi, ids)
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
  config: Configuration,
  manager: UsersManager,
  twitterApi: TwitterApi,
  type: 'follow' | 'follower'
): Promise<{ newIds: string[]; removedIds: string[] }> {
  const getPreviousIdsMethod =
    type === 'follow'
      ? manager.getFollowIds.bind(manager)
      : manager.getFollowerIds.bind(manager)
  const getIdsMethod =
    type === 'follow' ? getTwitterFollowids : getTwitterFollowerIds
  const setIdsMethod =
    type === 'follow'
      ? manager.setFollowIds.bind(manager)
      : manager.setFollowerIds.bind(manager)

  /** 前回フォローしていた/フォロワーだったユーザーの ID */
  const previousIds = getPreviousIdsMethod()
  /** 現在フォローしている/フォロワーなユーザーの ID */
  const nowIds = await getIdsMethod(twitterApi, config.twitter.target_user_id)

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
    return `*?* *@?* (${userStatusCode} https://twitter.com/intent/user?user_id=${userId}`
  }
  return `\`${userData.name}\` \`@${userData.screen_name}\` (${userStatusCode}) https://twitter.com/intent/user?user_id=${userId}`
}

async function main() {
  const config = loadConfig()
  const twitterApi = await loadTwitterApi(config)
  const manager = new UsersManager(PATH.USERS_FILE)

  const isFirstLoad = manager.isFirstLoad

  const { newIds: newFollowIds, removedIds: removedFollowIds } =
    await checkFollow(config, manager, twitterApi, 'follow')
  const { newIds: newFollowerIds, removedIds: removedFollowerIds } =
    await checkFollow(config, manager, twitterApi, 'follower')

  // ユーザーデータを取得
  const userDataes = await Promise.all([
    getUserData(twitterApi, manager, newFollowIds),
    getUserData(twitterApi, manager, newFollowerIds),
    getUserData(twitterApi, manager, removedFollowIds),
    getUserData(twitterApi, manager, removedFollowerIds),
  ]).then((data) => data.flat())

  // 通知する
  if (isFirstLoad) {
    // 初回実行時は通知しない
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
    userStatusCodes[id] = await getTwitterUserStatusCode(twitterApi, id)
  }

  // 通知する : フォローした
  const newFollowUsers = newFollowIds.map((id) =>
    formatUser(userDataes, userStatusCodes, id)
  )
  if (newFollowUsers.length > 0) {
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
    sendDiscordMessage(
      config.discord.follow,
      `:new: **New follower users**\n` + newFollowerUsers.join('\n')
    )
  }

  // 通知する : フォロワーではなくなった
  const removedFollowerUsers = removedFollowerIds.map((id) =>
    formatUser(userDataes, userStatusCodes, id)
  )
  if (removedFollowerUsers.length > 0) {
    sendDiscordMessage(
      config.discord.follow,
      `:wave: **Unfollower users**\n` + removedFollowerUsers.join('\n')
    )
  }
}

;(async () => {
  await main()
})()
