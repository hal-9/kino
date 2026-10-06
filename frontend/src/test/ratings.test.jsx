// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Besuche from '../screens/Besuche.jsx'
import Einstellungen from '../screens/Einstellungen.jsx'
import { renderScreen, waitFor } from './render.jsx'

const me = { id: 1, name: 'tuncay', household: { name: 'Crew' } }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('K20 Bewertungen', () => {
  it('Besuch zeigt eigene Bewertung vor Letterboxd-Wert und kennzeichnet sie', async () => {
    const v = { id: 1, user_id: 1, user_name: 'tuncay', proposal_id: null, movie_id: 1, tmdb_id: null, snapshot: { title: 'Digger', cinema_name: 'Delphi' }, watched_on: '2026-10-04', companions: [], letterboxd_rating: 3, manual_rating: 4.5, rating: 4.5, attendance: 'manual' }
    vi.stubGlobal('fetch', async (url) => {
      const u = String(url)
      if (u.endsWith('/me')) return json(me)
      if (u.endsWith('/visits/pending')) return json({ pending: [] })
      return json({ members: [me], visits: [v] })
    })
    const { el } = await renderScreen(<Besuche />, { path: '/besuche', route: '/besuche' })
    await waitFor(() => el.textContent.includes('Digger'))
    expect(el.querySelector('.stars').textContent).toBe('★★★★½ eigene Bewertung')
  })

  it('Einstellungen: Status mit Zeitraum/Unklarheiten, Abgleich-Knopf, 429 verständlich', async () => {
    const posts = []
    vi.stubGlobal('fetch', async (url, opts = {}) => {
      const u = String(url)
      if (opts.method === 'POST') { posts.push(u); return json({ error: 'too many requests' }, 429) }
      if (u.endsWith('/me')) return json(me)
      if (u.endsWith('/settings')) return json({ letterboxd_user: 'tuncay', letterboxd: { attempt_at: '2026-10-06T10:00:00Z', error: null, from: '2026-09-01', to: '2026-10-04', ambiguous: 1, other_account: 0 } })
      return json({ sources: [] })
    })
    const { el } = await renderScreen(<Einstellungen />)
    await waitFor(() => el.textContent.includes('Feed deckt'))
    expect(el.textContent).toContain('1 Besuch(e) nicht eindeutig')
    const btn = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Jetzt abgleichen')
    await act(async () => btn.click())
    await waitFor(() => el.textContent.includes('in einer Minute'))
    expect(posts).toEqual(['/api/letterboxd/resync'])
  })
})
