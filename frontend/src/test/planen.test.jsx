// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Planen from '../screens/Planen.jsx'
import { renderScreen, waitFor } from './render.jsx'

const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
const planning = {
  prefs: { version: null, cinemas: null, earliest: null, latest_end: null, buffer_minutes: 0 }, visibility: 'fit_only',
  availability: [{ id: 3, starts_at: '2099-10-10T17:00:00.000Z', ends_at: '2099-10-10T21:30:00.000Z', kind: 'free' }], members: [],
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
