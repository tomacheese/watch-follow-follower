import fs from 'node:fs'

export interface IUserData {
  user_id: string
  name: string
  screen_name: string
}

interface IUsersFile {
  ids: {
    follow: string[]
    follower: string[]
  }
  userdata: {
    [key: string]: IUserData
  }
}

/**
 * ユーザーのデータを管理するクラス
 */
export class UsersManager {
  private path: string
  private data: IUsersFile | undefined = undefined
  public readonly isFirstLoad: boolean

  constructor(path: string) {
    this.path = path

    if (fs.existsSync(path)) {
      this.isFirstLoad = false
      this.load()
    } else {
      this.isFirstLoad = true
      this.init()
    }
  }

  public getFollowIds(): string[] {
    if (!this.data) throw new Error('UsersManager is not loaded')
    return this.data.ids.follow
  }

  public getFollowerIds(): string[] {
    if (!this.data) throw new Error('UsersManager is not loaded')
    return this.data.ids.follower
  }

  /**
   * ユーザーのデータを返す。
   * データが存在しない場合は undefined を返す。
   *
   * @param userId ユーザー ID
   * @returns ユーザーのデータ
   */
  public getUserData(userId: string): IUserData | undefined {
    if (!this.data) throw new Error('UsersManager is not loaded')
    return this.data.userdata[userId]
  }

  /**
   * フォローしているユーザーを設定する
   * このメソッドを呼び出すと、フォローしているユーザーのデータが上書きされる。
   *
   * @param userIds ユーザー ID の配列
   */
  public setFollowIds(userIds: string[]): void {
    if (!this.data) throw new Error('UsersManager is not loaded')
    this.data.ids.follow = userIds
    this.save()
  }

  /**
   * フォローされているユーザーを設定する
   * このメソッドを呼び出すと、フォローされているユーザーのデータが上書きされる。
   *
   * @param userIds ユーザー ID の配列
   */
  public setFollowerIds(userIds: string[]): void {
    if (!this.data) throw new Error('UsersManager is not loaded')
    this.data.ids.follower = userIds
    this.save()
  }

  /**
   * ユーザーのデータを設定する
   * このメソッドを呼び出すと、ユーザーのデータが上書きされる。
   *
   * @param user ユーザーのデータ
   */
  public setUserData(user: IUserData): void {
    if (!this.data) throw new Error('UsersManager is not loaded')
    this.data.userdata[user.user_id] = user
    this.save()
  }

  /**
   * データを初期化する
   */
  public init(): void {
    this.data = {
      ids: {
        follow: [],
        follower: [],
      },
      userdata: {},
    }
    this.save()
  }

  /**
   * データを読み込む
   */
  public load(): void {
    this.data = JSON.parse(fs.readFileSync(this.path, 'utf8'))
  }

  /**
   * データを保存する
   */
  public save(): void {
    // eslint-disable-next-line unicorn/no-null
    fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2))
  }
}
