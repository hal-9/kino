// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Besuche from '../screens/Besuche.jsx'
import { renderScreen, waitFor } from './render.jsx'

const me = { id: 1, name: 'tuncay' }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
const visit = (id, user_id, attendance) => ({ id, user_id, user_name: user_id === 1 ? 'tuncay' : 'kim', proposal_id: 5, movie_id: 1, tmdb_id: null, snapshot: { title: `Film ${id}`, cinema_name: 'Delphi LUX' }, watched_on: '2026-10-04', auditorium: null, row: null, seats: null, companions: [], letterboxd_rating: null, note: null, attendance })

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('K18 Besuche bestätigen', () => {
  it('Herkunft sichtbar; nur eigene abgeleitete Besuche haben Bestätigen/Nicht dabei; Aktionen gehen an den Server', async () => {
    const posts = []
    vi.stubGlobal('confirm', () => true)
    vi.stubGlobal('fetch', async (url, opts = {}) => {
      const u = String(url)
      if (u.endsWith('/me')) return json(me)
      if (opts.method === 'POST') { posts.push(u); return u.endsWith('/skip') ? new Response(null, { status: 204 }) : json({}) }
      if (u.endsWith('/visits/pending')) return json({ pending: [] })
      return json({ members: [me, { id: 2, name: 'kim' }], visits: [visit(1, 1, 'inferred'), visit(2, 1, 'legacy'), visit(3, 2, 'inferred'), visit(4, 1, 'manual')] })
    })
    const { el } = await renderScreen(<Besuche />, { path: '/besuche', route: '/besuche' })
    await waitFor(() => el.textContent.includes('Film 1'))
    const card = (n) => [...el.querySelectorAll('section.group')].find((g) => g.textContent.includes(`Film ${n}`))
    const btn = (n, text) => [...card(n).querySelectorAll('button')].find((b) => b.textContent === text)
    expect(card(1).textContent).toContain('Aus Buchung abgeleitet')
    expect(card(2).textContent).toContain('Früher automatisch aus ✓-Stimme übernommen')
    expect(btn(3, 'Ich war dabei')).toBeUndefined() // kim's Besuch
    expect(btn(4, 'Ich war dabei')).toBeUndefined() // selbst eingetragen
    await act(async () => btn(1, 'Ich war dabei').click())
    await act(async () => btn(2, 'Nicht dabei').click())
    await waitFor(() => posts.length === 2)
    expect(posts).toEqual(['/api/visits/1/confirm', '/api/visits/2/skip'])
  })
})
