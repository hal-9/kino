import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api, errorText } from '../api.js'
import { MutationError, QueryError } from '../components/QueryStatus.jsx'
import CalendarLink from '../components/CalendarLink.jsx'
import { clearOfflineData } from '../lib/offline.js'

const stale = (s) => !s.last_ok_at || Date.now() - new Date(s.last_ok_at) > 36 * 3600_000

// K29: Einwilligung für das Kino-Radar (nur Hinweise in der App, kein Push/E-Mail), Ruhezeit, Tageslimit, Zustellstatus.
function RadarSettings() {
  const qc = useQueryClient()
  const radar = useQuery({ queryKey: ['radar'], queryFn: () => api.get('/radar') })
  const [f, setF] = useState(null)
  useEffect(() => { if (radar.data?.settings) setF({ ...radar.data.settings, quiet_start: radar.data.settings.quiet_start ?? '', quiet_end: radar.data.settings.quiet_end ?? '' }) }, [radar.data])
  const save = useMutation({
    mutationFn: (next) => api.put('/radar/settings', { enabled: next.enabled, quiet_start: next.quiet_start || null, quiet_end: next.quiet_end || null, daily_cap: Number(next.daily_cap) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['radar'] }),
  })
  const o = radar.data?.outbox ?? {}
  return (
    <section className="group">
      <h2 className="group-title">Kino-Radar</h2>
      <div className="card pad">
        <QueryError query={radar} label="Radar" />
        {f && (
          <>
            <p className="sub">Hinweise nur hier in der App (Planen), wenn ein gemerkter Film ins Programm kommt oder sich eure Buchung ändert. Keine Push-Nachrichten, keine E-Mails.</p>
            <label className="sub"><input type="checkbox" checked={f.enabled} onChange={(e) => save.mutate({ ...f, enabled: e.target.checked })} /> Radar-Hinweise erhalten</label>
            <div className="two">
              <label className="sub">Ruhe ab <input className="field" type="time" aria-label="Ruhezeit ab" value={f.quiet_start} onChange={(e) => setF({ ...f, quiet_start: e.target.value })} /></label>
              <label className="sub">Ruhe bis <input className="field" type="time" aria-label="Ruhezeit bis" value={f.quiet_end} onChange={(e) => setF({ ...f, quiet_end: e.target.value })} /></label>
            </div>
            <label className="sub">Höchstens pro Tag <input className="field" type="number" min="1" max="20" aria-label="Höchstens pro Tag" value={f.daily_cap} onChange={(e) => setF({ ...f, daily_cap: e.target.value })} /></label>
            <MutationError mutation={save} />
            <button className="btn" disabled={save.isPending} onClick={() => save.mutate(f)}>Radar-Einstellungen speichern</button>
            {(o.pending > 0 || o.failed > 0) && <p className="sub" role="status">{o.pending ?? 0} wartend{o.failed ? ` · ${o.failed} nicht zustellbar` : ''}</p>}
          </>
        )}
      </div>
    </section>
  )
}

