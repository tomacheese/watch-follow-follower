import axios, { AxiosInstance } from 'axios'
import { TwitterApi } from 'twitter-api-v2'
import { Configuration } from './config'

// see https://github.com/abraham/twitter-d/blob/main/types/user.d.ts
export interface User {
  created_at: string
  default_profile_image: boolean
  default_profile: boolean
  description?: string | null
  // entities: UserEntities
  favourites_count: number
  followers_count: number
  friends_count: number
  id_str: string
  id: number
  listed_count: number
  location?: string | null
  name: string
  profile_banner_url?: string
  profile_image_url_https: string
  protected: boolean
  screen_name: string
  // status?: Status
  statuses_count: number
  url?: string | null
  verified: boolean
  withheld_in_countries?: string[]
  withheld_scope?: string
}

export class TwApi {
  private twitterApi: TwitterApi | undefined
  private twApiAxios: AxiosInstance | undefined
  private targetUserId: string | undefined

  private users: User[] = []

  constructor(config: Configuration) {
    if (config.twitter) {
      this.twitterApi = new TwitterApi({
        appKey: config.twitter.consumer_key,
        appSecret: config.twitter.consumer_secret,
      })
      this.targetUserId = config.twitter.target_user_id
    }
    if (config.twapi) {
      this.twApiAxios = axios.create({
        baseURL: config.twapi.base_url,
        auth: {
          username: config.twapi.basic_username,
          password: config.twapi.basic_password,
        },
      })
      this.targetUserId = config.twapi.target_user_id
    }

    if (!this.twitterApi && !this.twApiAxios) {
      throw new Error('API is not initialized')
    }
  }

  public async getFollowingIds(): Promise<string[]> {
    if (this.twitterApi) {
      return await this.getFollowingIdsFromTwitterApi()
    }
    if (this.twApiAxios) {
      const users = await this.getFollowingFromTwApi()
      this.users.push(
        ...users.filter(
          (user) => !this.users.some((u) => u.id_str === user.id_str)
        )
      )
      return users.map((user) => user.id_str)
    }
    throw new Error('API is not initialized')
  }

  private async getFollowingIdsFromTwitterApi() {
    if (!this.twitterApi) {
      throw new Error('TwitterAPI is not initialized')
    }
    const follows = await this.twitterApi.v1.userFollowingIds({
      user_id: this.targetUserId,
      stringify_ids: true,
      count: 5000,
    })
    await follows.fetchLast()
    return follows.ids
  }

  private async getFollowingFromTwApi() {
    if (!this.twApiAxios) {
      throw new Error('TwAPI is not initialized')
    }
    const { data } = await this.twApiAxios.get<User[]>('/users/following', {
      params: {
        user_id: this.targetUserId,
        limit: 200,
      },
    })
    return data
  }

  public async getFollowersIds(): Promise<string[]> {
    if (this.twitterApi) {
      return await this.getFollowersIdsFromTwitterApi()
    }
    if (this.twApiAxios) {
      const users = await this.getFollowersFromTwApi()
      this.users.push(
        ...users.filter(
          (user) => !this.users.some((u) => u.id_str === user.id_str)
        )
      )
      return users.map((user) => user.id_str)
    }
    throw new Error('API is not initialized')
  }

  private async getFollowersIdsFromTwitterApi() {
    if (!this.twitterApi) {
      throw new Error('TwitterAPI is not initialized')
    }
    const follows = await this.twitterApi.v1.userFollowerIds({
      user_id: this.targetUserId,
      stringify_ids: true,
      count: 5000,
    })
    await follows.fetchLast()
    return follows.ids
  }

  private async getFollowersFromTwApi() {
    if (!this.twApiAxios) {
      throw new Error('TwAPI is not initialized')
    }
    const { data } = await this.twApiAxios.get<User[]>('/users/followers', {
      params: {
        user_id: this.targetUserId,
        limit: 200,
      },
    })
    return data
  }

  public async getUsersById(ids: string[]): Promise<User[]> {
    const users = this.users.filter((user) => ids.includes(user.id_str))
    if (users.length === ids.length) {
      return users
    }
    const idsToFetch = ids.filter((id) => !users.some((u) => u.id_str === id))
    if (this.twitterApi) {
      users.push(...(await this.getUsersByIdFromTwitterApi(idsToFetch)))
      return users
    }
    if (this.twApiAxios) {
      return await this.getUsersByIdFromTwApi(idsToFetch)
    }
    throw new Error('API is not initialized')
  }

  private async getUsersByIdFromTwitterApi(ids: string[]) {
    if (!this.twitterApi) {
      throw new Error('TwitterAPI is not initialized')
    }
    return await this.twitterApi.v1.users({
      user_id: ids,
      include_entities: false,
      skip_status: true,
    })
  }

  private async getUsersByIdFromTwApi(ids: string[]) {
    if (!this.twApiAxios) {
      throw new Error('TwAPI is not initialized')
    }
    const users: User[] = []
    for (const id of ids) {
      const user = await this.getUserByIdFromTwApi(id)
      users.push(...user)
    }
    return users
  }

  private async getUserByIdFromTwApi(id: string) {
    if (!this.twApiAxios) {
      throw new Error('TwAPI is not initialized')
    }
    const { data } = await this.twApiAxios.get<User[]>('/users', {
      params: {
        user_id: id,
      },
    })
    return data
  }
}
