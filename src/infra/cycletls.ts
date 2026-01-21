import { cycleTLSExit } from '@the-convocation/twitter-scraper/cycletls'
import initCycleTLS, { type CycleTLSClient } from 'cycletls'
import { Headers } from 'headers-polyfill'

/**
 * undici/Headers 互換の Headers 形状。
 */
interface HeadersLike {
  /** entries がある場合のイテレータ。 */
  entries?: () => IterableIterator<[string, string]>
  /** イテレータ対応（任意）。 */
  [Symbol.iterator]?: () => Iterator<[string, string]>
}

let cycleTLSInstancePromise: Promise<CycleTLSClient> | null = null

/**
 * CycleTLS インスタンスを初期化し、共有する。
 * @returns CycleTLS クライアント。
 */
async function initCycleTLSWithProxy(): Promise<CycleTLSClient> {
  cycleTLSInstancePromise ??= initCycleTLS()
  return cycleTLSInstancePromise
}

/**
 * CycleTLS を使った fetch 実装（プロキシ対応）。
 * @param input fetch の入力。
 * @param init fetch の初期化オプション。
 * @returns Fetch レスポンス。
 */
export async function cycleTLSFetchWithProxy(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const instance = await initCycleTLSWithProxy()
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url

  const method = (init?.method ?? 'GET').toUpperCase()

  const headers: Record<string, string> = {}
  if (init?.headers) {
    const h = init.headers as HeadersLike
    if (h.entries && typeof h.entries === 'function') {
      for (const [key, value] of h.entries()) {
        headers[key] = value
      }
    } else if (Array.isArray(init.headers)) {
      for (const [key, value] of init.headers) {
        headers[key] = value
      }
    } else if (h[Symbol.iterator] && typeof h[Symbol.iterator] === 'function') {
      for (const [key, value] of init.headers as unknown as Iterable<
        [string, string]
      >) {
        headers[key] = value
      }
    } else {
      Object.assign(headers, init.headers as Record<string, string>)
    }
  }

  let body: string | undefined
  if (init?.body) {
    if (typeof init.body === 'string') {
      body = init.body
    } else if (init.body instanceof URLSearchParams) {
      body = init.body.toString()
    } else {
      body = JSON.stringify(init.body)
    }
  }

  let proxy: string | undefined
  const proxyServer = process.env.PROXY_SERVER
  if (proxyServer) {
    const normalizedProxyServer =
      proxyServer.startsWith('http://') || proxyServer.startsWith('https://')
        ? proxyServer
        : `http://${proxyServer}`

    const proxyUsername = process.env.PROXY_USERNAME
    const proxyPassword = process.env.PROXY_PASSWORD
    if (proxyUsername && proxyPassword) {
      try {
        const proxyUrl = new URL(normalizedProxyServer)
        proxyUrl.username = proxyUsername
        proxyUrl.password = proxyPassword
        proxy = proxyUrl.toString()
      } catch {
        throw new Error(
          `Invalid PROXY_SERVER URL: ${proxyServer}. Expected format: host:port, http://host:port or https://host:port`
        )
      }
    } else {
      proxy = normalizedProxyServer
    }
  }

  const options: Record<string, unknown> = {
    body,
    headers,
    ja3: '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0',
    userAgent:
      headers['user-agent'] ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  }
  if (proxy) {
    options.proxy = proxy
  }

  const response = await instance(
    url,
    options,
    method.toLowerCase() as
      | 'head'
      | 'get'
      | 'post'
      | 'put'
      | 'delete'
      | 'trace'
      | 'options'
      | 'connect'
      | 'patch'
  )

  const responseHeaders = new Headers()
  for (const [key, value] of Object.entries(response.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) {
        responseHeaders.append(key, v)
      }
    } else if (typeof value === 'string') {
      responseHeaders.set(key, value)
    }
  }

  let responseBody: string
  if (response.data !== undefined && response.data !== null) {
    responseBody =
      typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data)
  } else {
    responseBody = ''
  }

  return new Response(responseBody, {
    status: response.status,
    statusText: '',
    headers: responseHeaders,
  })
}

/**
 * CycleTLS インスタンスを終了する。
 * @returns なし。
 */
export async function cleanupCycleTLS(): Promise<void> {
  if (cycleTLSInstancePromise) {
    try {
      const instance = await cycleTLSInstancePromise
      await instance.exit()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.warn(`CycleTLS instance exit failed: ${message}`)
    }
  }
  try {
    cycleTLSExit()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.debug(
      `twitter-scraper CycleTLS exit error (may not be initialized): ${message}`
    )
  }
}
