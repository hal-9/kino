// Einheitlicher Fehler: status 0 = keine Antwort (offline/Netz), sonst HTTP-Status; code = Server-Fehlertext.
async function request(path, { idempotencyKey, ...options } = {}) {
  const headers = {}
  if (options.body) headers['Content-Type'] = 'application/json'
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  let res
  try {
    res = await fetch(`/api${path}`, { credentials: 'include', headers, ...options })
  } catch {
    const error = new Error('offline')
    error.status = 0
    throw error
  }
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const error = new Error(data?.error || 'request failed')
    error.status = res.status
    error.code = data?.error ?? null
    throw error
  }
  return data
}

export const api = {
  get: (path) => request(path),
  post: (path, body, opts) => request(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined, ...opts }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' }),
  // K32: Datei als Body; Content-Type = Dateityp (Server prüft den Inhalt selbst).
  upload: (path, file) => request(path, { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } }),
}

// Sichere, nutzerverständliche Meldung je Status; keine Server-Interna.
export function errorText(err) {
  switch (err?.status) {
    case 0: return 'Keine Verbindung zum Server. Bitte später erneut versuchen.'
    case 401: return 'Sitzung abgelaufen. Bitte neu anmelden.'
    case 403: return 'Dafür fehlt die Berechtigung.'
    case 404: return 'Nicht (mehr) vorhanden.'
    case 409: return 'Inzwischen geändert. Bitte neu laden und prüfen.'
    case 422: return 'Eingabe ungültig. Bitte prüfen.'
    case 429: return 'Zu viele Anfragen. Bitte kurz warten.'
    default: return 'Serverfehler. Bitte erneut versuchen.'
  }
}

export const newKey = () => crypto.randomUUID()
