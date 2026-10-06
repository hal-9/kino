import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

// Ein 401 irgendwo prüft /me erneut; nur ein echtes /me-401 führt im Guard zum Login.
// Netz-/Serverfehler melden niemanden ab. Kein Retry bei 4xx (außer 429: der Nutzer entscheidet).
export function createQueryClient(defaults = {}) {
  let client
  const onError = (err, query) => {
    if (err?.status === 401 && query?.queryKey?.[0] !== 'me') client.invalidateQueries({ queryKey: ['me'] })
  }
  client = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError: (err) => onError(err) }),
    defaultOptions: {
      // K23: networkMode 'always' – offline nichts pausieren und nichts später still nachsenden; Fehler sofort sichtbar.
      queries: { networkMode: 'always', retry: (n, err) => n < 1 && !(err?.status >= 400 && err?.status < 500), staleTime: 5_000, ...defaults },
      mutations: { networkMode: 'always' },
    },
  })
  return client
}
