// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import Wrapped from '../screens/Wrapped.jsx'
import { renderScreen, waitFor } from './render.jsx'

const stats = {
  year: 2026, scope: 'me', count: 5, outings: 5, films: 4, person_visits: 5, person_hours: 7.5, minutes: 450, unknown_runtime: 1, unconfirmed: 2, ungrouped: 3,
  ov_share: null, top_cinema: null, top_auditorium: null, top_row: null, top_companion: null, top_month: null, first: null, last: null,
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('K21 Wrapped-Kennzahlen', () => {
  it('zeigt Filme, Filmstunden ohne Werbung, unbekannte Laufzeiten und Unbestätigte', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(stats)))
    const { el } = await renderScreen(<Wrapped />)
    await waitFor(() => el.querySelector('.tile'))
    const tiles = Object.fromEntries([...el.querySelectorAll('.tile')].map((t) => [t.children[0].textContent, t.textContent]))
    expect(tiles.Besuche).toContain('davon 2 unbestätigt')
    expect(tiles.Filme).toContain('4')
    expect(tiles.Filmstunden).toContain('7,5')
    expect(tiles.Filmstunden).toContain('1 ohne bekannte Laufzeit')
    expect(tiles.Kinoabende).toBeUndefined() // nur in der Gruppenansicht
  })
})
