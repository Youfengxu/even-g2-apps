import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { Plugin } from 'vite'

const APP_USER_AGENT = 'even-dev-restapi/0.1.0 (local development)'
const APP_REFERER = 'http://localhost:5176/'
const HOSTNAME_IP_CACHE_TTL_MS = 5 * 60_000

type HostnameIpCacheEntry = {
  address: string
  expiresAt: number
}

const hostnameIpCache = new Map<string, HostnameIpCacheEntry>()

function buildProxyHeaders(target: URL, resolvedAddress?: string): Headers {
  const headers = new Headers({
    Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
    'User-Agent': APP_USER_AGENT,
  })

  if (target.protocol === 'http:' || target.protocol === 'https:') {
    headers.set('Referer', APP_REFERER)
  }

  // Nominatim blocks anonymous/default clients; send an explicit app identity.
  if (target.hostname === 'nominatim.openstreetmap.org') {
    headers.set('Accept-Language', 'en')
  }

  if (resolvedAddress) {
    headers.set('Host', target.host)
  }

  return headers
}

function getHostnameCacheKey(target: URL): string {
  const port = target.port || (target.protocol === 'https:' ? '443' : '80')
  return `${target.protocol}//${target.hostname}:${port}`
}

function shouldUseHostnameIpCache(target: URL): boolean {
  return target.protocol === 'http:'
    && !isIP(target.hostname)
    && target.hostname !== 'localhost'
    && target.hostname !== '127.0.0.1'
}

async function resolveCachedAddress(target: URL): Promise<string | null> {
  if (!shouldUseHostnameIpCache(target)) {
    return null
  }

  const key = getHostnameCacheKey(target)
  const cached = hostnameIpCache.get(key)
  const now = Date.now()
  if (cached && cached.expiresAt > now) {
    return cached.address
  }

  const resolved = await lookup(target.hostname, { family: 4 })
  hostnameIpCache.set(key, {
    address: resolved.address,
    expiresAt: now + HOSTNAME_IP_CACHE_TTL_MS,
  })
  return resolved.address
}

function clearCachedAddress(target: URL): void {
  hostnameIpCache.delete(getHostnameCacheKey(target))
}

function buildResolvedTargetUrl(target: URL, resolvedAddress: string): URL {
  const resolvedUrl = new URL(target.toString())
  resolvedUrl.hostname = resolvedAddress
  return resolvedUrl
}

async function fetchUpstream(target: URL): Promise<Response> {
  const resolvedAddress = await resolveCachedAddress(target)
  const fetchTarget = resolvedAddress ? buildResolvedTargetUrl(target, resolvedAddress) : target

  try {
    return await fetch(fetchTarget, {
      method: 'GET',
      headers: buildProxyHeaders(target, resolvedAddress ?? undefined),
    })
  } catch (error) {
    if (!resolvedAddress) {
      throw error
    }

    clearCachedAddress(target)
    return fetch(target, {
      method: 'GET',
      headers: buildProxyHeaders(target),
    })
  }
}

export default function restapiProxy(): Plugin {
  return {
    name: 'restapi-proxy',
    configureServer(server) {
      server.middlewares.use('/__restapi_proxy', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('content-type', 'text/plain; charset=utf-8')
          res.end('Method Not Allowed')
          return
        }

        try {
          const parsed = new URL(req.url ?? '', 'http://localhost')
          const target = parsed.searchParams.get('url')?.trim() ?? ''
          if (!target || (!target.startsWith('http://') && !target.startsWith('https://'))) {
            res.statusCode = 400
            res.setHeader('content-type', 'text/plain; charset=utf-8')
            res.end('Missing or invalid "url" query parameter')
            return
          }

          const targetUrl = new URL(target)
          const upstream = await fetchUpstream(targetUrl)
          const body = await upstream.text()
          const contentType = upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8'

          res.statusCode = upstream.status
          res.setHeader('content-type', contentType)
          res.end(body)
        } catch (error) {
          res.statusCode = 502
          res.setHeader('content-type', 'text/plain; charset=utf-8')
          const message = error instanceof Error ? error.message : String(error)
          res.end(`Proxy request failed: ${message}`)
        }
      })
    },
  }
}