export default function Einstellungen() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me') })
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => api.get('/sources') })
  const coord = useQuery({ queryKey: ['coordination'], queryFn: () => api.get('/stats/coordination?days=90') })
  const c = coord.data

  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/settings') })
  const [lb, setLb] = useState('')
  const [saved, setSaved] = useState(false)
  const [lbError, setLbError] = useState(null)
  useEffect(() => { if (settings.data) setLb(settings.data.letterboxd_user ?? '') }, [settings.data])
  async function saveLb() {
    setLbError(null)
    try {
      await api.patch('/me', { letterboxd_user: lb.trim() })
      setSaved(true)
    } catch (err) {
      setLbError(err.status === 422 ? 'Nur Buchstaben, Ziffern, _ und - (max. 40).' : errorText(err))
    }
  }

  const [syncError, setSyncError] = useState(null)
  async function resync() {
    setSyncError(null)
    try {
      await api.post('/letterboxd/resync')
      qc.invalidateQueries({ queryKey: ['settings'] })
      qc.invalidateQueries({ queryKey: ['visits'] })
    } catch (err) {
      setSyncError(err.status === 429 ? 'Gerade erst abgeglichen. Bitte in einer Minute erneut.' : errorText(err))
    }
  }
  const st = settings.data?.letterboxd
  const day = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('de-DE')

  async function logout() {
    await api.post('/logout').catch(() => {})
    qc.clear()
    clearOfflineData()
    navigate('/login', { replace: true })
  }

  return (
    <>
      <section className="group">
        <h2 className="group-title">{me?.name} · {me?.household.name}</h2>
      </section>
      <section className="group">
        <h2 className="group-title">Letterboxd</h2>
        <div className="card pad">
          <p className="sub">Dein Nutzername, damit Bewertungen am nächsten Tag automatisch an den Besuch kommen.</p>
          <input className="field" aria-label="Letterboxd-Name" placeholder="letterboxd-Name" value={lb} onChange={(e) => { setLb(e.target.value); setSaved(false) }} />
          {lbError && <p className="stale" role="alert">{lbError}</p>}
          <button className="btn primary" onClick={saveLb}>{saved ? 'Gespeichert ✓' : 'Speichern'}</button>
          {settings.data?.letterboxd_user && (
            <>
              <p className="sub" role="status">
                {st?.attempt_at ? `Letzter Abgleich: ${new Date(st.attempt_at).toLocaleString('de-DE')}` : 'Noch nicht abgeglichen.'}
                {st?.error && ` · Fehler: ${st.error}`}
                {!st?.error && st?.from && ` · Feed deckt ${day(st.from)}–${day(st.to)} ab`}
                {st?.ambiguous > 0 && ` · ${st.ambiguous} Besuch(e) nicht eindeutig zuzuordnen (bitte selbst bewerten)`}
                {st?.other_account > 0 && ` · ${st.other_account} Bewertung(en) stammen von einem früheren Konto`}
              </p>
              <p className="sub">Der Feed enthält nur die letzten Einträge. Ältere Bewertungen bleiben erhalten; eigene Bewertungen am Besuch haben Vorrang.</p>
              {syncError && <p className="stale" role="alert">{syncError}</p>}
              <button className="btn" onClick={resync}>Jetzt abgleichen</button>
            </>
          )}
        </div>
      </section>
      <section className="group">
        <h2 className="group-title">Planung · letzte {c?.days ?? 90} Tage</h2>
        <div className="card pad">
          <QueryError query={coord} label="Kennzahlen" />
          {c && (
            <ul className="sub" aria-label="Planungs-Kennzahlen">
              <li>Vorschläge: {c.proposals.created} angelegt · {c.proposals.booked} gebucht · {c.proposals.cancelled} abgesagt · {c.proposals.open} offen</li>
              <li>Gebucht von entschiedenen: {c.proposals.booked_share_of_decided == null ? '–' : `${Math.round(c.proposals.booked_share_of_decided * 100)} %`}</li>
              <li>Zeit bis zur Buchung (Median): {c.decision_hours_median == null ? '–' : `${String(c.decision_hours_median).replace('.', ',')} h (aus ${c.decided_with_time})`}</li>
              <li>Offene Abstimmungen: {c.open_waiting.proposals} warten auf {c.open_waiting.unanswered_people} Antwort(en)</li>
              <li>Quellen mit Fehler: {c.sources.failing.length ? c.sources.failing.join(', ') : 'keine'} (von {c.sources.total})</li>
              <li>Geprüfte Programmänderungen: {c.changes_reviewed}</li>
              <li>Besuche: {c.visits.confirmed} bestätigt · {c.visits.manual} selbst eingetragen · {c.visits.inferred + c.visits.legacy} abgeleitet, unbestätigt</li>
            </ul>
          )}
          <p className="sub">Nur Zahlen dieses Haushalts aus vorhandenen Daten, ohne Notizen oder Tickets. Kleine Zahlen zeigen Tendenzen, keine Ursachen.</p>
        </div>
      </section>
      <RadarSettings />
      <section className="group">
        <h2 className="group-title">Kalender-Abo</h2>
        <div className="card pad">
          <CalendarLink />
        </div>
      </section>
      <section className="group">
        <h2 className="group-title">Datenquellen</h2>
        <div className="card">
          <QueryError query={sources} label="Datenquellen" />
          {(sources.data?.sources ?? []).map((s) => (
            <div key={s.source} className="show">
              <span className="show-main">
                <strong>{s.source}</strong>
                <small>{s.last_error ? `Fehler: ${s.last_error}` : `${s.last_count} Vorstellungen`} · {s.last_ok_at ? new Date(s.last_ok_at).toLocaleString('de-DE') : 'nie'}</small>
              </span>
              <span className={`badge${stale(s) ? ' ov' : ''}`}>{stale(s) ? 'veraltet' : 'ok'}</span>
            </div>
          ))}
        </div>
      </section>
      <button className="btn danger" onClick={logout}>Abmelden</button>
    </>
  )
}
