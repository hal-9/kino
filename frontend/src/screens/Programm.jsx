import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addDays, berlinYmd } from 'shared'
import { api, errorText, newKey } from '../api.js'
import { QueryError } from '../components/QueryStatus.jsx'
import Sheet from '../components/Sheet.jsx'
import MovieSheet from '../components/MovieSheet.jsx'
import MovieHeader from '../components/MovieHeader.jsx'

// Heute/Morgen nach Berliner Kalenderdatum, nicht nach Position oder Gerätezeitzone.
const dayLabel = (ymd, today) =>
  ymd === today ? 'Heute' : ymd === addDays(today, 1) ? 'Morgen' : new Date(`${ymd}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric' })
const time = (iso) => iso.slice(11, 16)
const dateShort = (iso) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' })

function Row({ s, showDate, onPropose }) {
  return (
    <div className="slot">
      <div className="slot-top">
        <span className="show-time">{showDate && <small>{dateShort(s.starts_at)}</small>}{time(s.starts_at)}</span>
        <span className="show-main">
          <strong>{s.cinema_name}</strong>
          <small>{[s.auditorium, s.seats && `${s.seats} Pl.`, ...s.attrs].filter(Boolean).join(' · ')}</small>
        </span>
        {s.version && <span className={`badge ${s.version === 'DF' ? '' : 'ov'}`}>{s.version}</span>}
      </div>
      <div className="slot-actions">
        <button className="mini primary" onClick={onPropose}>Vorschlagen</button>
        {s.ticket_url && <a className="mini" href={s.ticket_url} target="_blank" rel="noreferrer">Buchen ↗</a>}
      </div>
    </div>
  )
}

function MovieCard({ movie, favOnly, showDate, onPropose, onInfo }) {
  const fav = movie.screenings.filter((s) => s.is_favorite)
  const rest = favOnly ? [] : movie.screenings.filter((s) => !s.is_favorite)
  const [open, setOpen] = useState(fav.length === 0)
  const row = (s) => <Row key={s.id} s={s} showDate={showDate} onPropose={() => onPropose(movie, s)} />
  return (
    <section className="group">
      <MovieHeader movie={movie} onInfo={onInfo} />
      <div className="card">
        {fav.map(row)}
        {rest.length > 0 && fav.length > 0 && (
          <button className="show more" onClick={() => setOpen(!open)}>
            {open ? '▾' : '▸'} Weitere Kinos ({rest.length})
          </button>
        )}
        {open && rest.map(row)}
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
  const [info, setInfo] = useState(null)
  const [draft, setDraft] = useState(null) // { movie, screening, key }
  const [note, setNote] = useState('')
  const navigate = useNavigate()
  const qc = useQueryClient()
  const create = useMutation({
    // Ein Schlüssel je Entwurf: Wiederholung nach Fehler/Netzabbruch legt keinen zweiten Vorschlag an.
    mutationFn: () => api.post('/proposals', { movie_id: draft.movie.id, screening_ids: [draft.screening.id], note: note || undefined }, { idempotencyKey: draft.key }),
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['proposals'] }); setDraft(null); setNote(''); navigate(`/vorschlaege/${p.id}`) },
  })

  const closeDraft = () => { setDraft(null); create.reset() }

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
          {dayList.slice(0, 14).map((d) => (
            <button key={d} className={`chip${d === activeDay ? ' active' : ''}`} onClick={() => setDay(d)}>{dayLabel(d, berlinYmd())}</button>
          ))}
        </div>
      )}
      <div className="chips-row">
        <button className={`chip${ov ? ' active' : ''}`} onClick={() => setOv(!ov)}>OV/OmU</button>
        <button className={`chip${favOnly ? ' active' : ''}`} onClick={() => setFavOnly(!favOnly)}>Nur Favoriten</button>
      </div>
      {program.isLoading && <p className="muted">Lädt…</p>}
      <QueryError query={days.data ? program : days} label="Programm" />
      {program.data && movies.length === 0 && (
        <div className="empty"><h2>Nichts gefunden</h2><p>Programm reicht etwa zwei Wochen voraus.</p></div>
      )}
      {movies.map((m) => <MovieCard key={m.id} movie={m} favOnly={favOnly} showDate={searching} onPropose={(movie, screening) => setDraft({ movie, screening, key: newKey() })} onInfo={setInfo} />)}
      <MovieSheet movieId={info} onClose={() => setInfo(null)} />
      <Sheet open={draft != null} onClose={closeDraft}>
        {draft && (
          <>
            <h3>{draft.movie.title} vorschlagen</h3>
            <p className="sub">{dateShort(draft.screening.starts_at)} · {time(draft.screening.starts_at)} · {draft.screening.cinema_name}{draft.screening.version ? ` · ${draft.screening.version}` : ''}</p>
            <textarea className="field" placeholder="Notiz (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            {create.isError && (
              <p className="stale" role="alert">{create.error.code === 'expired' ? 'Diese Vorstellung hat schon begonnen. Bitte eine andere wählen.'
                : create.error.code === 'idempotency key reused' ? 'Vielleicht schon gesendet. Bitte unter Vorschläge prüfen.'
                : `Senden fehlgeschlagen. ${errorText(create.error)}`}</p>
            )}
            <div className="sheet-actions">
              <button className="btn" onClick={closeDraft}>Abbrechen</button>
              <button className="btn primary" disabled={create.isPending} onClick={() => create.mutate()}>Vorschlag senden</button>
            </div>
          </>
        )}
      </Sheet>
    </>
  )
}
