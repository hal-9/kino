import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, errorText } from '../api.js'
import { MutationError, QueryError } from '../components/QueryStatus.jsx'
import Sheet from '../components/Sheet.jsx'
import MovieSheet from '../components/MovieSheet.jsx'
import MovieHeader from '../components/MovieHeader.jsx'
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
  const [link, setLink] = useState('')
  const [info, setInfo] = useState(false)
  const [ticketSheet, setTicketSheet] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ['proposals'] })
  // Stimmen je Option nacheinander senden, nur die jeweils neueste Absicht zählt: keine überholten Antworten,
  // keine umgeordneten Requests am Server. intent zeigt die Absicht bis zur Bestätigung.
  const [intent, setIntent] = useState({})
  const [voteError, setVoteError] = useState(null)
  const queue = useRef({})
  async function castVote(o, value) {
    setVoteError(null)
    setIntent((x) => ({ ...x, [o]: value }))
    const q = (queue.current[o] ??= { next: null, sending: false })
    q.next = value
    if (q.sending) return
    q.sending = true
    let failed = null
    while (q.next) {
      const v = q.next
      q.next = null
      try { await api.put(`/proposals/${p.id}/votes/${o}`, { value: v }) } catch (err) { failed = err; q.next = null }
    }
    q.sending = false
    if (failed) setVoteError(failed)
    await refresh()
    if (!q.sending) setIntent((x) => { const { [o]: _, ...rest } = x; return rest })
  }
  const book = useMutation({ mutationFn: (option_id) => api.post(`/proposals/${p.id}/book`, { option_id, ticket_link: link.trim() || undefined }), onSuccess: () => { setPick(null); setLink(''); refresh() } })
  const saveTicket = useMutation({ mutationFn: () => api.put(`/proposals/${p.id}/ticket`, { ticket_link: link.trim() || null }), onSuccess: () => { setTicketSheet(false); refresh() } })
  const cancel = useMutation({ mutationFn: () => api.post(`/proposals/${p.id}/cancel`), onSuccess: refresh })
  const cal = useQuery({ queryKey: ['cal'], queryFn: () => api.get('/cal/token'), enabled: abo })

  const best = p.status === 'open' ? [...p.options].sort((a, b) => score(b) - score(a))[0] : null
  const booked = p.options.find((o) => o.id === p.booked_option_id)
  const past = booked && new Date(booked.snapshot.starts_at) < new Date()

  return (
    <section className="group">
      <MovieHeader movie={p.movie} onInfo={() => setInfo(true)} />
      <p className="status-line">{p.status === 'booked' ? '✓ gebucht' : 'offen'}</p>
      <div className="card">
        {p.note && <p className="note">{p.note}</p>}
        {p.options.map((o) => {
          const s = o.snapshot
          const mine = intent[o.id] ?? o.votes[me.id]
          const voteOf = (uid) => (uid === me.id ? mine : o.votes[uid])
          return (
            <div key={o.id} className={`opt${o.id === best?.id && score(o) > 0 ? ' best' : ''}${o.id === p.booked_option_id ? ' booked' : ''}`}>
              <div className="opt-head">
                <strong>{when(s.starts_at)}</strong>
                {s.version && <span className={`badge ${s.version === 'DF' ? '' : 'ov'}`}>{s.version}</span>}
              </div>
              <small className="muted">{[s.cinema_name, s.auditorium].filter(Boolean).join(' · ')}</small>
              <div className="opt-votes">
                {members.map((m) => (
                  <span key={m.id} className={`avatar v-${voteOf(m.id) ?? 'none'}`} title={`${m.name}: ${voteOf(m.id) ?? 'offen'}`}>
                    {initial(m.name)}<i>{MARK[voteOf(m.id)] ?? ''}</i>
                  </span>
                ))}
                {p.status === 'open' && (
                  <span className="tri">
                    {['yes', 'maybe', 'no'].map((v) => (
                      <button key={v} className={mine === v ? `on ${v}` : ''} onClick={() => castVote(o.id, v)}>{MARK[v]}</button>
                    ))}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {voteError && <p className="stale" role="alert">Stimme nicht gespeichert. {errorText(voteError)}</p>}
      <MutationError mutation={cancel} />
      <div className="sheet-actions">
        {p.status === 'open' && (
          <>
            <button className="btn" onClick={() => cancel.mutate()}>Verwerfen</button>
            <button className="btn primary" onClick={() => setPick(best?.id ?? p.options[0].id)}>Gebucht</button>
          </>
        )}
        {p.status === 'booked' && (
          <>
            {p.ticket_link
              ? <a className="btn primary" href={p.ticket_link} target="_blank" rel="noreferrer">Tickets öffnen</a>
              : <button className="btn primary" onClick={() => { setLink(''); setTicketSheet(true) }}>Ticket-Link hinzufügen</button>}
            {p.ticket_link && <button className="btn" onClick={() => { setLink(p.ticket_link); setTicketSheet(true) }}>Link ändern</button>}
            <a className="btn" href={`/api/proposals/${p.id}.ics`}>.ics laden</a>
            <button className="btn" onClick={() => setAbo(true)}>Kalender abonnieren</button>
            {past && <Link className="btn" to="/besuche">Zum Besuch</Link>}
          </>
        )}
      </div>

      <MovieSheet movieId={info ? p.movie.id : null} onClose={() => setInfo(false)} />

      <Sheet open={pick != null} onClose={() => setPick(null)}>
        <h3>Welche Vorstellung ist gebucht?</h3>
        <div className="cat-grid" style={{ gridTemplateColumns: '1fr' }}>
          {p.options.map((o) => (
            <button key={o.id} className={pick === o.id ? 'active' : ''} onClick={() => setPick(o.id)}>
              {when(o.snapshot.starts_at)} · {o.snapshot.cinema_name}
            </button>
          ))}
        </div>
        <input className="field" type="url" placeholder="Ticket-Link aus der Bestätigungs-Mail (optional)" value={link} onChange={(e) => setLink(e.target.value)} />
        <MutationError mutation={book} text={(e) => (e.code === 'expired' ? 'Diese Vorstellung hat schon begonnen.' : errorText(e))} />
        <div className="sheet-actions">
          <button className="btn" onClick={() => setPick(null)}>Abbrechen</button>
          <button className="btn primary" onClick={() => book.mutate(pick)} disabled={book.isPending}>Als gebucht speichern</button>
        </div>
      </Sheet>

      <Sheet open={ticketSheet} onClose={() => setTicketSheet(false)}>
        <h3>Ticket-Link</h3>
        <p className="sub">Link zu den gekauften Tickets (Wallet, PDF oder Bestätigungsseite). Er landet im Kalendereintrag.</p>
        <input className="field" type="url" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} />
        <MutationError mutation={saveTicket} />
        <div className="sheet-actions">
          <button className="btn" onClick={() => setTicketSheet(false)}>Abbrechen</button>
          <button className="btn primary" disabled={saveTicket.isPending} onClick={() => saveTicket.mutate()}>Speichern</button>
        </div>
      </Sheet>

      <Sheet open={abo} onClose={() => setAbo(false)}>
        <h3>Kalender abonnieren</h3>
        <p className="sub">Einmal abonnieren reicht: alle künftigen Buchungen erscheinen automatisch. Auf dem iPhone öffnet der Link den Abo-Dialog.</p>
        {cal.data && <a className="btn primary" href={cal.data.webcal_url}>In Kalender öffnen</a>}
        <QueryError query={cal} label="Kalender-Links" />
      </Sheet>
    </section>
  )
}

export default function Vorschlaege() {
  const { id } = useParams()
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me') })
  const proposals = useQuery({ queryKey: ['proposals'], queryFn: () => api.get('/proposals'), refetchInterval: 10_000 })
  const { data } = proposals
  if (!data) return proposals.isError ? <QueryError query={proposals} label="Vorschläge" /> : <p className="muted">Lädt…</p>
  if (!me) return <p className="muted">Lädt…</p>
  const list = data.proposals.filter((p) => !id || p.id === Number(id))
  return (
    <>
      <QueryError query={proposals} label="Vorschläge" />
      {id && <Link className="link-btn" to="/vorschlaege">← Alle Vorschläge</Link>}
      {list.length === 0 && (
        <div className="empty"><h2>Noch nichts vorgeschlagen</h2><p>Im Programm bei einer Vorstellung auf „Vorschlagen“ tippen.</p></div>
      )}
      {list.map((p) => <Proposal key={p.id} p={p} members={data.members} me={me} />)}
    </>
  )
}
