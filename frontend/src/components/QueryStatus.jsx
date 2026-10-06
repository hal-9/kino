import { Component } from 'react'
import { errorText } from '../api.js'

// Lesefehler: ohne Daten → Fehler + Erneut-versuchen; mit alten Daten → als veraltet markieren, Daten bleiben.
export function QueryError({ query, label }) {
  if (!query.isError) return null
  const msg = errorText(query.error)
  if (query.data !== undefined) {
    return (
      <p className="stale" role="status">
        ⚠ Aktualisieren fehlgeschlagen, Anzeige evtl. veraltet. {msg}{' '}
        <button className="link-btn" onClick={() => query.refetch()}>Erneut laden</button>
      </p>
    )
  }
  return (
    <div className="empty" role="alert">
      <h2>{label} konnten nicht geladen werden.</h2>
      <p>{msg}</p>
      <button className="btn" onClick={() => query.refetch()}>Erneut versuchen</button>
    </div>
  )
}

// Schreibfehler direkt an der Aktion.
export function MutationError({ mutation, text }) {
  if (!mutation.isError) return null
  return <p className="stale" role="alert">{text?.(mutation.error) ?? errorText(mutation.error)}</p>
}

// Letzte Rettung bei Renderfehlern; normale Abfragefehler behandeln die Screens selbst.
export class ErrorBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="center" role="alert">
        <p>Da ist etwas schiefgelaufen.</p>
        <button className="btn" onClick={() => location.reload()}>Neu laden</button>
      </main>
    )
  }
}
