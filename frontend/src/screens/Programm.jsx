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
const MAX_OPTIONS = 5
const AD_MINUTES = 20 // Werbung/Trailer vor dem Film, wie im Kalendereintrag
// Geschätztes Ende in Berliner Zeit; ohne Laufzeit ausdrücklich unbekannt.
const finish = (iso, runtime) => runtime
  ? `Ende ca. ${new Date(Date.parse(iso) + (runtime + AD_MINUTES) * 60_000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })} (inkl. ~${AD_MINUTES} Min. Werbung)`
  : 'Ende unbekannt (Laufzeit fehlt)'

// K13: Auswahl (ein Film, bis zu fünf Vorstellungen, eine Notiz) überlebt Tag-/Filterwechsel und Navigation im Tab.
const DRAFT_KEY = 'kino.proposalDraft'
function loadDraft() {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY)) } catch { return null }
}
function saveDraft(d) {
  try { d ? sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)) : sessionStorage.removeItem(DRAFT_KEY) } catch {}
}

function Row({ s, showDate, onPropose, selected }) {
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
        <button className={`mini${selected ? '' : ' primary'}`} onClick={onPropose} aria-pressed={selected} aria-label={`Vorschlagen: ${s.cinema_name} ${time(s.starts_at)}`}>{selected ? '✓ Ausgewählt' : 'Vorschlagen'}</button>
        {s.ticket_url && <a className="mini" href={s.ticket_url} target="_blank" rel="noreferrer">Buchen ↗</a>}
      </div>
    </div>
  )
}

