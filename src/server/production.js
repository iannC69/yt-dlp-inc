import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { configureNewBackend } from './index.js'
import { configureRoutes } from './configure-routes.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * A minimal Connect-compatible middleware dispatcher.
 * Handles path-prefix mounting with req.url stripping — matching Vite's connect behaviour.
 */
class ConnectStack {
  constructor() { this._layers = [] }

  use(mountPath, handler) {
    if (typeof mountPath === 'function') {
      this._layers.push({ path: null, handler: mountPath })
    } else {
      this._layers.push({ path: mountPath, handler })
    }
  }

  dispatch(req, res, final) {
    let i = 0
    const next = () => {
      if (i >= this._layers.length) { if (final) final(); return }
      const layer = this._layers[i++]
      const reqPathname = req.url.split('?')[0]

      if (!layer.path) {
        return layer.handler(req, res, next)
      }
      if (!reqPathname.startsWith(layer.path)) {
        return next()
      }

      // Strip the mount path from req.url (connect behaviour)
      const saved = req.url
      req.url = req.url.slice(layer.path.length) || '/'
      if (!req.url.startsWith('/')) req.url = '/' + req.url

      layer.handler(req, res, () => {
        req.url = saved
        next()
      })
    }
    next()
  }
}

/**
 * Serve a single file from the filesystem, with basic MIME detection.
 */
function serveStaticFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase()
  const mimeMap = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.mjs':  'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico':  'image/x-icon',
    '.woff': 'font/woff',
    '.woff2':'font/woff2',
    '.ttf':  'font/ttf',
    '.webp': 'image/webp',
  }
  const stat = fs.statSync(filePath)
  res.writeHead(200, {
    'Content-Type': mimeMap[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000',
  })
  fs.createReadStream(filePath).pipe(res)
}

/**
 * Start the production HTTP server.
 *
 * @param {object} opts
 * @param {number} opts.port       Port to listen on (default 5174)
 * @param {string} opts.appDir     Writable app root (for config.json, downloads/, etc.)
 * @param {string} opts.binDir     Directory containing yt-dlp.exe / ffmpeg.exe / spotdl.exe
 * @param {string} opts.frontendDir Directory containing the Vite production build (dist/)
 * @param {string} [opts.ffmpegBin] Optional explicit ffmpeg binary path
 * @returns {Promise<http.Server>}
 */
export async function startProductionServer({ port = 5174, appDir, binDir, frontendDir, ffmpegBin } = {}) {
  const stack = new ConnectStack()
  const fakeServer = { middlewares: stack }

  // Register routes from src/server/index.js (config, logs, spotify test, etc.)
  configureNewBackend(fakeServer)

  // Register all download/API routes
  configureRoutes(stack, { appDir, binDir, ffmpegBin })

  const server = http.createServer((req, res) => {
    // CORS headers for all responses
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-spotify-client-id,x-spotify-client-secret,x-spotify-access-token')

    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }

    // Dispatch through API middleware layers first
    stack.dispatch(req, res, () => {
      // Fallback: serve static frontend files
      const pathname = req.url.split('?')[0]
      const candidate = path.join(frontendDir, pathname)

      // Prevent path traversal
      if (!candidate.startsWith(frontendDir)) {
        res.writeHead(403); return res.end('Forbidden')
      }

      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return serveStaticFile(candidate, res)
      }

      // SPA fallback — serve index.html for all unmatched routes
      const indexPath = path.join(frontendDir, 'index.html')
      if (fs.existsSync(indexPath)) {
        return serveStaticFile(indexPath, res)
      }

      res.writeHead(404)
      res.end('Not Found')
    })
  })

  await new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', resolve)
    server.on('error', reject)
  })

  console.log(`[production] Server listening on http://127.0.0.1:${port}`)
  return server
}
