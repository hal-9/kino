import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, errorText, newKey } from '../api.js'
import { MutationError, QueryError } from '../components/QueryStatus.jsx'
import Sheet from '../components/Sheet.jsx'
import MovieSheet from '../components/MovieSheet.jsx'
import MovieHeader from '../components/MovieHeader.jsx'
import CalendarLink from '../components/CalendarLink.jsx'
import { initial } from '../components/Header.jsx'

const MARK = { yes: '✓', maybe: '?', no: '✗' }
const SAY = { yes: 'Ja', maybe: 'Vielleicht', no: 'Nein' }
const when = (iso) => new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'Europe/Berlin' }) + ' · ' + iso.slice(11, 16)

function score(o) {
  const v = Object.values(o.votes)
  return v.filter((x) => x === 'yes').length * 10 - v.filter((x) => x === 'no').length
}

const ACTION = { created: 'vorgeschlagen', book: 'gebucht', reschedule: 'umgebucht', cancel: 'abgesagt', reopen: 'wieder geöffnet', ticket: 'Ticket-Link geändert' }
const stamp = (sql) => new Date(sql.replace(' ', 'T') + 'Z').toLocaleString('de-DE', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
// 409 bei Lebenszyklus-Aktionen: jemand anderes war schneller oder der Status passt nicht mehr.
const conflictText = (e) =>
  e.code === 'expired' ? 'Diese Vorstellung hat schon begonnen.'
    : e.code === 'review required' ? 'Die Kino-Daten haben sich geändert. Bitte die Änderungen prüfen und bestätigen.'
    : e.code === 'changed' ? 'Diese Vorstellung wurde verschoben oder abgesetzt und ist so nicht buchbar.'
    : e.status === 409 ? 'Inzwischen von jemand anderem geändert. Bitte prüfen und erneut wählen.' : errorText(e)

// K12: Abweichung der Live-Daten vom Stand des Vorschlags (Snapshot bleibt unverändert).
function changeText(c) {
  const by = c.source ? ` (laut ${c.source})` : ''
  switch (c.field) {
    case 'starts_at': return `Neue Zeit: ${when(c.after)}, vorher ${when(c.before)}${by}`
    case 'cinema': return `Anderes Kino${by}`
    case 'version': return `Fassung jetzt ${c.after}, vorher ${c.before}${by}`
    case 'auditorium': return `Saal jetzt ${c.after}, vorher ${c.before}${by}`
    default: return c.after === 'withdrawn' ? 'Nicht mehr im Programm' : 'Zuletzt nicht im Programm gesehen (unsicher, keine Absage)'
  }
}

function Proposal({ p, members, me, history }) {
  const qc = useQueryClient()
  const [pick, setPick] = useState(null)
  const [abo, setAbo] = useState(false)
  const [link, setLink] = useState('')
  const [info, setInfo] = useState(false)
  const [ticketSheet, setTicketSheet] = useState(false)
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['proposals'] }), qc.invalidateQueries({ queryKey: ['proposal'] })])
  // Ein Idempotency-Key je geöffneter Aktion; Wiederholung nach Netzabbruch liefert das Original.
  const key = useRef(null)
  const fresh = () => (key.current = newKey())
  const lifecycle = (action, body = {}) => api.post(`/proposals/${p.id}/${action}`, { ...body, revision: p.revision }, { idempotencyKey: key.current ?? fresh() })
  const settled = { onSuccess: () => { key.current = null; refresh() }, onError: (e) => { if (e.status === 409) { key.current = null; refresh() } } }
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
  const book = useMutation({
    mutationFn: (option_id) => lifecycle(p.status === 'booked' ? 'reschedule' : 'book', { option_id, ticket_link: link.trim() || undefined }),
    onSuccess: () => { setPick(null); setLink(''); settled.onSuccess() },
    onError: settled.onError,
  })
  const saveTicket = useMutation({ mutationFn: () => api.put(`/proposals/${p.id}/ticket`, { ticket_link: link.trim() || null }), onSuccess: () => { setTicketSheet(false); refresh() } })
  const cancel = useMutation({ mutationFn: () => lifecycle('cancel'), ...settled })
  const reopen = useMutation({ mutationFn: () => lifecycle('reopen'), ...settled })
  const review = useMutation({ mutationFn: () => lifecycle('changes/ack'), ...settled })
  const unreviewed = p.status !== 'cancelled' && p.options.some((o) => o.changes?.some((c) => !c.acknowledged))
  function confirmCancel() {
    const text = p.status === 'booked'
      ? 'Buchung in Kino absagen? Gekaufte Tickets werden dadurch nicht storniert oder erstattet, das geht nur beim Kino.'
      : 'Vorschlag verwerfen? Er bleibt im Archiv und kann wieder geöffnet werden.'
    if (confirm(text)) { fresh(); cancel.mutate() }
  }
  function confirmReopen() {
    if (confirm('Wieder öffnen? Die Buchung wird aufgehoben, Stimmen bleiben erhalten.')) { fresh(); reopen.mutate() }
  }
  const openPick = () => { fresh(); book.reset(); setPick(p.booked_option_id ?? best?.id ?? p.options[0].id) }

  const best = p.status === 'open' ? [...p.options].sort((a, b) => score(b) - score(a))[0] : null
  const booked = p.options.find((o) => o.id === p.booked_option_id)
  const past = booked && new Date(booked.snapshot.starts_at) < new Date()

  return (
    <section className="group">
      <MovieHeader movie={p.movie} onInfo={() => setInfo(true)} />
      <p className="status-line">{p.status === 'booked' ? '✓ gebucht' : p.status === 'cancelled' ? 'abgesagt' : 'offen'}</p>
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
              {o.changes?.length > 0 && (
                <ul className="changes" aria-label="Änderungen seit dem Vorschlag">
                  {o.changes.map((c) => <li key={c.id} className={c.acknowledged ? 'ack' : ''}>⚠ {changeText(c)}{c.acknowledged ? ' · geprüft' : ''}</li>)}
                </ul>
              )}
              <div className="opt-votes">
                {members.map((m) => (
                  <span key={m.id} className={`avatar v-${voteOf(m.id) ?? 'none'}`} role="img" aria-label={`${m.name}: ${SAY[voteOf(m.id)] ?? 'offen'}`} title={`${m.name}: ${SAY[voteOf(m.id)] ?? 'offen'}`}>
                    <span aria-hidden="true">{initial(m.name)}<i>{MARK[voteOf(m.id)] ?? ''}</i></span>
                  </span>
                ))}
                {p.status === 'open' && (
                  <span className="tri" role="group" aria-label={`Meine Stimme für ${when(s.starts_at)}`}>
                    {['yes', 'maybe', 'no'].map((v) => (
                      <button key={v} className={mine === v ? `on ${v}` : ''} aria-pressed={mine === v} aria-label={SAY[v]} onClick={() => castVote(o.id, v)}>{MARK[v]}</button>
                    ))}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {voteError && <p className="stale" role="alert">Stimme nicht gespeichert. {errorText(voteError)}</p>}
      <MutationError mutation={cancel} text={conflictText} />
      <MutationError mutation={reopen} text={conflictText} />
      <MutationError mutation={review} text={conflictText} />
      {unreviewed && (
        <p className="stale" role="status">
          Die Kino-Daten weichen vom Vorschlag ab.{p.status === 'booked' ? ' Die Buchung wird nicht automatisch geändert.' : ' Vor dem Buchen bitte prüfen.'}{' '}
          <button className="link-btn" disabled={review.isPending} onClick={() => { fresh(); review.mutate() }}>Änderungen geprüft</button>
        </p>
      )}
      <div className="sheet-actions">
        {p.status === 'open' && (
          <>
            <button className="btn" disabled={cancel.isPending} onClick={confirmCancel}>Verwerfen</button>
            <button className="btn primary" onClick={openPick}>Gebucht</button>
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
            {!past && <button className="btn" onClick={openPick}>Umbuchen</button>}
            {!past && <button className="btn" disabled={cancel.isPending} onClick={confirmCancel}>Absagen</button>}
            {!past && <button className="btn" disabled={reopen.isPending} onClick={confirmReopen}>Wieder öffnen</button>}
          </>
        )}
        {p.status === 'cancelled' && <button className="btn" disabled={reopen.isPending} onClick={confirmReopen}>Wieder öffnen</button>}
      </div>

      <MovieSheet movieId={info ? p.movie.id : null} onClose={() => setInfo(false)} />

      {history?.length > 0 && (
        <details className="history">
          <summary>Verlauf</summary>
          <ul>{history.map((e, i) => <li key={i}>{stamp(e.created_at)} · {e.user_name ?? '?'}: {ACTION[e.action] ?? e.action}</li>)}</ul>
        </details>
      )}

      <Sheet open={pick != null} onClose={() => setPick(null)} label="Welche Vorstellung ist gebucht?" dirty={link.trim() !== ''}>
        <h3>Welche Vorstellung ist gebucht?</h3>
        <div className="cat-grid" style={{ gridTemplateColumns: '1fr' }}>
          {p.options.map((o) => (
            <button key={o.id} className={pick === o.id ? 'active' : ''} aria-pressed={pick === o.id} onClick={() => setPick(o.id)}>
              {when(o.snapshot.starts_at)} · {o.snapshot.cinema_name}
            </button>
          ))}
        </div>
        <input className="field" type="url" aria-label="Ticket-Link (optional)" placeholder="Ticket-Link aus der Bestätigungs-Mail (optional)" value={link} onChange={(e) => setLink(e.target.value)} />
        <MutationError mutation={book} text={conflictText} />
        <div className="sheet-actions">
          <button className="btn" onClick={() => setPick(null)}>Abbrechen</button>
          <button className="btn primary" onClick={() => book.mutate(pick)} disabled={book.isPending}>Als gebucht speichern</button>
        </div>
      </Sheet>

      <Sheet open={ticketSheet} onClose={() => setTicketSheet(false)} label="Ticket-Link" dirty={link.trim() !== (p.ticket_link ?? '')}>
        <h3>Ticket-Link</h3>
        <p className="sub">Link zu den gekauften Tickets (Wallet, PDF oder Bestätigungsseite). Er landet im Kalendereintrag.</p>
        <input className="field" type="url" aria-label="Ticket-Link" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} />
        <MutationError mutation={saveTicket} />
        <div className="sheet-actions">
          <button className="btn" onClick={() => setTicketSheet(false)}>Abbrechen</button>
          <button className="btn primary" disabled={saveTicket.isPending} onClick={() => saveTicket.mutate()}>Speichern</button>
        </div>
      </Sheet>

      <Sheet open={abo} onClose={() => setAbo(false)} label="Kalender abonnieren">
        <h3>Kalender abonnieren</h3>
        <p className="sub">Einmal abonnieren reicht: alle künftigen Buchungen erscheinen automatisch. Auf dem iPhone öffnet der Link den Abo-Dialog.</p>
        <CalendarLink />
      </Sheet>
    </section>
  )
}

