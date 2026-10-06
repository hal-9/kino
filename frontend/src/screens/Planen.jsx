import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api.js'
import { MutationError, QueryError } from '../components/QueryStatus.jsx'

const fmt = (iso) => new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
const STRENGTH = { hard: 'muss', soft: 'lieber' }

// K27: Merkliste (eigenes Interesse, keine Stimme) mit echten aktuellen Vorstellungen.
function Watchlist() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['watchlist'], queryFn: () => api.get('/watchlist') })
  const remove = useMutation({ mutationFn: (id) => api.delete(`/watchlist/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['watchlist'] }) })
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
            <button className="mini" aria-label={`Von Merkliste entfernen: ${w.title}`} onClick={() => remove.mutate(w.movie_id)}>Entfernen</button>
          </div>
        ))}
        <MutationError mutation={remove} />
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

export default function Planen() {
  return (
    <>
      <Watchlist />
      <Preferences />
    </>
  )
}
