import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api.js'
import Sheet from '../components/Sheet.jsx'

const dayLabel = (ymd, i) =>
  i === 0 ? 'Heute' : new Date(`${ymd}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric' })
const time = (iso) => iso.slice(11, 16)
const dateShort = (iso) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' })

function Row({ s, showDate, picking, selected, onPick }) {
  const body = (
    <>
      {picking && <span className="check-box">{selected && '✓'}</span>}
      <span className="show-time">{showDate && <small>{dateShort(s.starts_at)}</small>}{time(s.starts_at)}</span>
      <span className="show-main">
        <strong>{s.cinema_name}</strong>
        <small>
          {[s.auditorium, s.seats && `${s.seats} Pl.`, ...s.attrs].filter(Boolean).join(' · ')}
        </small>
      </span>
      {s.version && <span className={`badge ${s.version === 'DF' ? '' : 'ov'}`}>{s.version}</span>}
    </>
  )
  if (picking) return <button className={`show${selected ? ' sel' : ''}`} onClick={onPick}>{body}</button>
  return s.ticket_url
    ? <a className="show" href={s.ticket_url} target="_blank" rel="noreferrer">{body}</a>
    : <div className="show">{body}</div>
}

function MovieCard({ movie, favOnly, showDate }) {
  const fav = movie.screenings.filter((s) => s.is_favorite)
  const rest = favOnly ? [] : movie.screenings.filter((s) => !s.is_favorite)
  const [open, setOpen] = useState(fav.length === 0)
  const [picking, setPicking] = useState(false)
  const [sel, setSel] = useState([])
  const [sheet, setSheet] = useState(false)
  const [note, setNote] = useState('')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const create = useMutation({
    mutationFn: () => api.post('/proposals', { movie_id: movie.id, screening_ids: sel, note: note || undefined }),
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['proposals'] }); navigate(`/vorschlaege/${p.id}`) },
  })
  const toggle = (id) => setSel((x) => (x.includes(id) ? x.filter((i) => i !== id) : x.length < 5 ? [...x, id] : x))
  const row = (s) => <Row key={s.id} s={s} showDate={showDate} picking={picking} selected={sel.includes(s.id)} onPick={() => toggle(s.id)} />
  return (
    <section className="group">
      <h2 className="group-title">
        {movie.title}
        <span className="n">{[movie.year, movie.runtime && `${movie.runtime} min`].filter(Boolean).join(' · ')}</span>
        <button className="link-btn" onClick={() => { setPicking(!picking); setSel([]); setOpen(true) }}>{picking ? 'Abbrechen' : 'Vorschlagen'}</button>
      </h2>
      <div className="card">
        {fav.map(row)}
        {rest.length > 0 && fav.length > 0 && (
          <button className="show more" onClick={() => setOpen(!open)}>
            {open ? '▾' : '▸'} Weitere Kinos ({rest.length})
          </button>
        )}
        {open && rest.map(row)}
      </div>
      {picking && (
        <button className="btn primary pickbar" disabled={sel.length < 2} onClick={() => setSheet(true)}>
          {sel.length < 2 ? `2–5 Vorstellungen wählen (${sel.length})` : `${sel.length} gewählt · Vorschlagen`}
        </button>
      )}
      <Sheet open={sheet} onClose={() => setSheet(false)}>
        <h3>{movie.title} vorschlagen</h3>
        <textarea className="field" placeholder="Notiz (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        <div className="sheet-actions">
          <button className="btn" onClick={() => setSheet(false)}>Zurück</button>
          <button className="btn primary" disabled={create.isPending} onClick={() => create.mutate()}>Vorschlag senden</button>
        </div>
      </Sheet>
    </section>
  )
}

export default function Programm() {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [day, setDay] = useState(null)
  const [ov, setOv] = useState(false)
  const [favOnly, setFavOnly] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const days = useQuery({ queryKey: ['days'], queryFn: () => api.get('/program/days'), refetchInterval: 60_000 })
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => api.get('/sources'), refetchInterval: 60_000 })
  const dayList = days.data?.days ?? []
  const activeDay = day ?? dayList[0]
  const searching = debounced.length > 0

  const params = new URLSearchParams()
  if (searching) params.set('q', debounced)
  else if (activeDay) params.set('date', activeDay)
  if (ov) params.set('version', 'ov')
  const program = useQuery({
    queryKey: ['program', params.toString()],
    queryFn: () => api.get(`/program?${params}`),
    enabled: searching || Boolean(activeDay),
    refetchInterval: 60_000,
  })
  const movies = (program.data?.movies ?? []).filter((m) => !favOnly || m.screenings.some((s) => s.is_favorite))

  const stale = (sources.data?.sources ?? []).filter((s) => !s.last_ok_at || Date.now() - new Date(s.last_ok_at) > 36 * 3600_000)

  return (
    <>
      {stale.length > 0 && <p className="stale">⚠ Veraltet: {stale.map((s) => s.source).join(', ')}</p>}
      <input className="field" type="search" placeholder="Film suchen…" value={q} onChange={(e) => setQ(e.target.value)} />
      {!searching && (
        <div className="chips-row">
          {dayList.slice(0, 14).map((d, i) => (
            <button key={d} className={`chip${d === activeDay ? ' active' : ''}`} onClick={() => setDay(d)}>{dayLabel(d, i)}</button>
          ))}
        </div>
      )}
      <div className="chips-row">
        <button className={`chip${ov ? ' active' : ''}`} onClick={() => setOv(!ov)}>OV/OmU</button>
        <button className={`chip${favOnly ? ' active' : ''}`} onClick={() => setFavOnly(!favOnly)}>Nur Favoriten</button>
      </div>
      {program.isLoading && <p className="muted">Lädt…</p>}
      {program.data && movies.length === 0 && (
        <div className="empty"><h2>Nichts gefunden</h2><p>Programm reicht etwa zwei Wochen voraus.</p></div>
      )}
      {movies.map((m) => <MovieCard key={m.id} movie={m} favOnly={favOnly} showDate={searching} />)}
    </>
  )
}
