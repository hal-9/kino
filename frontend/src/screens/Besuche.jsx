import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { parseOrderText } from 'shared'
import { api } from '../api.js'
import Sheet from '../components/Sheet.jsx'

const today = () => new Date().toLocaleDateString('sv-SE')
const fmt = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' })
const stars = (r) => '★'.repeat(Math.floor(r)) + (r % 1 ? '½' : '')

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
  useEffect(() => {
    if (!open) return
    const s = visit?.snapshot ?? init?.snapshot
    setF({
      title: s?.title ?? '', year: s?.year ?? '', cinema_key: s?.cinema_key ?? '',
      watched_on: visit?.watched_on ?? (s?.starts_at ? s.starts_at.slice(0, 10) : today()),
      auditorium: visit?.auditorium ?? s?.auditorium ?? '', row: visit?.row ?? '', seats: visit?.seats ?? '',
      companions: visit?.companions ?? [], note: visit?.note ?? '', paste: '',
    })
  }, [open, visit, init])
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const cinema = cinemas.data?.cinemas.find((c) => c.key === f.cinema_key)

  const done = () => { qc.invalidateQueries({ queryKey: ['visits'] }); qc.invalidateQueries({ queryKey: ['pending'] }); onClose() }
  const save = useMutation({
    mutationFn: () => {
      const body = { watched_on: f.watched_on, auditorium: f.auditorium || null, row: f.row || null, seats: f.seats || null, companions: f.companions, note: f.note || null }
      if (visit) return api.patch(`/visits/${visit.id}`, body)
      if (init?.proposal_id) return api.post('/visits', { ...body, proposal_id: init.proposal_id })
      return api.post('/visits', { ...body, title: f.title, year: f.year ? Number(f.year) : null, cinema_key: f.cinema_key })
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
    <Sheet open={open} onClose={onClose}>
      <h3>{visit ? 'Besuch bearbeiten' : 'Besuch eintragen'}</h3>
      <input className="field" placeholder="Film" value={f.title ?? ''} onChange={set('title')} disabled={locked} />
      {!locked && <input className="field" type="number" placeholder="Jahr" value={f.year ?? ''} onChange={set('year')} />}
      <select className="field" value={f.cinema_key ?? ''} onChange={set('cinema_key')} disabled={locked}>
        <option value="">Kino wählen…</option>
        {cinemas.data?.cinemas.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
      </select>
      <input className="field" type="date" value={f.watched_on ?? ''} onChange={set('watched_on')} />
      <input className="field" list="auds" placeholder="Saal" value={f.auditorium ?? ''} onChange={set('auditorium')} />
      <datalist id="auds">{cinema?.auditoriums.map((a) => <option key={a.name} value={a.name} />)}</datalist>
      <div className="two">
        <input className="field" placeholder="Reihe" value={f.row ?? ''} onChange={set('row')} />
        <input className="field" placeholder="Sitze" value={f.seats ?? ''} onChange={set('seats')} />
      </div>
      <textarea className="field" placeholder="kinoheld-Bestelltext einfügen (füllt Saal, Reihe, Sitze)" value={f.paste ?? ''} onChange={(e) => applyPaste(e.target.value)} />
      <div className="chips-row">
        {members.filter((m) => m.id !== me.id).map((m) => (
          <button key={m.id} className={`chip${f.companions?.includes(m.id) ? ' active' : ''}`} onClick={() => toggle(m.id)}>{m.name}</button>
        ))}
      </div>
      <input className="field" placeholder="Notiz" value={f.note ?? ''} onChange={set('note')} maxLength={500} />
      <div className="sheet-actions">
        {visit && <button className="btn danger" onClick={() => confirm('Besuch löschen?') && del.mutate()}>Löschen</button>}
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn primary" disabled={!canSave || save.isPending} onClick={() => save.mutate()}>Speichern</button>
      </div>
    </Sheet>
  )
}

export default function Besuche() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const [sheet, setSheet] = useState(null) // { visit } | { init } | {}
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me') })
  const visits = useQuery({ queryKey: ['visits'], queryFn: () => api.get('/visits'), refetchInterval: 30_000 })
  const pending = useQuery({ queryKey: ['pending'], queryFn: () => api.get('/visits/pending') })

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

  if (!me || !visits.data) return <p className="muted">Lädt…</p>
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
              {v.letterboxd_rating != null && <p className="stars">{stars(v.letterboxd_rating)}</p>}
              {mine && (
                <div className="sheet-actions">
                  <a className="btn primary" href={lb.app}>In Letterboxd bewerten</a>
                  <button className="btn" onClick={() => setSheet({ visit: v })}>Bearbeiten</button>
                </div>
              )}
              {mine && <a className="link-btn" href={lb.web} target="_blank" rel="noreferrer">Auf letterboxd.com öffnen</a>}
            </div>
          </section>
        )
      })}
      <VisitSheet open={sheet != null} onClose={close} members={members} me={me} init={sheet?.init} visit={sheet?.visit} />
    </>
  )
}
