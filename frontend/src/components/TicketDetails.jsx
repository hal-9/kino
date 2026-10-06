import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { checkTicket, parseTicketText } from 'shared'
import { api, errorText, newKey } from '../api.js'
import Sheet from './Sheet.jsx'
import { MutationError } from './QueryStatus.jsx'

export const seatsText = (seats) => seats.map((s) => `${s.row ? `Reihe ${s.row} ` : ''}Sitz ${s.seat}`).join(', ')
const LABEL = { date: 'Datum', time: 'Uhrzeit', cinema: 'Kino', film: 'Film' }
const MARK = { match: '✓', conflict: '✗ passt nicht', unknown: '? nicht erkannt' }

const failText = (e) =>
  e.code === 'ticket mismatch' ? 'Datum/Uhrzeit passen nicht zur Buchung. Werte korrigieren oder erst umbuchen.'
    : e.status === 409 ? 'Inzwischen geändert. Bitte schließen, neu laden und erneut prüfen.' : errorText(e)

// K31: Bestätigungstext einfügen → lokal auslesen → prüfen → strukturierte Werte speichern.
// Der Text verlässt das Gerät nicht; Links werden nie abgerufen.
export default function TicketDetails({ p, snapshot, open, onClose, onSaved }) {
  const [text, setText] = useState('')
  const [f, setF] = useState({ date: '', time: '', auditorium: '', seats: '', link: '' })
  const [checked, setChecked] = useState(false)
  const key = useRef(null)
  useEffect(() => {
    if (!open) return
    key.current = newKey()
    setText('')
    setChecked(false)
    setF({ date: '', time: '', auditorium: p.ticket?.auditorium ?? '', seats: seatsText(p.ticket?.seats ?? []), link: '' })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  function paste(value) {
    setText(value)
    const r = parseTicketText(value)
    setF((x) => ({
      date: r.date?.value ?? x.date, time: r.time?.value ?? x.time, auditorium: r.auditorium?.value ?? x.auditorium,
      seats: r.seats.length ? seatsText(r.seats) : x.seats, link: r.links[0]?.value ?? x.link,
    }))
  }
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const seats = parseTicketText(f.seats).seats.map(({ row, seat }) => ({ row, seat }))
  const check = checkTicket({ date: f.date || null, time: f.time || null }, snapshot, text)
  const conflict = check.date === 'conflict' || check.time === 'conflict'
  const uncertain = Object.values(check).includes('unknown')

  const save = useMutation({
    mutationFn: () => api.put(`/proposals/${p.id}/seats`, {
      date: f.date || null, time: f.time || null, auditorium: f.auditorium.trim() || null, seats,
      ticket_link: f.link.trim() || undefined, revision: p.revision,
    }, { idempotencyKey: key.current }),
    onSuccess: () => { setText(''); onSaved(); onClose() },
  })

  return (
    <Sheet open={open} onClose={onClose} label="Ticketdaten" dirty={text !== '' || save.isError}>
      <h3>Ticketdaten</h3>
      <p className="sub">Bestätigungstext einfügen. Er wird nur hier ausgelesen und nicht gespeichert oder gesendet.</p>
      <textarea className="field" aria-label="Bestätigungstext" placeholder="Text aus der Bestätigungs-Mail einfügen" value={text} onChange={(e) => paste(e.target.value)} />
      <div className="two">
        <input className="field" type="date" aria-label="Datum laut Ticket" value={f.date} onChange={set('date')} />
        <input className="field" type="time" aria-label="Uhrzeit laut Ticket" value={f.time} onChange={set('time')} />
      </div>
      <input className="field" aria-label="Saal" placeholder="Saal" value={f.auditorium} onChange={set('auditorium')} maxLength={60} />
      <input className="field" aria-label="Plätze" placeholder="z. B. Reihe 9 Sitz 11, Reihe 9 Sitz 12" value={f.seats} onChange={set('seats')} />
      <input className="field" type="url" aria-label="Ticket-Link (optional)" placeholder="Ticket-Link (optional)" value={f.link} onChange={set('link')} />
      <ul className="sub" aria-label="Abgleich mit der Buchung">
        {Object.entries(check).map(([k, v]) => <li key={k}>{LABEL[k]}: {MARK[v]}</li>)}
      </ul>
      <p className="sub">{seats.length} {seats.length === 1 ? 'Platz' : 'Plätze'}. Wer wo sitzt, wird nicht festgelegt.</p>
      {conflict && <p className="stale" role="alert">Das Ticket passt nicht zu dieser Buchung. Werte korrigieren oder erst umbuchen.</p>}
      {!conflict && uncertain && (
        <label className="sub"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> Ich habe geprüft: das Ticket gehört zu dieser Vorstellung.</label>
      )}
      <MutationError mutation={save} text={failText} />
      <div className="sheet-actions">
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn primary" disabled={save.isPending || conflict || (uncertain && !checked) || (!seats.length && !f.auditorium.trim())} onClick={() => save.mutate()}>Speichern</button>
      </div>
    </Sheet>
  )
}
