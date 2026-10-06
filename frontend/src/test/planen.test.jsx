// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Planen from '../screens/Planen.jsx'
import { renderScreen, waitFor } from './render.jsx'

const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
const match = {
  mode: 'all', days: 14, participants: [1, 2], movies: 1, considered: 3, excluded: { version: 1 }, generated_at: '2099-10-08T10:00:00.000Z',
  results: [{
    screening: { id: 11, movie_id: 7, title: 'Digger', runtime: null, starts_at: '2099-10-09T20:00:00+02:00', version: 'OV', auditorium: 'Saal 1', cinema_name: 'Zoo Palast', attrs: [] },
    status: 'tentative', score: 20, known_fit: 1, parts: [{ code: 'interest', people: 1, points: 20 }],
    people: [{ user_id: 1, fit: 'unknown', reasons: ['runtime_unknown'] }, { user_id: 2, fit: 'unknown' }],
  }],
}
const planning = {
  prefs: { version: null, cinemas: null, earliest: null, latest_end: null, buffer_minutes: 0 }, visibility: 'fit_only',
  availability: [{ id: 3, starts_at: '2099-10-10T17:00:00.000Z', ends_at: '2099-10-10T21:30:00.000Z', kind: 'free' }], members: [{ id: 2, name: 'kim' }],
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

function stub(extra = {}) {
  const calls = []
  vi.stubGlobal('fetch', async (url, opts = {}) => {
    const u = String(url).replace(/^\/api/, '')
    calls.push({ u, method: opts.method ?? 'GET', body: opts.body && JSON.parse(opts.body) })
    for (const [k, v] of Object.entries(extra)) if (u.startsWith(k)) return json(v)
    if (u === '/watchlist') return json({ items: [{ movie_id: 7, title: 'Digger', year: 2026, upcoming: 3, expired: false, expires_on: null }, { movie_id: 8, title: 'Später', year: null, upcoming: 0, expired: false, expires_on: null }] })
    if (u === '/planning') return json(planning)
    if (u === '/cinemas') return json({ cinemas: [{ key: 'zoo-palast', name: 'Zoo Palast', is_favorite: true }] })
    if (u === '/planning/prefs') return json({})
    if (u === '/me') return json({ id: 1, name: 'tuncay' })
    return json({ error: 'not found' }, 404)
  })
  return calls
}

describe('K27 Planen', () => {
  it('Merkliste zeigt echte Vorstellungszahl, Film ohne Termine ehrlich; Vorlieben mit muss/lieber speichern', async () => {
    const calls = stub()
    const { el } = await renderScreen(<Planen />)
    await waitFor(() => el.textContent.includes('3 aktuelle Vorstellungen vergleichen') && el.querySelector('[aria-label="Fassung"]'))
    expect(el.textContent).toContain('Zurzeit keine Vorstellungen')
    expect(el.querySelector('a[href="/?q=Digger"]')).not.toBeNull()
    expect(el.querySelector('[aria-label="Eingetragene Zeiten"]').textContent).toMatch(/Kann: .*19:00/)
    const sel = el.querySelector('[aria-label="Fassung"]')
    await act(async () => {
      sel.value = 'ov'
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const strength = el.querySelector('[aria-label="Fassung: muss oder lieber"]')
    await act(async () => {
      strength.value = 'hard'
      strength.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Speichern').click())
    await waitFor(() => calls.some((c) => c.u === '/planning/prefs'))
    const put = calls.find((c) => c.u === '/planning/prefs')
    expect(put.method).toBe('PUT')
    expect(put.body).toEqual({
      prefs: { version: { value: 'ov', strength: 'hard' }, cinemas: null, earliest: null, latest_end: null, buffer_minutes: 0 },
      visibility: 'fit_only',
    })
  })
})

describe('K28 Nächster Kinoabend', () => {
  it('zeigt Begründung und Unsicherheit; Übergabe nur in die Auswahl, kein Senden', async () => {
    sessionStorage.clear()
    const calls = stub({ '/match': match })
    const { el } = await renderScreen(<Planen />)
    await waitFor(() => el.textContent.includes('kim'))
    await act(async () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Vorschläge finden').click())
    await waitFor(() => el.textContent.includes('Unsicher: nicht alles bekannt'))
    expect(calls.find((c) => c.u.startsWith('/match')).u).toBe('/match?mode=all&participants=1%2C2')
    const card = el.querySelector('[aria-label="Vorschlag Digger Zoo Palast"]').textContent
    expect(card).toContain('Laufzeit unbekannt')
    expect(card).toContain('1× gemerkt (+20)')
    expect(card).toContain('tuncay: unbekannt (Laufzeit unbekannt)')
    expect(card).toContain('kim: unbekannt')
    await act(async () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'In die Auswahl übernehmen').click())
    const draft = JSON.parse(sessionStorage.getItem('kino.proposalDraft'))
    expect(draft).toMatchObject({ movie: { id: 7, title: 'Digger' }, shows: [{ id: 11 }], note: '' })
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([])
  })
})
