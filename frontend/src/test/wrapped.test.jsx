// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Wrapped from '../screens/Wrapped.jsx'
import { renderScreen, waitFor } from './render.jsx'

const stats = {
  year: 2026, scope: 'me', count: 5, outings: 5, films: 4, person_visits: 5, person_hours: 7.5, minutes: 450, unknown_runtime: 1, unconfirmed: 2, ungrouped: 3,
  ov_share: null, top_cinema: null, top_auditorium: null, top_row: null, top_companion: null, top_month: null, first: null, last: null,
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
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

describe('K22 Teilen: Fehler erholen sich', () => {
  const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}) })
  const clickShare = async (el) => {
    const btn = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Als Bild teilen')
    await act(async () => btn.click())
  }

  it('Export schlägt fehl (toBlob null / kein Canvas) → Meldung, Zahlen bleiben', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(stats)))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(null))
    const { el } = await renderScreen(<Wrapped />)
    await waitFor(() => el.querySelector('.tile'))
    await clickShare(el)
    await waitFor(() => el.querySelector('[role=alert]'))
    expect(el.querySelector('[role=alert]').textContent).toContain('Bild konnte nicht erstellt werden')
    expect(el.querySelectorAll('.tile').length).toBeGreaterThan(0)
  })

  it('Teilen abgebrochen → kein Fehler, kein Download; Teilen nicht möglich → Download', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(stats)))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob(['x'], { type: 'image/png' })))
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    URL.createObjectURL = () => 'blob:x'
    URL.revokeObjectURL = () => {}
    const abort = Object.assign(new Error('cancel'), { name: 'AbortError' })
    vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share: vi.fn(async () => { throw abort }) })
    const { el } = await renderScreen(<Wrapped />)
    await waitFor(() => el.querySelector('.tile'))
    await clickShare(el)
    await waitFor(() => navigator.share.mock.calls.length === 1)
    expect(download).not.toHaveBeenCalled()
    expect(el.querySelector('[role=alert]')).toBeNull()
    vi.stubGlobal('navigator', { ...navigator, canShare: () => false })
    await clickShare(el)
    await waitFor(() => download.mock.calls.length === 1)
  })
})

describe('K33 Story und geschwärzter Export', () => {
  const full = {
    ...stats, top_companion: { name: 'kim', count: 3 }, top_cinema: { name: 'Zoo Palast', count: 4 },
    story: {
      first_confirmed: { title: 'Eins', date: '2026-03-01' }, favorite_venue: { name: 'Zoo Palast', outings: 4, of: 5 },
      revisited_room: null, posters: ['https://image.tmdb.org/1.jpg'], agreement: { omitted: 'too_few_ratings', rated_films: 2, min: 3 },
    },
  }

  it('Karten mit Nenner, zu wenige Bewertungen ausdrücklich ausgelassen; Text = Vorschau, ohne Namen bis zur Wahl', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(full)))
    const writes = []
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async (t) => { writes.push(t) } } })
    const { el } = await renderScreen(<Wrapped />)
    await waitFor(() => el.querySelector('[aria-label="Story-Karten"]'))
    const story = el.querySelector('[aria-label="Story-Karten"]').textContent
    expect(story).toContain('Lieblingskino: Zoo Palast (4 von 5 Kinoabenden)')
    expect(story).toContain('ausgelassen, nur 2 gemeinsam bewertete Filme (mindestens 3)')
    expect(story).not.toContain('Am einigsten')
    const preview = el.querySelector('[aria-label="Vorschau Teilen"]').textContent
    expect(preview).not.toContain('Treueste Begleitung')
    const copy = () => act(async () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Als Text kopieren').click())
    await copy()
    expect(writes[0].split('\n')[0]).toBe('Mein Kinojahr 2026')
    expect(writes[0]).not.toContain('kim')
    expect(writes[0]).toContain('Erster bestätigter Kinoabend: Eins')
    // Jede Kachel der Vorschau steht im Text, und nur die.
    for (const name of preview.replace(/^Im Bild: /, '').split('.')[0].split(', ')) expect(writes[0]).toContain(`${name}: `)
    const box = [...el.querySelectorAll('label')].find((l) => l.textContent.includes('Namen der Begleitung')).querySelector('input')
    await act(async () => box.click())
    await copy()
    expect(writes[1]).toContain('Treueste Begleitung: kim')
  })

  it('ohne Zwischenablage → Text zum manuellen Kopieren', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(full)))
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async () => { throw new Error('denied') } } })
    const { el } = await renderScreen(<Wrapped />)
    await waitFor(() => el.querySelector('.tile'))
    await act(async () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Als Text kopieren').click())
    await waitFor(() => el.querySelector('[aria-label="Text zum Kopieren"]'))
    expect(el.querySelector('[aria-label="Text zum Kopieren"]').value).toContain('Filme: 4')
  })
})
