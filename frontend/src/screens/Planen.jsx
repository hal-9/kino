import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, newKey } from '../api.js'
import { loadDraft, saveDraft } from './Programm.jsx'
import { MutationError, QueryError } from '../components/QueryStatus.jsx'

const fmt = (iso) => new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
const STRENGTH = { hard: 'muss', soft: 'lieber' }

// K27: Merkliste (eigenes Interesse, keine Stimme) mit echten aktuellen Vorstellungen.
function Watchlist() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['watchlist'], queryFn: () => api.get('/watchlist') })
  const remove = useMutation({ mutationFn: (id) => api.delete(`/watchlist/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['watchlist'] }) })
  const mute = useMutation({ mutationFn: (w) => api.put(`/radar/watch/${w.movie_id}`, { muted: !w.radar_muted }), onSuccess: () => qc.invalidateQueries({ queryKey: ['watchlist'] }) })
  const items = list.data?.items ?? []
  return (
    <section className="group">
      <h2 className="group-title">Merkliste</h2>
      <div className="card">
        <QueryError query={list} label="Merkliste" />
        {list.data && !items.length && <p className="note pad">Noch nichts gemerkt. In den Film-Details auf „Merken“ tippen. Merken ist keine Stimme und keine Buchung.</p>}
        {items.map((w) => (
          <div key={w.movie_id} className="show">
            <span className="show-main">
              <strong>{w.title}{w.year ? ` (${w.year})` : ''}</strong>
              <small>
                {w.expired ? 'Abgelaufen' : w.upcoming ? <Link to={`/?q=${encodeURIComponent(w.title)}`}>{w.upcoming} aktuelle Vorstellungen vergleichen</Link> : 'Zurzeit keine Vorstellungen'}
                {w.expires_on && !w.expired && ` · bis ${new Date(`${w.expires_on}T12:00:00`).toLocaleDateString('de-DE')}`}
              </small>
            </span>
            <button className="mini" aria-pressed={w.radar_muted} aria-label={`Radar stumm: ${w.title}`} onClick={() => mute.mutate(w)}>{w.radar_muted ? 'Stumm' : 'Radar an'}</button>
            <button className="mini" aria-label={`Von Merkliste entfernen: ${w.title}`} onClick={() => remove.mutate(w.movie_id)}>Entfernen</button>
          </div>
        ))}
        <MutationError mutation={remove} />
        <MutationError mutation={mute} />
      </div>
    </section>
  )
}

// K27: Vorlieben (muss/lieber) und eingetragene Zeiten; ohne Angabe = unbekannt.
function Preferences() {
  const qc = useQueryClient()
  const plan = useQuery({ queryKey: ['planning'], queryFn: () => api.get('/planning') })
  const cinemas = useQuery({ queryKey: ['cinemas'], queryFn: () => api.get('/cinemas') })
  const [f, setF] = useState(null)
  useEffect(() => {
    if (!plan.data) return
    const p = plan.data.prefs
    setF({
      version: p.version?.value ?? '', versionStrength: p.version?.strength ?? 'soft',
      cinemas: p.cinemas?.keys ?? [], cinemaStrength: p.cinemas?.strength ?? 'soft',
      earliest: p.earliest ?? '', latest_end: p.latest_end ?? '', buffer: p.buffer_minutes, visibility: plan.data.visibility,
    })
  }, [plan.data])
  const done = () => qc.invalidateQueries({ queryKey: ['planning'] })
  const save = useMutation({
    mutationFn: () => api.put('/planning/prefs', {
      prefs: {
        version: f.version ? { value: f.version, strength: f.versionStrength } : null,
        cinemas: f.cinemas.length ? { keys: f.cinemas, strength: f.cinemaStrength } : null,
        earliest: f.earliest || null, latest_end: f.latest_end || null, buffer_minutes: Number(f.buffer) || 0,
      },
      visibility: f.visibility,
    }),
    onSuccess: done,
  })
  const clear = useMutation({ mutationFn: () => api.delete('/planning/prefs'), onSuccess: done })
  const [slot, setSlot] = useState({ date: '', from: '19:00', to: '23:30', kind: 'free' })
  const add = useMutation({ mutationFn: () => api.post('/planning/availability', slot), onSuccess: done })
  const del = useMutation({ mutationFn: (id) => api.delete(`/planning/availability/${id}`), onSuccess: done })
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const toggleCinema = (key) => setF((x) => ({ ...x, cinemas: x.cinemas.includes(key) ? x.cinemas.filter((c) => c !== key) : [...x.cinemas, key] }))
  const strength = (k, label) => (
    <select className="field" aria-label={label} value={f[k]} onChange={set(k)}>
      <option value="hard">{STRENGTH.hard}</option><option value="soft">{STRENGTH.soft}</option>
    </select>
  )
  return (
    <section className="group">
      <h2 className="group-title">Meine Vorlieben und Zeiten</h2>
      <div className="card pad">
        <QueryError query={plan} label="Vorlieben" />
        {f && (
          <>
            <p className="sub">„muss“ schließt Vorstellungen aus, „lieber“ sortiert nur. Leer = keine Angabe (bleibt unbekannt).</p>
            <div className="two">
              <select className="field" aria-label="Fassung" value={f.version} onChange={set('version')}>
                <option value="">Fassung: keine Angabe</option><option value="ov">OV/OmU</option><option value="df">Deutsch</option>
              </select>
              {strength('versionStrength', 'Fassung: muss oder lieber')}
            </div>
            <fieldset className="sub">
              <legend>Kinos</legend>
              {(cinemas.data?.cinemas ?? []).filter((c) => c.is_favorite || f.cinemas.includes(c.key)).map((c) => (
                <label key={c.key}><input type="checkbox" checked={f.cinemas.includes(c.key)} onChange={() => toggleCinema(c.key)} /> {c.name} </label>
              ))}
            </fieldset>
            {strength('cinemaStrength', 'Kinos: muss oder lieber')}
            <div className="two">
              <label className="sub">Beginn ab <input className="field" type="time" aria-label="Beginn frühestens" value={f.earliest} onChange={set('earliest')} /></label>
              <label className="sub">Ende bis <input className="field" type="time" aria-label="Ende spätestens" value={f.latest_end} onChange={set('latest_end')} /></label>
            </div>
            <label className="sub">Puffer nach dem Film (Min.) <input className="field" type="number" min="0" max="120" aria-label="Puffer in Minuten" value={f.buffer} onChange={set('buffer')} /></label>
            <label className="sub">
              <input type="checkbox" checked={f.visibility === 'household'} onChange={(e) => setF((x) => ({ ...x, visibility: e.target.checked ? 'household' : 'fit_only' }))} />
              {' '}Vorlieben für den Haushalt sichtbar (sonst sehen andere nur „passt / passt nicht / unbekannt“)
            </label>
            <MutationError mutation={save} />
            <div className="sheet-actions">
              <button className="btn primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isSuccess ? 'Gespeichert ✓' : 'Speichern'}</button>
              <button className="btn" onClick={() => confirm('Vorlieben und Zeiten löschen?') && clear.mutate()}>Alles zurücksetzen</button>
            </div>
            <h3>Zeiten</h3>
            <p className="sub">Nur hier eingetragen, kein Kalenderzugriff. Andere sehen nur, ob eine Vorstellung passt.</p>
            <ul className="sub" aria-label="Eingetragene Zeiten">
              {plan.data.availability.map((a) => (
                <li key={a.id}>{a.kind === 'free' ? 'Kann' : 'Kann nicht'}: {fmt(a.starts_at)} – {fmt(a.ends_at)}{' '}
                  <button className="link-btn" onClick={() => del.mutate(a.id)}>Löschen</button></li>
              ))}
            </ul>
            <div className="two">
              <input className="field" type="date" aria-label="Tag" value={slot.date} onChange={(e) => setSlot({ ...slot, date: e.target.value })} />
              <select className="field" aria-label="Art" value={slot.kind} onChange={(e) => setSlot({ ...slot, kind: e.target.value })}>
                <option value="free">kann</option><option value="busy">kann nicht</option>
              </select>
              <input className="field" type="time" aria-label="Von" value={slot.from} onChange={(e) => setSlot({ ...slot, from: e.target.value })} />
              <input className="field" type="time" aria-label="Bis" value={slot.to} onChange={(e) => setSlot({ ...slot, to: e.target.value })} />
            </div>
            <MutationError mutation={add} text={(e) => (e.code === 'ambiguous time' ? 'Diese Uhrzeit gibt es am Tag der Zeitumstellung nicht eindeutig.' : e.code === 'in the past' ? 'Dieser Zeitraum ist schon vorbei.' : undefined)} />
            <button className="btn" disabled={!slot.date || add.isPending} onClick={() => add.mutate()}>Zeit eintragen</button>
          </>
        )}
      </div>
    </section>
  )
}

const FIT = { fit: 'passt', no: 'passt nicht', unknown: 'unbekannt' }
const REASON = {
  version: 'Fassung passt nicht', version_unknown: 'Fassung unbekannt', cinema: 'anderes Kino', time: 'Uhrzeit passt nicht',
  runtime_unknown: 'Laufzeit unbekannt', availability: 'keine Zeit', availability_unknown: 'Zeit nicht eingetragen',
}
const PART = { interest: 'gemerkt', cinema: 'Wunschkino', version: 'Wunschfassung' }
const STATUS = { feasible: 'Passt für alle', tentative: 'Unsicher: nicht alles bekannt', partial: 'Passt nicht für alle' }

// K28: Vorschläge aus echten Vorstellungen mit Begründung. Übergabe nur in die Auswahl (ein Film); Senden bleibt beim Menschen.
function NextNight() {
  const navigate = useNavigate()
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me') })
  const plan = useQuery({ queryKey: ['planning'], queryFn: () => api.get('/planning') })
  const people = me && plan.data ? [{ id: me.id, name: me.name }, ...plan.data.members] : []
  const names = Object.fromEntries(people.map((p) => [p.id, p.name]))
  const [picked, setPicked] = useState(null) // null = alle
  const [mode, setMode] = useState('all')
  const ids = picked ?? people.map((p) => p.id)
  const [query, setQuery] = useState(null)
  const match = useQuery({ queryKey: ['match', query], queryFn: () => api.get(`/match?${query}`), enabled: query != null })
  const run = () => {
    const q = new URLSearchParams({ mode, participants: ids.join(',') }).toString()
    q === query ? match.refetch() : setQuery(q)
  }
  const toggle = (id) => setPicked(ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id])
  function handoff(s) {
    const d = loadDraft()
    const show = { id: s.id, starts_at: s.starts_at, cinema_name: s.cinema_name, auditorium: s.auditorium, version: s.version, attrs: s.attrs }
    if (d && d.movie.id !== s.movie_id && !confirm(`Auswahl für „${d.movie.title}“ verwerfen?`)) return
    const same = d && d.movie.id === s.movie_id
    if (same && (d.shows.some((x) => x.id === s.id) || d.shows.length >= 5)) return navigate(`/?q=${encodeURIComponent(s.title)}`)
    saveDraft(same ? { ...d, shows: [...d.shows, show].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)) }
      : { movie: { id: s.movie_id, title: s.title, runtime: s.runtime }, shows: [show], note: '', key: newKey() })
    navigate(`/?q=${encodeURIComponent(s.title)}`)
  }
  const r = match.data
  return (
    <section className="group">
      <h2 className="group-title">Nächster Kinoabend</h2>
      <div className="card pad">
        <p className="sub">Sucht unter den Vorstellungen gemerkter Filme der nächsten 14 Tage. Schlägt nur vor: abstimmen, vorschlagen und buchen bleibt bei euch.</p>
        <fieldset className="sub">
          <legend>Wer kommt mit?</legend>
          {people.map((p) => <label key={p.id}><input type="checkbox" checked={ids.includes(p.id)} onChange={() => toggle(p.id)} /> {p.name} </label>)}
        </fieldset>
        <div className="chips-row">
          <button className={`chip${mode === 'all' ? ' active' : ''}`} aria-pressed={mode === 'all'} onClick={() => setMode('all')}>Alle müssen können</button>
          <button className={`chip${mode === 'max' ? ' active' : ''}`} aria-pressed={mode === 'max'} onClick={() => setMode('max')}>Möglichst viele</button>
        </div>
        <button className="btn primary" disabled={!ids.length} onClick={run}>Vorschläge finden</button>
        <QueryError query={match} label="Vorschläge" />
        {r && !r.results.length && (
          <p className="sub" role="status">
            {r.movies === 0 ? 'Niemand hat einen Film gemerkt.' : `Keine passende Vorstellung (${r.considered} geprüft).`}
            {Object.keys(r.excluded).length > 0 && ` Ausgeschlossen wegen: ${Object.entries(r.excluded).map(([k, n]) => `${REASON[k] ?? k} (${n})`).join(', ')}.`}
            {mode === 'all' && r.movies > 0 && ' „Möglichst viele“ zeigt, wer wann könnte.'}
          </p>
        )}
        {r?.results.map(({ screening: s, status, score, parts, people: fits }) => (
          <div key={s.id} className="opt" aria-label={`Vorschlag ${s.title} ${s.cinema_name}`}>
            <strong>{s.title} · {fmt(s.starts_at)} · {s.cinema_name}</strong>
            <small>{[s.auditorium, s.version ?? 'Fassung unbekannt', s.runtime ? `${s.runtime} min` : 'Laufzeit unbekannt'].filter(Boolean).join(' · ')}</small>
            <small>{STATUS[status]}{score > 0 && ` · ${parts.map((p) => `${p.people}× ${PART[p.code]} (+${p.points})`).join(', ')}`}</small>
            <ul className="sub">
              {fits.map((f) => <li key={f.user_id}>{names[f.user_id] ?? 'Jemand'}: {FIT[f.fit]}{f.reasons?.length ? ` (${f.reasons.map((x) => REASON[x] ?? x).join(', ')})` : ''}</li>)}
            </ul>
            <button className="mini" onClick={() => handoff(s)}>In die Auswahl übernehmen</button>
          </div>
        ))}
        {r && <p className="sub">Stand der Daten: {new Date(r.generated_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}. Ob es noch Tickets gibt, steht nur beim Kino.</p>}
      </div>
    </section>
  )
}

const KIND = { watch_available: 'Läuft laut Programm', booked_change: 'Änderung an eurer Buchung' }
const FIELD = { starts_at: 'Uhrzeit', cinema: 'Kino', version: 'Fassung', auditorium: 'Saal', availability: 'Verfügbarkeit' }

// K29: Radar-Posteingang (nur in der App). Ohne Einwilligung nur ein Hinweis auf die Einstellungen.
function RadarInbox() {
  const qc = useQueryClient()
  const radar = useQuery({ queryKey: ['radar'], queryFn: () => api.get('/radar') })
  const read = useMutation({ mutationFn: (id) => api.post(`/radar/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ['radar'] }) })
  const r = radar.data
  if (!r) return <QueryError query={radar} label="Radar" />
  if (!r.settings.enabled && !r.inbox.length) return null
  return (
    <section className="group">
      <h2 className="group-title">Radar</h2>
      <div className="card">
        {!r.inbox.length && <p className="note pad">Noch keine Hinweise.</p>}
        {r.inbox.map((e) => (
          <Link key={e.id} className="show" to={e.link} onClick={() => !e.read_at && read.mutate(e.id)}>
            <span className="show-main">
              <strong>{e.read_at ? '' : '● '}{e.title}</strong>
              <small>{KIND[e.kind]}{e.field ? `: ${FIELD[e.field] ?? e.field}${e.certainty === 'uncertain' ? ' (unsicher)' : ''}` : ''}</small>
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}

export default function Planen() {
  return (
    <>
      <RadarInbox />
      <NextNight />
      <Watchlist />
      <Preferences />
    </>
  )
}
