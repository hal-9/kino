import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api.js'

const dayLabel = (ymd, i) =>
  i === 0 ? 'Heute' : new Date(`${ymd}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric' })
const time = (iso) => iso.slice(11, 16)
const dateShort = (iso) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' })

function Row({ s, showDate }) {
  const body = (
    <>
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
  return s.ticket_url
    ? <a className="show" href={s.ticket_url} target="_blank" rel="noreferrer">{body}</a>
    : <div className="show">{body}</div>
}

function MovieCard({ movie, favOnly, showDate }) {
  const fav = movie.screenings.filter((s) => s.is_favorite)
  const rest = favOnly ? [] : movie.screenings.filter((s) => !s.is_favorite)
  const [open, setOpen] = useState(fav.length === 0)
  return (
    <section className="group">
      <h2 className="group-title">
        {movie.title}
        <span className="n">{[movie.year, movie.runtime && `${movie.runtime} min`].filter(Boolean).join(' · ')}</span>
      </h2>
      <div className="card">
        {fav.map((s) => <Row key={s.id} s={s} showDate={showDate} />)}
        {rest.length > 0 && fav.length > 0 && (
          <button className="show more" onClick={() => setOpen(!open)}>
            {open ? '▾' : '▸'} Weitere Kinos ({rest.length})
          </button>
        )}
        {open && rest.map((s) => <Row key={s.id} s={s} showDate={showDate} />)}
      </div>
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
