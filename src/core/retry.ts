/**
 * 指数バックオフ付きの汎用リトライ。
 * @typeParam T 返却型。
 * @param fn 実行する関数。
 * @param options リトライ設定。
 * @returns 成功時の戻り値。
 */
/**
 * 429 の Rate Limit から待機時間を計算する。
 * @param error 例外。
 * @returns 待機ミリ秒。判定できない場合は null。
 */
export function getRateLimitDelayMs(error: unknown): number | null {
  const err = error as { response?: Response; message?: string }
  const response = err.response
  if (!response || response.status !== 429) {
    return null
  }
  const resetHeader = response.headers.get('x-rate-limit-reset')
  const remaining = response.headers.get('x-rate-limit-remaining')
  const limit = response.headers.get('x-rate-limit-limit')
  if (resetHeader) {
    const resetSeconds = Number(resetHeader)
    if (!Number.isNaN(resetSeconds) && resetSeconds > 0) {
      const resetMs = resetSeconds * 1000
      const now = Date.now()
      const waitMs = Math.max(resetMs - now, 1000)
      const resetTime = new Date(resetMs).toISOString()
      console.warn(
        `Rate limit hit (remaining ${remaining ?? 'unknown'}/${limit ?? 'unknown'}). Reset at ${resetTime}.`
      )
      return waitMs + 2000
    }
  }
  if (err.message) {
    console.warn(`Rate limit hit: ${err.message}`)
  }
  return 30_000
}

/**
 * 指数バックオフ付きの汎用リトライ。
 * @typeParam T 返却型。
 * @param fn 実行する関数。
 * @param options リトライ設定。
 * @returns 成功時の戻り値。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number
    baseDelayMs?: number
    maxDelayMs?: number
    operationName?: string
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30_000,
    operationName = 'operation',
  } = options

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error: unknown) {
      if (attempt >= maxRetries) {
        throw error
      }
      const rateLimitDelay = getRateLimitDelayMs(error)
      const delay =
        rateLimitDelay ??
        Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs)
      const delaySeconds = Math.ceil(delay / 1000)
      if (rateLimitDelay) {
        console.warn(
          `${operationName} hit rate limit, retrying in ${delaySeconds}s...`
        )
      } else {
        console.warn(
          `${operationName} failed (attempt ${attempt}/${maxRetries}), retrying in ${delaySeconds}s...`
        )
      }
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw new Error(`${operationName} failed after ${maxRetries} attempts`)
}
