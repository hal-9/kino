// Filmkopf über den Vorstellungen: groß, mit Poster-Vorschau und Pfeil, damit klar ist, dass er die Details öffnet.
export default function MovieHeader({ movie, onInfo }) {
  const meta = [movie.year, movie.runtime && `${movie.runtime} min`].filter(Boolean).join(' · ')
  return (
    <button className="movie-btn" onClick={() => onInfo(movie.id)} aria-label={`Details zu ${movie.title}`}>
      {movie.poster_url && <img className="movie-thumb" src={movie.poster_url} alt="" loading="lazy" />}
      <span className="movie-btn-text">
        <strong>{movie.title}</strong>
        {meta && <small>{meta}</small>}
      </span>
      <svg className="movie-btn-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
    </button>
  )
}
