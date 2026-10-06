import { useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, errorText } from '../api.js'
import { MutationError } from './QueryStatus.jsx'
import { seatsText } from './TicketDetails.jsx'

const UPLOAD_ERROR = {
  'type mismatch': 'Dateityp passt nicht zum Inhalt.', 'unsupported type': 'Nur PDF, PNG oder JPEG.', 'too many pages': 'Zu viele Seiten.',
  'too many pixels': 'Bild ist zu groß.', truncated: 'Datei ist unvollständig.', 'too many files': 'Höchstens 10 Dateien je Buchung.',
}
const KIND = { 'application/pdf': 'PDF', 'image/png': 'Bild', 'image/jpeg': 'Bild' }

// K32: private Ticket-Datei zur Buchung. Wird nur auf dem eigenen Server gespeichert und lokal ausgelesen;
// Erkanntes wird nie automatisch übernommen, sondern über die Ticketdaten-Prüfung (K31) bestätigt.
export default function TicketFiles({ p, me, onReview }) {
  const qc = useQueryClient()
  const input = useRef(null)
  const key = ['ticketFiles', p.id]
  const list = useQuery({ queryKey: key, queryFn: () => api.get(`/proposals/${p.id}/ticket-files`) })
  const upload = useMutation({ mutationFn: (file) => api.upload(`/proposals/${p.id}/ticket-files`, file), onSuccess: () => qc.invalidateQueries({ queryKey: key }) })
  const del = useMutation({ mutationFn: (id) => api.delete(`/ticket-files/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: key }) })
  const ex = upload.data?.extraction
  const found = ex?.status === 'ok' && ex.fields
  return (
    <div className="sub step">
      <input ref={input} type="file" hidden accept="application/pdf,image/png,image/jpeg" aria-label="Ticket-Datei wählen"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload.mutate(f) }} />
      <button className="btn" disabled={upload.isPending} onClick={() => input.current?.click()}>{upload.isPending ? 'Lädt hoch…' : 'Ticket-Datei hochladen'}</button>
      <p className="sub">PDF, PNG oder JPEG bis 10 MB. Nur für euren Haushalt sichtbar, nicht im Kalender, ohne externe Auswertung.</p>
      <MutationError mutation={upload} text={(e) => UPLOAD_ERROR[e.code] ?? (e.status === 413 ? 'Datei ist zu groß (max. 10 MB).' : `Hochladen fehlgeschlagen. ${errorText(e)}`)} />
      {found && (
        <p role="status">Erkannt: {[found.date, found.time, found.auditorium && `Saal ${found.auditorium}`, found.seats.length && seatsText(found.seats)].filter(Boolean).join(' · ')}{' '}
          <button className="link-btn" onClick={() => onReview(found)}>Prüfen und übernehmen</button></p>
      )}
      {ex && !found && <p role="status">Nichts automatisch erkannt. Bitte die Ticketdaten von Hand eintragen.{' '}<button className="link-btn" onClick={() => onReview(null)}>Ticketdaten eintragen</button></p>}
      <ul aria-label="Ticket-Dateien">
        {(list.data?.files ?? []).map((f) => (
          <li key={f.id}>
            <a href={`/api/ticket-files/${f.id}`}>{KIND[f.mime]} vom {new Date(f.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('de-DE')}</a>
            {f.uploaded_by === me.id && <> <button className="link-btn" onClick={() => confirm('Datei löschen?') && del.mutate(f.id)}>Löschen</button></>}
          </li>
        ))}
      </ul>
      <MutationError mutation={del} />
    </div>
  )
}
