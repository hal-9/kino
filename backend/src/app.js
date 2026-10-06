import express from 'express'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import { authRouter } from './routes/auth.js'
import { programRouter } from './routes/program.js'
import { proposalsRouter } from './routes/proposals.js'
import { visitsRouter } from './routes/visits.js'
import { moviesRouter } from './routes/movies.js'
import { statsRouter } from './routes/stats.js'
import { calendarRouter } from './routes/calendar.js'
import { planningRouter } from './routes/planning.js'
import { radarRouter } from './routes/radar.js'
import { roomsRouter } from './routes/rooms.js'
import { ticketFilesRouter } from './routes/ticketFiles.js'
import { reactionsRouter } from './routes/reactions.js'

export function createApp(db, deps = {}) {
  const app = express()
  // Genau ein Proxy-Hop (Caddy), sonst zaehlt das Rate-Limit die Proxy-IP.
  app.set('trust proxy', 1)
  // Kleine JSON-Bodies reichen (Snapshot-JSON der Vorschläge, Logins); alles andere ist Missbrauch.
  app.use(express.json({ limit: '64kb' }))
  app.use(cookieParser())
  // Grobe Bremse pro IP gegen Skripte. Eine Familie
  // hinter einer IP mit 4 Handys und 10-s-Polling bleibt weit darunter.
  app.use(
    '/api',
    rateLimit({ windowMs: 15 * 60 * 1000, limit: 3000, standardHeaders: true, legacyHeaders: false, message: { error: 'too many requests' } })
  )
  // Keine API-Antwort darf gecacht oder als Frame eingebettet werden.
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', res.get('Cache-Control') ?? 'no-store')
    res.set('X-Content-Type-Options', 'nosniff')
    next()
  })

  // Schreibende Browser-Anfragen nur von der eigenen Origin: Nachbar-Subdomains derselben Site (*.tunikb.com)
  // bekommen das SameSite=Lax-Cookie mit. Ohne Origin-Header (curl, Kalender-Clients) unverändert.
  app.use('/api', (req, res, next) => {
    const origin = req.get('Origin')
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || origin === undefined) return next()
    let host = null
    try { host = new URL(origin).host } catch {}
    if (host !== req.get('host')) return res.status(403).json({ error: 'forbidden origin' })
    next()
  })

  // Liveness (Prozess antwortet) getrennt von Readiness (DB lesbar). Öffentlich, daher nur ok/nicht ok;
  // Quellen-Frische steht authentifiziert unter /api/sources.
  app.get('/api/healthz', (req, res) => res.json({ ok: true }))
  app.get('/api/readyz', (req, res) => {
    try {
      db.prepare('SELECT COUNT(*) FROM schema_migrations').get()
      res.json({ ok: true, db: 'ok' })
    } catch {
      res.status(503).json({ ok: false, db: 'unavailable' })
    }
  })
  app.use('/api', authRouter(db))
  // calendarRouter vor programRouter: dessen requireAuth darf den Cookie-freien Feed nicht abfangen.
  app.use('/api', calendarRouter(db))
  app.use('/api', programRouter(db))
  app.use('/api', proposalsRouter(db))
  app.use('/api', visitsRouter(db, deps))
  app.use('/api', statsRouter(db))
  app.use('/api', moviesRouter(db, deps))
  app.use('/api', planningRouter(db))
  app.use('/api', radarRouter(db, deps))
  app.use('/api', roomsRouter(db))
  app.use('/api', ticketFilesRouter(db))
  app.use('/api', reactionsRouter(db))

  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }))
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message || 'internal server error' })
  })
  return app
}
