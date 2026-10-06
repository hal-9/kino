import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api.js'
import { MutationError, QueryError } from './QueryStatus.jsx'

// Privater Kalender-Link (Haushalts-Feed). Neuer Link wird nur direkt nach dem Erzeugen angezeigt.
export default function CalendarLink() {
  const qc = useQueryClient()
  const status = useQuery({ queryKey: ['cal'], queryFn: () => api.get('/cal/token') })
  const [fresh, setFresh] = useState(null)
  const [tickets, setTickets] = useState(false)
  const [copied, setCopied] = useState(null)
  const done = () => qc.invalidateQueries({ queryKey: ['cal'] })
  const create = useMutation({ mutationFn: () => api.post('/cal/token', { include_tickets: tickets }), onSuccess: (r) => { setFresh(r); setCopied(null); done() } })
  const revoke = useMutation({ mutationFn: () => api.delete('/cal/token'), onSuccess: () => { setFresh(null); done() } })
  const scope = useMutation({ mutationFn: (v) => api.patch('/cal/token', { include_tickets: v }), onSuccess: done })

  const s = status.data
  const link = fresh ?? (s?.legacy ? s : null)
  const includeTickets = s?.exists ? s.include_tickets : tickets

  function rotate() {
    if (s?.exists && !confirm('Neuen Link erzeugen? Der alte Link funktioniert sofort nicht mehr; abonnierte Kalender brauchen den neuen Link. Schon geladene Termine bleiben dort gespeichert.')) return
    create.mutate()
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link.https_url); setCopied('Link kopiert.') } catch { setCopied('Kopieren nicht möglich. Link bitte manuell markieren.') }
  }

  return (
    <div>
      <p className="sub">Wer diesen Link hat, sieht alle gebuchten Kinobesuche der Gruppe. Nur in den eigenen Kalender eintragen, nicht weitergeben.</p>
      <QueryError query={status} label="Kalender-Link" />
      {link && (
        <>
          {fresh && <p className="stale" role="status">Neuer Link: wird nur jetzt angezeigt. In alten Abos durch diesen ersetzen.</p>}
          {!fresh && <p className="stale">Älterer Link ohne Schutz in der Datenbank{s.include_tickets ? ', enthält Ticket-Links' : ''}. Empfehlung: neuen Link erzeugen.</p>}
          <input className="field" readOnly aria-label="Kalender-Link" value={link.https_url} onFocus={(e) => e.target.select()} />
          <div className="sheet-actions">
            <a className="btn primary" href={link.webcal_url}>Abonnieren</a>
            <button className="btn" onClick={copy}>Link kopieren</button>
          </div>
          {copied && <p className="sub" role="status">{copied}</p>}
        </>
      )}
      {s?.exists && !link && <p className="sub">Ein Link ist aktiv. Aus Sicherheitsgründen wird er nur beim Erzeugen angezeigt.</p>}
      {s && (
        <label className="check-row">
          <input type="checkbox" checked={includeTickets} disabled={scope.isPending}
            onChange={(e) => (s.exists ? scope.mutate(e.target.checked) : setTickets(e.target.checked))} />
          Ticket-Links mitsenden (jeder mit dem Kalender-Link kann damit eure Tickets öffnen)
        </label>
      )}
      <MutationError mutation={create} />
      <MutationError mutation={revoke} />
      <MutationError mutation={scope} />
      {s && (
        <div className="sheet-actions">
          <button className="btn" disabled={create.isPending} onClick={rotate}>{s.exists ? 'Neuen Link erzeugen' : 'Kalender-Link erstellen'}</button>
          {s.exists && <button className="btn danger" disabled={revoke.isPending} onClick={() => confirm('Link widerrufen? Abonnierte Kalender bekommen keine Updates mehr.') && revoke.mutate()}>Link widerrufen</button>}
        </div>
      )}
    </div>
  )
}
