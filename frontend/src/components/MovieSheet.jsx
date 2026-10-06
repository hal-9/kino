import { useQuery } from '@tanstack/react-query'
import { api } from '../api.js'
import { QueryError } from './QueryStatus.jsx'
import Sheet from './Sheet.jsx'

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
    <Sheet open={movieId != null} onClose={onClose}>
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
          <dl className="facts">
            {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
          <div className="sheet-actions">
            <a className="btn primary" href={m.letterboxd_url} target="_blank" rel="noreferrer">Auf Letterboxd ansehen</a>
          </div>
        </>
      )}
    </Sheet>
  )
}
