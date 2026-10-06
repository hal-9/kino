import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api, errorText } from '../api.js'
import { QueryError } from '../components/QueryStatus.jsx'
import CalendarLink from '../components/CalendarLink.jsx'

const stale = (s) => !s.last_ok_at || Date.now() - new Date(s.last_ok_at) > 36 * 3600_000

export default function Einstellungen() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me') })
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => api.get('/sources') })

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

  async function logout() {
    await api.post('/logout').catch(() => {})
    qc.clear()
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
        </div>
      </section>
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
