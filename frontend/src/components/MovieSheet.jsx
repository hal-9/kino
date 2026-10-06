import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api.js'
import { MutationError, QueryError } from './QueryStatus.jsx'
import Sheet from './Sheet.jsx'

const fmtWhen = (iso) => new Date(iso).toLocaleString('de-DE', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
const STATUS = {
  not_found: 'Kein passender Film bei TMDB gefunden.',
  ambiguous: 'Mehrere mögliche Filme bei TMDB – nicht automatisch zugeordnet.',
  failed: 'TMDB war nicht erreichbar.',
}

// Zuordnungsstatus ehrlich anzeigen; erneut suchen oder von Hand korrigieren (TMDB-Link oder -ID).
function Metadata({ m }) {
  const qc = useQueryClient()
  const [input, setInput] = useState('')
  const put = (data) => qc.setQueryData(['movie', m.id], data)
  const retry = useMutation({ mutationFn: () => api.post(`/movies/${m.id}/tmdb/retry`), onSuccess: put })
  const fix = useMutation({
    mutationFn: () => api.put(`/movies/${m.id}/tmdb`, { tmdb_id: Number(input.match(/(?:movie\/)?(\d+)/)?.[1]) || -1 }),
    onSuccess: (d) => { put(d); setInput('') },
  })
  const { status, next_retry_at: next } = m.metadata ?? {}
  return (
    <>
      {STATUS[status] && (
        <p className="sub" role="status">
          {STATUS[status]}{next && ` Nächster automatischer Versuch ab ${fmtWhen(next)}.`}{' '}
          <button className="link-btn" disabled={retry.isPending} onClick={() => retry.mutate()}>Jetzt erneut suchen</button>
        </p>
      )}
      <MutationError mutation={retry} text={(e) => (e.status === 429 ? 'Gerade erst gesucht. Bitte in einer Minute erneut.' : undefined)} />
      <details className="fix">
        <summary>{status === 'manual' ? 'Von Hand zugeordnet. Ändern?' : 'Falscher Film?'}</summary>
        <input className="field" aria-label="TMDB-Link oder -ID" placeholder="TMDB-Link oder -ID" value={input} onChange={(e) => setInput(e.target.value)} />
        <MutationError mutation={fix} text={(e) => (e.code === 'tmdb_id in use' ? 'Diese TMDB-ID gehört schon zu einem anderen Film.' : e.status === 422 ? 'Bitte einen TMDB-Film-Link oder eine Zahl eingeben.' : undefined)} />
        <button className="btn" disabled={fix.isPending || !input.trim()} onClick={() => fix.mutate()}>Zuordnung speichern</button>
      </details>
    </>
  )
}

// K27: Merken = eigenes Interesse, keine Stimme und keine Buchung.
function WatchButton({ m }) {
  const qc = useQueryClient()
  const toggle = useMutation({
    mutationFn: () => (m.watchlisted ? api.delete(`/watchlist/${m.id}`) : api.put(`/watchlist/${m.id}`, {})),
    onSuccess: () => {
      qc.setQueryData(['movie', m.id], (old) => old && { ...old, watchlisted: !m.watchlisted })
      qc.invalidateQueries({ queryKey: ['watchlist'] })
    },
  })
  return (
    <>
      <button className="btn" aria-pressed={m.watchlisted} disabled={toggle.isPending} onClick={() => toggle.mutate()}>{m.watchlisted ? '✓ Gemerkt' : 'Merken'}</button>
      <MutationError mutation={toggle} />
    </>
  )
}

const fmtDate = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }) : null)

// Film-Details (TMDB, serverseitig gecacht). movieId = null → geschlossen.
export default function MovieSheet({ movieId, onClose }) {
  const query = useQuery({
    queryKey: ['movie', movieId], queryFn: () => api.get(`/movies/${movieId}`), enabled: movieId != null, staleTime: 3_600_000,
  })
  const { data: m, isLoading } = query
  const facts = m && [
    ['Kinostart', fmtDate(m.release_date)],
    ['Regie', m.director],
    ['Besetzung', m.cast?.length ? m.cast.join(', ') : null],
    ['Laufzeit', m.runtime && `${m.runtime} min`],
    ['Originaltitel', m.title_original && m.title_original !== m.title ? m.title_original : null],
  ].filter(([, v]) => v)
  return (
    <Sheet open={movieId != null} onClose={onClose} label={m ? `Film-Details: ${m.title}` : 'Film-Details'}>
      {isLoading && <p className="muted">Lädt…</p>}
      <QueryError query={query} label="Film-Details" />
      {m && (
        <>
          <div className="movie-head">
            {m.poster_url && <img className="movie-poster" src={m.poster_url} alt="" />}
            <div>
              <h3>{m.title}</h3>
              {m.year && <p className="sub">{m.year}</p>}
            </div>
          </div>
          {m.overview ? <p className="movie-overview">{m.overview}</p> : <p className="movie-overview muted">Keine Inhaltsangabe verfügbar.</p>}
          <Metadata m={m} />
          <dl className="facts">
            {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
          <div className="sheet-actions">
            <WatchButton m={m} />
            <a className="btn primary" href={m.letterboxd_url} target="_blank" rel="noreferrer">Auf Letterboxd ansehen</a>
          </div>
        </>
      )}
    </Sheet>
  )
}
