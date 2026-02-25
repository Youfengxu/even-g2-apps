import type { Plugin } from 'vite'

type PhoneNotification = {
  app: string
  title: string
  text: string
  timestamp: number
}

export default function notifServer(): Plugin {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sseClients = new Set<any>()

  function broadcast(notification: PhoneNotification): void {
    const data = `data: ${JSON.stringify(notification)}\n\n`
    for (const client of sseClients) {
      client.write(data)
    }
    console.log(`[notif-server] broadcast to ${sseClients.size} client(s): [${notification.app}] ${notification.title}`)
  }

  return {
    name: 'notif-server',
    configureServer(server) {
      // SSE stream — must be registered before /api/notif to avoid prefix match
      server.middlewares.use('/api/notif/stream', (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end()
          return
        }

        res.statusCode = 200
        res.setHeader('content-type', 'text/event-stream')
        res.setHeader('cache-control', 'no-cache')
        res.setHeader('connection', 'keep-alive')
        res.setHeader('access-control-allow-origin', '*')
        res.write('data: {"type":"connected"}\n\n')

        sseClients.add(res)
        console.log(`[notif-server] SSE client connected (total: ${sseClients.size})`)

        req.on('close', () => {
          sseClients.delete(res)
          console.log(`[notif-server] SSE client disconnected (total: ${sseClients.size})`)
        })
      })

      // POST endpoint to receive notifications from Android
      server.middlewares.use('/api/notif', (req, res) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.setHeader('access-control-allow-origin', '*')
          res.setHeader('access-control-allow-methods', 'POST, OPTIONS')
          res.setHeader('access-control-allow-headers', 'content-type')
          res.end()
          return
        }

        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }

        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk.toString() })
        req.on('end', () => {
          try {
            const payload = JSON.parse(body) as Partial<PhoneNotification>
            const notification: PhoneNotification = {
              app: String(payload.app ?? ''),
              title: String(payload.title ?? ''),
              text: String(payload.text ?? ''),
              timestamp: Date.now(),
            }
            broadcast(notification)
            res.statusCode = 200
            res.setHeader('content-type', 'application/json')
            res.setHeader('access-control-allow-origin', '*')
            res.end(JSON.stringify({ ok: true }))
          } catch {
            res.statusCode = 400
            res.setHeader('content-type', 'text/plain')
            res.end('Invalid JSON')
          }
        })
      })
    },
  }
}
