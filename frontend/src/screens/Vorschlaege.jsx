import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api.js'
import Sheet from '../components/Sheet.jsx'
import { initial } from '../components/Header.jsx'

const MARK = { yes: '✓', maybe: '?', no: '✗' }
const when = (iso) => new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'Europe/Berlin' }) + ' · ' + iso.slice(11, 16)

function score(o) {
  const v = Object.values(o.votes)
  return v.filter((x) => x === 'yes').length * 10 - v.filter((x) => x === 'no').length
}

function Proposal({ p, members, me }) {
  const qc = useQueryClient()
  const [pick, setPick] = useState(null)
  const [abo, setAbo] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ['proposals'] })
  const vote = useMutation({ mutationFn: ({ o, value }) => api.put(`/proposals/${p.id}/votes/${o}`, { value }), onSuccess: refresh })
  const book = useMutation({ mutationFn: (option_id) => api.post(`/proposals/${p.id}/book`, { option_id }), onSuccess: () => { setPick(null); refresh() } })
  const cancel = useMutation({ mutationFn: () => api.post(`/proposals/${p.id}/cancel`), onSuccess: refresh })
  const cal = useQuery({ queryKey: ['cal'], queryFn: () => api.get('/cal/token'), enabled: abo })

  const best = p.status === 'open' ? [...p.options].sort((a, b) => score(b) - score(a))[0] : null
  const booked = p.options.find((o) => o.id === p.booked_option_id)
  const past = booked && new Date(booked.snapshot.starts_at) < new Date()

  return (
    <section className="group">
      <h2 className="group-title">
        {p.movie.title}
        <span className="n">{p.status === 'booked' ? '✓ gebucht' : 'offen'}</span>
      </h2>
      <div className="card">
        {p.note && <p className="note">{p.note}</p>}
        {p.options.map((o) => {
          const s = o.snapshot
          const mine = o.votes[me.id]
          return (
            <div key={o.id} className={`opt${o.id === best?.id && score(o) > 0 ? ' best' : ''}${o.id === p.booked_option_id ? ' booked' : ''}`}>
              <div className="opt-head">
                <strong>{when(s.starts_at)}</strong>
                {s.version && <span className={`badge ${s.version === 'DF' ? '' : 'ov'}`}>{s.version}</span>}
              </div>
              <small className="muted">{[s.cinema_name, s.auditorium].filter(Boolean).join(' · ')}</small>
              <div className="opt-votes">
                {members.map((m) => (
                  <span key={m.id} className={`avatar v-${o.votes[m.id] ?? 'none'}`} title={`${m.name}: ${o.votes[m.id] ?? 'offen'}`}>
                    {initial(m.name)}<i>{MARK[o.votes[m.id]] ?? ''}</i>
                  </span>
                ))}
                {p.status === 'open' && (
                  <span className="tri">
                    {['yes', 'maybe', 'no'].map((v) => (
                      <button key={v} className={mine === v ? `on ${v}` : ''} onClick={() => vote.mutate({ o: o.id, value: v })}>{MARK[v]}</button>
                    ))}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="sheet-actions">
        {p.status === 'open' && (
          <>
            <button className="btn" onClick={() => cancel.mutate()}>Verwerfen</button>
            <button className="btn primary" onClick={() => setPick(best?.id ?? p.options[0].id)}>Gebucht</button>
          </>
        )}
        {p.status === 'booked' && (
          <>
            <a className="btn" href={`/api/proposals/${p.id}.ics`}>.ics laden</a>
            <button className="btn" onClick={() => setAbo(true)}>Kalender abonnieren</button>
            {past && <Link className="btn primary" to={`/besuche?proposal=${p.id}`}>Besuch eintragen</Link>}
          </>
        )}
      </div>

      <Sheet open={pick != null} onClose={() => setPick(null)}>
        <h3>Welche Vorstellung ist gebucht?</h3>
        <div className="cat-grid" style={{ gridTemplateColumns: '1fr' }}>
          {p.options.map((o) => (
            <button key={o.id} className={pick === o.id ? 'active' : ''} onClick={() => setPick(o.id)}>
              {when(o.snapshot.starts_at)} · {o.snapshot.cinema_name}
            </button>
          ))}
        </div>
        <div className="sheet-actions">
          <button className="btn" onClick={() => setPick(null)}>Abbrechen</button>
          <button className="btn primary" onClick={() => book.mutate(pick)} disabled={book.isPending}>Als gebucht speichern</button>
        </div>
      </Sheet>

      <Sheet open={abo} onClose={() => setAbo(false)}>
        <h3>Kalender abonnieren</h3>
        <p className="sub">Einmal abonnieren reicht: alle künftigen Buchungen erscheinen automatisch. Auf dem iPhone öffnet der Link den Abo-Dialog.</p>
        {cal.data && <a className="btn primary" href={cal.data.webcal_url}>In Kalender öffnen</a>}
      </Sheet>
    </section>
  )
}

export default function Vorschlaege() {
  const { id } = useParams()
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me') })
  const { data, isLoading } = useQuery({ queryKey: ['proposals'], queryFn: () => api.get('/proposals'), refetchInterval: 10_000 })
  if (isLoading || !me) return <p className="muted">Lädt…</p>
  const list = data.proposals.filter((p) => !id || p.id === Number(id))
  return (
    <>
      {id && <Link className="link-btn" to="/vorschlaege">← Alle Vorschläge</Link>}
      {list.length === 0 && (
        <div className="empty"><h2>Noch nichts vorgeschlagen</h2><p>Im Programm „Vorschlagen“ bei einem Film tippen und 2–5 Vorstellungen wählen.</p></div>
      )}
      {list.map((p) => <Proposal key={p.id} p={p} members={data.members} me={me} />)}
    </>
  )
}
