import express from 'express'
import cookieParser from 'cookie-parser'
import rateLimit from 'express-rate-limit'
import { authRouter } from './routes/auth.js'
import { programRouter } from './routes/program.js'
import { proposalsRouter } from './routes/proposals.js'
import { calendarRouter } from './routes/calendar.js'

export function createApp(db, _deps = {}) {
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

  app.get('/api/healthz', (req, res) => res.json({ ok: true }))
  app.use('/api', authRouter(db))
  // calendarRouter vor programRouter: dessen requireAuth darf den Cookie-freien Feed nicht abfangen.
  app.use('/api', calendarRouter(db))
  app.use('/api', programRouter(db))
  app.use('/api', proposalsRouter(db))

  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }))
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message || 'internal server error' })
  })
  return app
}
