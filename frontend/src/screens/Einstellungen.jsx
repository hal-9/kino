import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'

const stale = (s) => !s.last_ok_at || Date.now() - new Date(s.last_ok_at) > 36 * 3600_000

export default function Einstellungen() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me') })
  const cal = useQuery({ queryKey: ['cal'], queryFn: () => api.get('/cal/token') })
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => api.get('/sources') })

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
        <h2 className="group-title">Kalender-Abo</h2>
        <div className="card pad">
          <p className="sub">Alle gebuchten Kinobesuche der Gruppe. Einmal abonnieren, dann aktualisiert sich der Kalender selbst.</p>
          {cal.data && (
            <>
              <a className="btn primary" href={cal.data.webcal_url}>Abonnieren</a>{' '}
              <button className="btn" onClick={() => navigator.clipboard?.writeText(cal.data.https_url)}>Link kopieren</button>
            </>
          )}
        </div>
      </section>
      <section className="group">
        <h2 className="group-title">Datenquellen</h2>
        <div className="card">
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