function MovieCard({ movie, favOnly, showDate, onPropose, onInfo, selected }) {
  const fav = movie.screenings.filter((s) => s.is_favorite)
  const rest = favOnly ? [] : movie.screenings.filter((s) => !s.is_favorite)
  const [open, setOpen] = useState(fav.length === 0)
  const row = (s) => <Row key={s.id} s={s} showDate={showDate} selected={selected.has(s.id)} onPropose={() => onPropose(movie, s)} />
  return (
    <section className="group">
      <MovieHeader movie={movie} onInfo={onInfo} />
      <div className="card">
        {fav.map(row)}
        {rest.length > 0 && fav.length > 0 && (
          <button className="show more" aria-expanded={open} onClick={() => setOpen(!open)}>
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
  const [draft, setDraftState] = useState(loadDraft) // { movie, shows, note, key }
  const [tray, setTray] = useState(false)
  const [hint, setHint] = useState(null)
  const setDraft = (d) => { setDraftState(d); saveDraft(d) }
  const note = draft?.note ?? ''
  const setNote = (v) => setDraft({ ...draft, note: v })
  const navigate = useNavigate()
  const qc = useQueryClient()
  const create = useMutation({
    // Ein Schlüssel je Entwurf: Wiederholung nach Fehler/Netzabbruch legt keinen zweiten Vorschlag an.
    mutationFn: () => api.post('/proposals', { movie_id: draft.movie.id, screening_ids: draft.shows.map((s) => s.id), note: note || undefined }, { idempotencyKey: draft.key }),
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['proposals'] }); setDraft(null); setTray(false); navigate(`/vorschlaege/${p.id}`) },
  })

  const selected = new Set(draft?.shows.map((s) => s.id))
  function toggle(movie, s) {
    setHint(null)
    create.reset()
    if (draft && draft.movie.id !== movie.id) {
      if (!confirm(`Auswahl für „${draft.movie.title}“ verwerfen und mit „${movie.title}“ neu beginnen?`)) return
      return setDraft({ movie: { id: movie.id, title: movie.title, runtime: movie.runtime }, shows: [s], note: '', key: newKey() })
    }
    if (!draft) return setDraft({ movie: { id: movie.id, title: movie.title, runtime: movie.runtime }, shows: [s], note: '', key: newKey() })
    if (selected.has(s.id)) {
      const shows = draft.shows.filter((x) => x.id !== s.id)
      return setDraft(shows.length || draft.note ? { ...draft, shows } : null)
    }
    if (draft.shows.length >= MAX_OPTIONS) return setHint(`Höchstens ${MAX_OPTIONS} Vorstellungen je Vorschlag.`)
    setDraft({ ...draft, shows: [...draft.shows, s].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)) })
  }
  function clearDraft() {
    if (note.trim() && !confirm('Auswahl und Notiz verwerfen?')) return
    setDraft(null)
    setTray(false)
    create.reset()
  }
  const remove = (id) => setDraft({ ...draft, shows: draft.shows.filter((x) => x.id !== id) })
  const expired = (s) => !(Date.parse(s.starts_at) > Date.now())

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
      <input className="field" type="search" aria-label="Film suchen" placeholder="Film suchen…" value={q} onChange={(e) => setQ(e.target.value)} />
      {!searching && (
        <div className="chips-row">
          {dayList.slice(0, 14).map((d) => (
            <button key={d} className={`chip${d === activeDay ? ' active' : ''}`} aria-pressed={d === activeDay} onClick={() => setDay(d)}>{dayLabel(d, berlinYmd())}</button>
          ))}
        </div>
      )}
      <div className="chips-row">
        <button className={`chip${ov ? ' active' : ''}`} aria-pressed={ov} onClick={() => setOv(!ov)}>OV/OmU</button>
        <button className={`chip${favOnly ? ' active' : ''}`} aria-pressed={favOnly} onClick={() => setFavOnly(!favOnly)}>Nur Favoriten</button>
      </div>
      {program.isLoading && <p className="muted">Lädt…</p>}
      <QueryError query={days.data ? program : days} label="Programm" />
      {program.data && movies.length === 0 && (
        <div className="empty"><h2>Nichts gefunden</h2><p>Programm reicht etwa zwei Wochen voraus.</p></div>
      )}
      {movies.map((m) => <MovieCard key={m.id} movie={m} favOnly={favOnly} showDate={searching} selected={selected} onPropose={toggle} onInfo={setInfo} />)}
      {hint && <p className="stale" role="status">{hint}</p>}
      {draft && (
        <div className="tray" role="region" aria-label="Auswahl für den Vorschlag">
          <span><strong>{draft.movie.title}</strong> · {draft.shows.length} {draft.shows.length === 1 ? 'Vorstellung' : 'Vorstellungen'}</span>
          <button className="mini" onClick={clearDraft}>Leeren</button>
          <button className="mini primary" onClick={() => setTray(true)}>Weiter</button>
        </div>
      )}
      <MovieSheet movieId={info} onClose={() => setInfo(null)} />
      <Sheet open={tray && draft != null} onClose={() => setTray(false)} label="Vorschlag senden">
        {draft && (
          <>
            <h3>{draft.movie.title} vorschlagen</h3>
            {draft.shows.length === 0 && <p className="sub">Keine Vorstellung ausgewählt. Im Programm auf „Vorschlagen“ tippen.</p>}
            <ul className="compare" aria-label="Ausgewählte Vorstellungen">
              {draft.shows.map((s) => (
                <li key={s.id}>
                  <div>
                    <strong>{dateShort(s.starts_at)} · {time(s.starts_at)}</strong> · {s.cinema_name}
                    <small>{[s.auditorium ?? 'Saal unbekannt', s.version ?? 'Fassung unbekannt', ...(s.attrs ?? [])].join(' · ')}</small>
                    <small>{expired(s) ? 'Hat schon begonnen, bitte entfernen.' : finish(s.starts_at, draft.movie.runtime)}</small>
                  </div>
                  <button className="mini" aria-label={`Entfernen: ${s.cinema_name} ${time(s.starts_at)}`} onClick={() => remove(s.id)}>Entfernen</button>
                </li>
              ))}
            </ul>
            {draft.shows.length < MAX_OPTIONS && <p className="sub">Weitere Vorstellungen desselben Films im Programm hinzufügen (bis {MAX_OPTIONS}).</p>}
            <textarea className="field" aria-label="Notiz (optional)" placeholder="Notiz (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            {create.isError && (
              <p className="stale" role="alert">{create.error.code === 'expired' ? 'Eine Vorstellung hat schon begonnen. Bitte entfernen oder eine andere wählen.'
                : create.error.code === 'idempotency key reused' ? 'Vielleicht schon gesendet. Bitte unter Vorschläge prüfen.'
                : `Senden fehlgeschlagen. ${errorText(create.error)}`}</p>
            )}
            <div className="sheet-actions">
              <button className="btn" onClick={() => setTray(false)}>Zurück</button>
              <button className="btn primary" disabled={create.isPending || draft.shows.length === 0 || draft.shows.some(expired)} onClick={() => create.mutate()}>Vorschlag senden</button>
            </div>
          </>
        )}
      </Sheet>
    </>
  )
}