// Detail (/vorschlaege/:id) kommt vom eigenen Endpunkt, unabhängig von Listen-/Archivfilter.
function Detail({ id, me }) {
  const detail = useQuery({ queryKey: ['proposal', id], queryFn: () => api.get(`/proposals/${id}`), refetchInterval: 10_000 })
  const { data } = detail
  return (
    <>
      <Link className="link-btn" to="/vorschlaege">← Alle Vorschläge</Link>
      {!data && (detail.error?.status === 404
        ? <div className="empty" role="alert"><h2>Vorschlag nicht gefunden</h2><p>Er existiert nicht oder gehört nicht zu eurer Gruppe.</p></div>
        : detail.isError ? <QueryError query={detail} label="Vorschlag" /> : <p className="muted">Lädt…</p>)}
      {data && <QueryError query={detail} label="Vorschlag" />}
      {data && <Proposal p={data.proposal} members={data.members} me={me} history={data.history} />}
    </>
  )
}

export default function Vorschlaege() {
  const { id } = useParams()
  const [archive, setArchive] = useState(false)
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get('/me') })
  const proposals = useQuery({ queryKey: ['proposals'], queryFn: () => api.get('/proposals'), refetchInterval: 10_000, enabled: !id })
  const old = useQuery({ queryKey: ['proposals', 'archive'], queryFn: () => api.get('/proposals?view=archive'), enabled: archive && !id })
  if (!me) return <p className="muted">Lädt…</p>
  if (id) return <Detail id={Number(id)} me={me} />
  const { data } = proposals
  if (!data) return proposals.isError ? <QueryError query={proposals} label="Vorschläge" /> : <p className="muted">Lädt…</p>
  return (
    <>
      <QueryError query={proposals} label="Vorschläge" />
      {data.proposals.length === 0 && (
        <div className="empty"><h2>Noch nichts vorgeschlagen</h2><p>Im Programm bei einer Vorstellung auf „Vorschlagen“ tippen.</p></div>
      )}
      {data.proposals.map((p) => <Proposal key={p.id} p={p} members={data.members} me={me} />)}
      <button className="link-btn" aria-expanded={archive} onClick={() => setArchive(!archive)}>{archive ? 'Archiv ausblenden' : 'Archiv anzeigen'}</button>
      {archive && (old.data
        ? old.data.proposals.length === 0
          ? <p className="muted">Archiv ist leer.</p>
          : old.data.proposals.map((p) => <Proposal key={p.id} p={p} members={old.data.members} me={me} />)
        : old.isError ? <QueryError query={old} label="Archiv" /> : <p className="muted">Lädt…</p>)}
    </>
  )
}
