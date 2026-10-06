import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api.js'
import { QueryError } from '../components/QueryStatus.jsx'

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const day = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })

function tilesOf(r) {
  const t = (name, v, sub) => v != null && { name, value: v, sub }
  return [
    t('Besuche', r.count),
    t('Stunden im Kino', Math.round(r.minutes / 60)),
    r.ov_share != null && t('OV-Anteil', `${Math.round(r.ov_share * 100)} %`),
    r.top_cinema && t('Lieblingskino', r.top_cinema.name, `${r.top_cinema.count}×`),
    r.top_auditorium && t('Lieblingssaal', r.top_auditorium.name.split(' · ').pop(), `${r.top_auditorium.name.split(' · ')[0]} · ${r.top_auditorium.count}×`),
    r.top_row && t('Häufigste Reihe', `Reihe ${r.top_row.name}`, `${r.top_row.count}×`),
    r.top_companion && t('Treueste Begleitung', r.top_companion.name, `${r.top_companion.count}×`),
    r.top_month && t('Top-Monat', MONTHS[r.top_month.month - 1], `${r.top_month.count} ${r.top_month.count === 1 ? "Besuch" : "Besuche"}`),
    r.first && t('Erster Film', r.first.title, day(r.first.date)),
    r.last && t('Letzter Film', r.last.title, day(r.last.date)),
  ].filter(Boolean)
}

function wrap(ctx, text, maxW) {
  const lines = []
  let line = ''
  for (const w of text.split(' ')) {
    const next = line ? `${line} ${w}` : w
    if (line && ctx.measureText(next).width > maxW) { lines.push(line); line = w } else line = next
  }
  return [...lines, line]
}

function render(r, tiles, title) {
  const c = document.createElement('canvas')
  c.width = 1080
  c.height = 1920
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, 1080, 1920)
  g.addColorStop(0, '#a8323f')
  g.addColorStop(1, '#e0705c')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 1080, 1920)
  ctx.fillStyle = '#fff'
  ctx.font = '700 84px system-ui, sans-serif'
  ctx.fillText(title, 72, 190)
  ctx.font = '500 40px system-ui, sans-serif'
  ctx.globalAlpha = 0.85
  ctx.fillText('LiLief-Kino', 72, 250)
  ctx.globalAlpha = 1
  const cols = 2, w = 456, h = 280, gap = 40
  tiles.slice(0, 10).forEach((t, i) => {
    const x = 72 + (i % cols) * (w + gap)
    const y = 330 + Math.floor(i / cols) * (h + gap)
    ctx.fillStyle = 'rgba(255,255,255,0.18)'
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 36)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = '500 30px system-ui, sans-serif'
    ctx.fillText(t.name, x + 32, y + 28 + 30)
    ctx.font = '700 56px system-ui, sans-serif'
    wrap(ctx, String(t.value), w - 64).slice(0, 2).forEach((l, k) => ctx.fillText(l, x + 32, y + 130 + k * 62))
    if (t.sub) {
      ctx.font = '500 28px system-ui, sans-serif'
      ctx.globalAlpha = 0.85
      ctx.fillText(t.sub, x + 32, y + h - 32)
      ctx.globalAlpha = 1
    }
  })
  return c
}

async function share(r, tiles, title) {
  const blob = await new Promise((res) => render(r, tiles, title).toBlob(res, 'image/png'))
  const file = new File([blob], `kino-wrapped-${r.year}.png`, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return } catch (e) { if (e.name === 'AbortError') return }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

export default function Wrapped() {
  const [year, setYear] = useState(new Date().getFullYear())
  const [scope, setScope] = useState('me')
  const query = useQuery({ queryKey: ['wrapped', year, scope], queryFn: () => api.get(`/stats/wrapped?year=${year}&scope=${scope}`) })
  const { data: r, isLoading } = query
  const tiles = r ? tilesOf(r) : []
  const title = scope === 'me' ? `Mein Kinojahr ${year}` : `Unser Kinojahr ${year}`

  return (
    <>
      <div className="chips-row">
        <button className="chip" onClick={() => setYear(year - 1)}>‹ {year - 1}</button>
        <button className="chip active">{year}</button>
        {year < new Date().getFullYear() && <button className="chip" onClick={() => setYear(year + 1)}>{year + 1} ›</button>}
        <button className={`chip${scope === 'me' ? ' active' : ''}`} onClick={() => setScope('me')}>Ich</button>
        <button className={`chip${scope === 'group' ? ' active' : ''}`} onClick={() => setScope('group')}>Gruppe</button>
      </div>
      {isLoading && <p className="muted">Lädt…</p>}
      <QueryError query={query} label="Statistiken" />
      {r?.count === 0 && <div className="empty"><h2>Keine Besuche {year}</h2><p>Trag Kinobesuche ein, dann erscheint hier deine Statistik.</p></div>}
      {tiles.length > 0 && (
        <>
          <div className="tiles">
            {tiles.map((t) => (
              <div key={t.name} className="card tile">
                <div className="muted">{t.name}</div>
                <div className="tile-num">{t.value}</div>
                {t.sub && <div className="muted">{t.sub}</div>}
              </div>
            ))}
          </div>
          <button className="btn primary" style={{ width: '100%' }} onClick={() => share(r, tiles, title)}>Als Bild teilen</button>
        </>
      )}
    </>
  )
}
