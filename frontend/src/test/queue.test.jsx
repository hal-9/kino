// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Vorschlaege from '../screens/Vorschlaege.jsx'
import { renderScreen, waitFor } from './render.jsx'

const me = { id: 1, name: 'tuncay' }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
const members = ['tuncay', 'kim', 'lia', 'max', 'ole'].map((name, i) => ({ id: i + 1, name }))
const snap = { starts_at: '2099-10-13T20:15:00+02:00', cinema_name: 'Delphi LUX', version: 'OmU', auditorium: null }
const proposal = (votes, extra = {}) => ({ id: 3, status: 'open', revision: 1, participants: [1, 2, 3, 4, 5], movie: { id: 1, title: 'Digger' }, note: null, booked_option_id: null, options: [{ id: 9, snapshot: snap, votes, changes: [] }], ...extra })

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('K15 Stand und Zu-tun', () => {
  it('AC01/AC02: 3 Ja, 1 Vielleicht, 1 offen; offen wird namentlich genannt, nicht als Ja gezählt', async () => {
    vi.stubGlobal('fetch', async (url) => (String(url).endsWith('/me') ? json(me) : json({ members, proposals: [proposal({ 1: 'yes', 2: 'yes', 3: 'yes', 4: 'maybe' })] })))
    const { el } = await renderScreen(<Vorschlaege />, { path: '/vorschlaege', route: '/vorschlaege' })
    await waitFor(() => el.textContent.includes('Digger'))
    expect(el.querySelector('.tally').textContent).toBe('3 Ja · 1 Vielleicht · 0 Nein · 1 offen')
    expect(el.textContent).toContain('Warten auf: ole.')
    expect(el.querySelector('[aria-label="ole: offen"]')).not.toBeNull()
    expect(el.querySelector('.queue')).toBeNull() // nichts für mich zu tun
  })

  it('AC04: Zu-tun aktualisiert sich erst nach bestätigter Stimme', async () => {
    let server = { 2: 'yes' }
    vi.stubGlobal('fetch', async (url, opts = {}) => {
      if (String(url).endsWith('/me')) return json(me)
      if (opts.method === 'PUT') { server = { ...server, 1: JSON.parse(opts.body).value }; return new Response(null, { status: 204 }) }
      return json({ members: members.slice(0, 2), proposals: [proposal(server, { participants: [1, 2] })] })
    })
    const { el } = await renderScreen(<Vorschlaege />, { path: '/vorschlaege', route: '/vorschlaege' })
    await waitFor(() => el.querySelector('.queue'))
    expect(el.querySelector('.queue').textContent).toContain('Deine Stimme fehlt: Digger')
    await act(async () => el.querySelector('[aria-label="Ja"]').click())
    await waitFor(() => el.querySelector('.queue')?.textContent.includes('Bereit zur Entscheidung'))
    expect(el.textContent).toContain('Buchen bleibt eure Entscheidung')
  })

  it('AC05: alle geantwortet, jede Option mit Nein → „Keine passt“, nicht bereit', async () => {
    vi.stubGlobal('fetch', async (url) => (String(url).endsWith('/me') ? json(me) : json({ members: members.slice(0, 2), proposals: [proposal({ 1: 'yes', 2: 'no' }, { participants: [1, 2] })] })))
    const { el } = await renderScreen(<Vorschlaege />, { path: '/vorschlaege', route: '/vorschlaege' })
    await waitFor(() => el.querySelector('.queue'))
    expect(el.querySelector('.queue').textContent).toContain('Keine Option passt allen')
    expect(el.textContent).not.toContain('Bereit zur Entscheidung')
  })
})
