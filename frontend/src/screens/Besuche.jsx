import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { berlinYmd, parseOrderText } from 'shared'
import { api, newKey } from '../api.js'
import { MutationError, QueryError } from '../components/QueryStatus.jsx'
import Sheet from '../components/Sheet.jsx'

const today = () => berlinYmd()
const fmt = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' })
// K18: ehrliche Herkunft je Besuch.
const ATTENDANCE = {
  inferred: 'Aus Buchung abgeleitet (✓ bei der gebuchten Vorstellung), noch nicht bestätigt',
  legacy: 'Früher automatisch aus ✓-Stimme übernommen, nicht bestätigt',
  confirmed: 'Bestätigt',
}
const stars = (r) => '★'.repeat(Math.floor(r)) + (r % 1 ? '½' : '')
const RATINGS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]

function letterboxdLinks(v) {
  const t = `${v.snapshot.title} ${v.snapshot.year ?? ''}`.trim()
  const back = encodeURIComponent(`${location.origin}/besuche/${v.id}`)
  return {
    app: `letterboxd://x-callback-url/log?name=${encodeURIComponent(t)}&date=${v.watched_on}&x-success=${back}`,
    web: v.tmdb_id ? `https://letterboxd.com/tmdb/${v.tmdb_id}/` : `https://letterboxd.com/search/${encodeURIComponent(v.snapshot.title)}/`,
  }
}

