// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Vorschlaege from '../screens/Vorschlaege.jsx'
import { renderScreen, waitFor } from './render.jsx'

const me = { id: 1, name: 'tuncay', household: { id: 1, name: 'Kino-Crew' } }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
const click = (root, text) => act(async () => [...root.querySelectorAll('button')].find((b) => b.textContent === text).click())
const snap = { starts_at: '2099-10-13T20:15:00+02:00', cinema_name: 'Delphi LUX', version: 'OmU', auditorium: null }
const proposal = (extra = {}) => ({ id: 3, status: 'open', revision: 4, movie: { id: 1, title: 'Digger' }, note: null, booked_option_id: null, options: [{ id: 9, snapshot: snap, votes: { 1: 'yes' } }], ...extra })
const members = [{ id: 1, name: 'tuncay' }]

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('K11 Lebenszyklus im UI', () => {
  it('Buchen sendet Revision + Idempotency-Key; 409 zeigt Konflikt statt Erfolg', async () => {
    const posts = []
    vi.stubGlobal('fetch', async (url, opts = {}) => {
      if (String(url).endsWith('/me')) return json(me)
      if (opts.method === 'POST') { posts.push({ url: String(url), body: JSON.parse(opts.body), key: opts.headers['Idempotency-Key'] }); return json({ error: 'revision conflict' }, 409) }
      return json({ members, proposals: [proposal()] })
    })
    const { el } = await renderScreen(<Vorschlaege />, { path: '/vorschlaege', route: '/vorschlaege' })
    await waitFor(() => el.textContent.includes('Digger'))
    await click(el, 'Gebucht')
    await click(document.body, 'Als gebucht speichern')
    await waitFor(() => document.body.textContent.includes('Inzwischen von jemand anderem geändert'))
    expect(posts[0]).toMatchObject({ url: '/api/proposals/3/book', body: { option_id: 9, revision: 4 } })
    expect(posts[0].key).toBeTruthy()
  })

  it('Absagen einer Buchung fragt nach und verspricht keine Erstattung; Abbruch sendet nichts', async () => {
    const posts = []
    const asked = []
    vi.stubGlobal('confirm', (t) => { asked.push(t); return false })
    vi.stubGlobal('fetch', async (url, opts = {}) => {
      if (String(url).endsWith('/me')) return json(me)
      if (opts.method === 'POST') posts.push(String(url))
      return json({ members, proposals: [proposal({ status: 'booked', booked_option_id: 9 })] })
    })
    const { el } = await renderScreen(<Vorschlaege />, { path: '/vorschlaege', route: '/vorschlaege' })
    await waitFor(() => el.textContent.includes('Absagen'))
    await click(el, 'Absagen')
    expect(asked[0]).toContain('nicht storniert oder erstattet')
    expect(posts).toEqual([])
  })

  it('Deep-Link lädt den Einzel-Endpunkt (unabhängig von der Liste) und zeigt den Verlauf', async () => {
    const urls = []
    vi.stubGlobal('fetch', async (url) => {
      urls.push(String(url))
      if (String(url).endsWith('/me')) return json(me)
      if (String(url) === '/api/proposals/3') return json({ members, proposal: proposal({ status: 'cancelled' }), history: [{ action: 'cancel', revision: 2, created_at: '2026-10-06 10:00:00', user_name: 'kim', detail: {} }] })
      return json({ error: 'not found' }, 404)
    })
    const { el } = await renderScreen(<Vorschlaege />, { path: '/vorschlaege/3', route: '/vorschlaege/:id' })
    await waitFor(() => el.textContent.includes('Digger'))
    expect(el.textContent).toContain('abgesagt')
    expect(el.textContent).toContain('kim: abgesagt')
    expect(el.textContent).toContain('Wieder öffnen')
    expect(urls).not.toContain('/api/proposals')
  })

  it('Deep-Link auf fremden/fehlenden Vorschlag: neutrale Meldung', async () => {
    vi.stubGlobal('fetch', async (url) => (String(url).endsWith('/me') ? json(me) : json({ error: 'not found' }, 404)))
    const { el } = await renderScreen(<Vorschlaege />, { path: '/vorschlaege/77', route: '/vorschlaege/:id' })
    await waitFor(() => el.textContent.includes('nicht gefunden'))
  })
})
