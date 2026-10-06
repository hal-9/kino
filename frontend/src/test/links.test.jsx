// @vitest-environment jsdom
import { act } from 'react'
import { useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App.jsx'
import Vorschlaege from '../screens/Vorschlaege.jsx'
import { renderScreen, waitFor } from './render.jsx'

const me = { id: 1, name: 'tuncay' }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
const snap = { starts_at: '2099-10-13T20:15:00+02:00', cinema_name: 'Delphi LUX', version: 'OmU', auditorium: null }
const proposal = { id: 5, status: 'booked', revision: 2, participants: [1], movie: { id: 1, title: 'Digger' }, note: 'privat', booked_option_id: 9, ticket_link: 'https://tickets.example/qr-geheim', options: [{ id: 9, snapshot: snap, votes: { 1: 'yes' }, changes: [] }] }
function Probe() { return <output id="loc">{useLocation().pathname + useLocation().search}</output> }

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('K16 Links überleben Login und Teilen', () => {
  it('AC01: abgemeldeter Deep-Link führt nach dem Login zurück zum Vorschlag', async () => {
    let loggedIn = false
    vi.stubGlobal('fetch', async (url, opts = {}) => {
      const path = String(url)
      if (path === '/api/login') { loggedIn = true; return json(me) }
      if (path === '/api/me') return loggedIn ? json(me) : json({ error: 'unauthorized' }, 401)
      if (path === '/api/proposals/5') return json({ members: [me], proposal, history: [] })
      return json({ error: 'not found' }, 404)
    })
    const { el } = await renderScreen(<><App /><Probe /></>, { path: '/vorschlaege/5', route: '*' })
    await waitFor(() => el.querySelector('form'))
    expect(document.getElementById('loc').textContent).toBe('/login?next=%2Fvorschlaege%2F5')
    await act(async () => el.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await waitFor(() => el.textContent.includes('Digger'))
    expect(document.getElementById('loc').textContent).toBe('/vorschlaege/5')
  })

  it('AC03: bösartiges next führt nach dem Login auf die Startseite', async () => {
    vi.stubGlobal('fetch', async (url) => (String(url) === '/api/login' ? json(me) : String(url) === '/api/me' ? json({ error: 'x' }, 401) : json({}, 404)))
    const { el } = await renderScreen(<><App /><Probe /></>, { path: '/login?next=%2F%2Fevil.example', route: '*' })
    await waitFor(() => el.querySelector('form'))
    await act(async () => el.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await waitFor(() => !document.getElementById('loc').textContent.startsWith('/login?next=%2F%2F'))
    expect(document.getElementById('loc').textContent).not.toContain('evil')
  })

  describe('AC05: Teilen', () => {
    const render = async () => {
      vi.stubGlobal('fetch', async (url) => (String(url).endsWith('/me') ? json(me) : json({ members: [me], proposal, history: [] })))
      const r = await renderScreen(<Vorschlaege />, { path: '/vorschlaege/5', route: '/vorschlaege/:id' })
      await waitFor(() => r.el.textContent.includes('Link teilen'))
      return r
    }
    const clickShare = (el) => act(async () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Link teilen').click())

    it('teilt nur App-Link und Kurztext, keine Ticket-/Kalender-Links oder Notiz', async () => {
      const sent = []
      vi.stubGlobal('navigator', { ...navigator, share: async (d) => { sent.push(d) } })
      const { el } = await render()
      await clickShare(el)
      expect(sent).toHaveLength(1)
      expect(sent[0].url).toMatch(/\/vorschlaege\/5$/)
      expect(JSON.stringify(sent)).not.toMatch(/tickets\.example|qr-geheim|\/api\/cal|privat/)
    })

    it('Abbrechen zeigt keinen Fehler; ohne Share-API und ohne Zwischenablage → manuell', async () => {
      vi.stubGlobal('navigator', { ...navigator, share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }) } })
      let r = await render()
      await clickShare(r.el)
      expect(r.el.querySelector('[role=status]')).toBeNull()
      await r.unmount()
      document.body.innerHTML = ''
      vi.stubGlobal('navigator', { ...navigator, share: undefined, clipboard: { writeText: async () => { throw new Error('denied') } } })
      r = await render()
      await clickShare(r.el)
      await waitFor(() => r.el.querySelector('[aria-label="Link zum Vorschlag"]'))
      expect(r.el.querySelector('[aria-label="Link zum Vorschlag"]').value).toMatch(/\/vorschlaege\/5$/)
    })
  })
})
