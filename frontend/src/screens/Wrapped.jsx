import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { berlinYmd } from 'shared'
import { api } from '../api.js'
import { QueryError } from '../components/QueryStatus.jsx'
import { drawStory, W, H } from '../lib/storyCanvas.js'

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const day = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })

export function tilesOf(r) {
  const t = (name, v, sub) => v != null && { name, value: v, sub }
  return [
    // K21: feste Bedeutungen (shared/stats.js).
    r.scope === 'group' && t('Kinoabende', r.outings, r.ungrouped ? `${r.ungrouped} Besuch(e) ohne Buchung einzeln gezählt` : undefined),
    t(r.scope === 'group' ? 'Personenbesuche' : 'Besuche', r.count, r.unconfirmed ? `davon ${r.unconfirmed} unbestätigt` : undefined),
    t('Filme', r.films),
    t('Filmstunden', String(r.person_hours).replace('.', ','), r.unknown_runtime ? `ohne Werbung · ${r.unknown_runtime} ohne bekannte Laufzeit` : 'ohne Werbung'),
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

// Fehler (kein Canvas, toBlob null, Teilen fehlgeschlagen) → Download-Fallback bzw. Fehlermeldung; Abbruch ist kein Fehler.
export async function share(r, tiles, title) {
  await document.fonts?.ready
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  drawStory(ctx, tiles, title)
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'))
  if (!blob) throw new Error('export failed')
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
  const thisYear = Number(berlinYmd().slice(0, 4))
  const [year, setYear] = useState(thisYear)
  const [scope, setScope] = useState('me')
  const [shareError, setShareError] = useState(false)
  const query = useQuery({ queryKey: ['wrapped', year, scope], queryFn: () => api.get(`/stats/wrapped?year=${year}&scope=${scope}`) })
  const { data: r, isLoading } = query
  const tiles = r ? tilesOf(r) : []
  const title = scope === 'me' ? `Mein Kinojahr ${year}` : `Unser Kinojahr ${year}`

  return (
    <>
      <div className="chips-row">
        <button className="chip" onClick={() => setYear(year - 1)}>‹ {year - 1}</button>
        <button className="chip active" aria-current="true">{year}</button>
        {year < thisYear && <button className="chip" onClick={() => setYear(year + 1)}>{year + 1} ›</button>}
        <button className={`chip${scope === 'me' ? ' active' : ''}`} aria-pressed={scope === 'me'} onClick={() => setScope('me')}>Ich</button>
        <button className={`chip${scope === 'group' ? ' active' : ''}`} aria-pressed={scope === 'group'} onClick={() => setScope('group')}>Gruppe</button>
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
          {shareError && <p className="stale" role="alert">Bild konnte nicht erstellt werden. Die Zahlen oben bleiben vollständig sichtbar.</p>}
          <button className="btn primary" style={{ width: '100%' }} onClick={() => { setShareError(false); share(r, tiles, title).catch(() => setShareError(true)) }}>Als Bild teilen</button>
        </>
      )}
    </>
  )
}