// Formular für neuen Besuch (init aus Vorschlag/Pending) oder Bearbeiten (visit).
function VisitSheet({ open, onClose, members, me, init, visit }) {
  const qc = useQueryClient()
  const cinemas = useQuery({ queryKey: ['cinemas'], queryFn: () => api.get('/cinemas'), enabled: open, staleTime: 3_600_000 })
  const [f, setF] = useState({})
  const [key, setKey] = useState(null)
  useEffect(() => {
    if (!open) return
    setKey(newKey())
    const s = visit?.snapshot ?? init?.snapshot
    setF({
      title: s?.title ?? '', year: s?.year ?? '', cinema_key: s?.cinema_key ?? '',
      watched_on: visit?.watched_on ?? (s?.starts_at ? s.starts_at.slice(0, 10) : today()),
      auditorium: visit?.auditorium ?? s?.auditorium ?? '', row: visit?.row ?? '', seats: visit?.seats ?? '',
      companions: visit?.companions ?? [], note: visit?.note ?? '', paste: '', manual_rating: visit?.manual_rating ?? '',
    })
  }, [open, visit, init])
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const cinema = cinemas.data?.cinemas.find((c) => c.key === f.cinema_key)

  const done = () => { qc.invalidateQueries({ queryKey: ['visits'] }); qc.invalidateQueries({ queryKey: ['pending'] }); onClose() }
  const save = useMutation({
    mutationFn: () => {
      const body = { watched_on: f.watched_on, auditorium: f.auditorium || null, row: f.row || null, seats: f.seats || null, companions: f.companions, note: f.note || null }
      if (visit) return api.patch(`/visits/${visit.id}`, { ...body, manual_rating: f.manual_rating === '' ? null : Number(f.manual_rating) })
      if (init?.proposal_id) return api.post('/visits', { ...body, proposal_id: init.proposal_id }, { idempotencyKey: key })
      return api.post('/visits', { ...body, title: f.title, year: f.year ? Number(f.year) : null, cinema_key: f.cinema_key }, { idempotencyKey: key })
    },
    onSuccess: done,
  })
  const del = useMutation({ mutationFn: () => api.delete(`/visits/${visit.id}`), onSuccess: done })

  function applyPaste(text) {
    const p = parseOrderText(text)
    setF((x) => ({ ...x, paste: text, auditorium: p.auditorium ?? x.auditorium, row: p.row ?? x.row, seats: p.seats ?? x.seats }))
  }
  const toggle = (id) => setF((x) => ({ ...x, companions: x.companions.includes(id) ? x.companions.filter((i) => i !== id) : [...x.companions, id] }))
  const locked = Boolean(visit || init?.proposal_id)
  const canSave = visit || init?.proposal_id || (f.title && f.cinema_key)

  return (
    <Sheet open={open} onClose={onClose} label={visit ? 'Besuch bearbeiten' : 'Besuch eintragen'}>
      <h3>{visit ? 'Besuch bearbeiten' : 'Besuch eintragen'}</h3>
      <input className="field" aria-label="Film" placeholder="Film" value={f.title ?? ''} onChange={set('title')} disabled={locked} />
      {!locked && <input className="field" type="number" aria-label="Jahr" placeholder="Jahr" value={f.year ?? ''} onChange={set('year')} />}
      <select className="field" aria-label="Kino" value={f.cinema_key ?? ''} onChange={set('cinema_key')} disabled={locked}>
        <option value="">Kino wählen…</option>
        {cinemas.data?.cinemas.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
      </select>
      <input className="field" type="date" aria-label="Datum" value={f.watched_on ?? ''} onChange={set('watched_on')} />
      <input className="field" list="auds" aria-label="Saal" placeholder="Saal" value={f.auditorium ?? ''} onChange={set('auditorium')} />
      <datalist id="auds">{cinema?.auditoriums.map((a) => <option key={a.name} value={a.name} />)}</datalist>
      <div className="two">
        <input className="field" aria-label="Reihe" placeholder="Reihe" value={f.row ?? ''} onChange={set('row')} />
        <input className="field" aria-label="Sitze" placeholder="Sitze" value={f.seats ?? ''} onChange={set('seats')} />
      </div>
      <textarea className="field" aria-label="kinoheld-Bestelltext" placeholder="kinoheld-Bestelltext einfügen (füllt Saal, Reihe, Sitze)" value={f.paste ?? ''} onChange={(e) => applyPaste(e.target.value)} />
      <div className="chips-row" role="group" aria-label="Begleitung">
        {members.filter((m) => m.id !== me.id).map((m) => (
          <button key={m.id} className={`chip${f.companions?.includes(m.id) ? ' active' : ''}`} aria-pressed={Boolean(f.companions?.includes(m.id))} onClick={() => toggle(m.id)}>{m.name}</button>
        ))}
      </div>
      <input className="field" aria-label="Notiz" placeholder="Notiz" value={f.note ?? ''} onChange={set('note')} maxLength={500} />
      {visit && (
        <select className="field" aria-label="Eigene Bewertung" value={f.manual_rating ?? ''} onChange={set('manual_rating')}>
          <option value="">{visit.letterboxd_rating != null ? `Letterboxd-Wert (${stars(visit.letterboxd_rating)})` : 'Keine eigene Bewertung'}</option>
          {RATINGS.map((r) => <option key={r} value={r}>{stars(r)}</option>)}
        </select>
      )}
      <MutationError mutation={save} />
      <MutationError mutation={del} />
      <div className="sheet-actions">
        {visit && <button className="btn danger" onClick={() => confirm('Besuch löschen?') && del.mutate()}>Löschen</button>}
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn primary" disabled={!canSave || save.isPending} onClick={() => save.mutate()}>Speichern</button>
      </div>
    </Sheet>
  )
}

// K30: persönliche Notizen zu genau diesem Saal in diesem Kino (eigene + im Haushalt geteilte), mit Datum/Platz.
// Getrennt von Anbieter-Angaben; keine Sitzplan- oder Bestplatz-Aussage.
function RoomNotes({ v, mine }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const key = ['roomNotes', v.snapshot.cinema_key, v.auditorium]
  const q = new URLSearchParams({ cinema_key: v.snapshot.cinema_key, room: v.auditorium })
  const notes = useQuery({ queryKey: key, queryFn: () => api.get(`/rooms/notes?${q}`), enabled: open })
  const [text, setText] = useState('')
  const [shared, setShared] = useState(false)
  const done = () => { setText(''); qc.invalidateQueries({ queryKey: ['roomNotes'] }) }
  const add = useMutation({
    mutationFn: () => api.post('/rooms/notes', { cinema_key: v.snapshot.cinema_key, room: v.auditorium, visit_id: v.id, noted_on: v.watched_on, row: v.row, seat: v.seats, note: text.trim(), shared }),
    onSuccess: done,
  })
  const share = useMutation({ mutationFn: (n) => api.patch(`/rooms/notes/${n.id}`, { shared: !n.shared }), onSuccess: done })
  const del = useMutation({ mutationFn: (n) => api.delete(`/rooms/notes/${n.id}`), onSuccess: done })
  return (
    <details className="fix" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Notizen zu {v.auditorium}</summary>
      <QueryError query={notes} label="Saal-Notizen" />
      {notes.data && !notes.data.notes.length && <p className="sub">Noch keine Notizen zu diesem Saal.</p>}
      <ul className="sub" aria-label={`Notizen zu ${v.auditorium}`}>
        {notes.data?.notes.map((n) => (
          <li key={n.id}>
            {fmt(n.noted_on)}{n.row && ` · Reihe ${n.row}`}{n.seat && ` · Sitz ${n.seat}`}{!n.mine && ` · ${n.user_name}`}{n.note && `: ${n.note}`}
            {n.mine && (
              <>
                {' '}<button className="link-btn" onClick={() => share.mutate(n)}>{n.shared ? 'Geteilt (privat machen)' : 'Privat (teilen)'}</button>
                <button className="link-btn" onClick={() => confirm('Notiz löschen?') && del.mutate(n)}>Löschen</button>
              </>
            )}
          </li>
        ))}
      </ul>
      {mine && (
        <>
          <input className="field" aria-label="Notiz zum Saal" placeholder="z. B. Reihe 9 mittig: gute Sicht, Ton laut" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
          <label className="sub"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Mit dem Haushalt teilen</label>
          <button className="btn" disabled={!text.trim() || add.isPending} onClick={() => add.mutate()}>Notiz speichern</button>
        </>
      )}
      <MutationError mutation={add} />
      <MutationError mutation={share} />
      <MutationError mutation={del} />
    </details>
  )
}

export default function Besuche() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const [sheet, setSheet] = useState(null) // { visit } | { init } | {}
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me') })
  const visits = useQuery({ queryKey: ['visits'], queryFn: () => api.get('/visits'), refetchInterval: 30_000 })
  const pending = useQuery({ queryKey: ['pending'], queryFn: () => api.get('/visits/pending') })
  const qc = useQueryClient()
  const attend = useMutation({
    mutationFn: ({ id, action }) => api.post(`/visits/${id}/${action}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['visits'] }); qc.invalidateQueries({ queryKey: ['pending'] }) },
  })

  // Deep-Links: /besuche/:id öffnet den Besuch, ?proposal=ID das Formular dazu.
  useEffect(() => {
    if (id && visits.data) {
      const v = visits.data.visits.find((x) => x.id === Number(id))
      if (v) setSheet({ visit: v })
    }
  }, [id, visits.data])
  useEffect(() => {
    const pid = Number(params.get('proposal'))
    if (pid && pending.data) {
      const p = pending.data.pending.find((x) => x.proposal_id === pid)
      if (p) setSheet({ init: p })
    }
  }, [params, pending.data])

  if (!visits.data) return visits.isError ? <QueryError query={visits} label="Besuche" /> : <p className="muted">Lädt…</p>
  if (!me) return <p className="muted">Lädt…</p>
  const { members, visits: list } = visits.data
  const name = (uid) => members.find((m) => m.id === uid)?.name
  const close = () => { setSheet(null); if (id || params.get('proposal')) { setParams({}); history.replaceState(null, '', '/besuche') } }

  return (
    <>
      {pending.data?.pending.length > 0 && (
        <section className="group">
          <h2 className="group-title">Offen<span className="n">{pending.data.pending.length}</span></h2>
          <div className="card">
            {pending.data.pending.map((p) => (
              <button key={p.proposal_id} className="show" onClick={() => setSheet({ init: p })}>
                <span className="show-main"><strong>{p.snapshot.title}</strong><small>{fmt(p.snapshot.starts_at.slice(0, 10))} · {p.snapshot.cinema_name}</small></span>
                <span className="badge ov">eintragen</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <QueryError query={visits} label="Besuche" />
      <MutationError mutation={attend} />
      <button className="btn primary" style={{ width: '100%', marginBottom: 16 }} onClick={() => setSheet({})}>+ Besuch eintragen</button>
      {list.length === 0 && <div className="empty"><h2>Noch keine Besuche</h2></div>}
      {list.map((v) => {
        const lb = letterboxdLinks(v)
        const mine = v.user_id === me.id
        return (
          <section key={v.id} className="group">
            <h2 className="group-title">{v.snapshot.title}<span className="n">{fmt(v.watched_on)}</span></h2>
            <div className="card pad">
              <p><strong>{v.snapshot.cinema_name}</strong>{[v.auditorium, v.row && `Reihe ${v.row}`, v.seats && `Sitz ${v.seats}`].filter(Boolean).length > 0 && ' · ' + [v.auditorium, v.row && `Reihe ${v.row}`, v.seats && `Sitz ${v.seats}`].filter(Boolean).join(', ')}</p>
              <small className="muted">{[v.user_name, ...v.companions.map(name)].filter(Boolean).join(', ')}{v.note && ` · ${v.note}`}</small>
              {ATTENDANCE[v.attendance] && <small className="att">{ATTENDANCE[v.attendance]}</small>}
              {v.rating != null && <p className="stars">{stars(v.rating)}{v.manual_rating != null && <small className="muted"> eigene Bewertung</small>}</p>}
              {mine && (v.attendance === 'inferred' || v.attendance === 'legacy') && (
                <div className="sheet-actions">
                  <button className="btn" disabled={attend.isPending} onClick={() => attend.mutate({ id: v.id, action: 'confirm' })}>Ich war dabei</button>
                  <button className="btn" disabled={attend.isPending}
                    onClick={() => confirm('Nicht dabei gewesen? Der Eintrag wird entfernt und nicht wieder automatisch angelegt.') && attend.mutate({ id: v.id, action: 'skip' })}>Nicht dabei</button>
                </div>
              )}
              {mine && (
                <div className="sheet-actions">
                  <a className="btn primary" href={lb.app}>In Letterboxd bewerten</a>
                  <button className="btn" onClick={() => setSheet({ visit: v })}>Bearbeiten</button>
                </div>
              )}
              {v.auditorium && v.snapshot.cinema_key && <RoomNotes v={v} mine={mine} />}
              {mine && <a className="link-btn" href={lb.web} target="_blank" rel="noreferrer">Auf letterboxd.com öffnen</a>}
            </div>
          </section>
        )
      })}
      <VisitSheet open={sheet != null} onClose={close} members={members} me={me} init={sheet?.init} visit={sheet?.visit} />
    </>
  )
}
