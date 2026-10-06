// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App.jsx'
import Login from '../screens/Login.jsx'
import Vorschlaege from '../screens/Vorschlaege.jsx'
import Programm from '../screens/Programm.jsx'
import { fakeApi, renderScreen, waitFor } from './render.jsx'

const me = { id: 1, name: 'tuncay', household: { id: 1, name: 'Kino-Crew' } }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
const click = (el, text) => act(async () => [...el.querySelectorAll('button')].find((b) => b.textContent === text).click())
const snap = { starts_at: '2099-10-13T20:15:00+02:00', cinema_name: 'Delphi LUX', version: 'OmU', auditorium: null }
const proposal = (votes = { 1: 'yes' }) => ({ id: 3, status: 'open', movie: { id: 1, title: 'Digger' }, note: null, options: [{ id: 9, snapshot: snap, votes }] })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  sessionStorage.clear()
  document.body.innerHTML = ''
})

describe('K07-AC01/AC05 Lesefehler', () => {
  it('abgelehnter Erstabruf zeigt Erneut-versuchen; Retry lädt', async () => {
    let fail = true
    vi.stubGlobal('fetch', async (url) => {
      if (String(url).endsWith('/me')) return json(me)
      return fail ? json({ error: 'boom' }, 500) : json({ members: [], proposals: [] })
    })
    const { el } = await renderScreen(<Vorschlaege />, { path: '/vorschlaege', route: '/vorschlaege' })
    await waitFor(() => el.textContent.includes('Erneut versuchen'))
    expect(el.textContent).toContain('Vorschläge konnten nicht geladen werden')
    fail = false
    await click(el, 'Erneut versuchen')
    await waitFor(() => el.textContent.includes('Noch nichts vorgeschlagen'))
  })

  it('fehlgeschlagene Aktualisierung behält Daten und markiert sie als veraltet', async () => {
    let fail = false
    vi.stubGlobal('fetch', async (url) => {
      if (String(url).endsWith('/me')) return json(me)
      return fail ? json({ error: 'boom' }, 503) : json({ members: [{ id: 1, name: 'tuncay' }], proposals: [proposal()] })
    })
    const { el, client } = await renderScreen(<Vorschlaege />, { path: '/vorschlaege', route: '/vorschlaege' })
    await waitFor(() => el.textContent.includes('Digger'))
    fail = true
    await act(() => client.refetchQueries({ queryKey: ['proposals'] }))
    await waitFor(() => el.textContent.includes('veraltet'))
    expect(el.textContent).toContain('Digger')
    expect(el.textContent).not.toContain('Noch nichts vorgeschlagen')
  })
})

describe('K07-AC02 Anmeldung und Ausfälle', () => {
  const app = () => renderScreen(<><App /><span id="probe" /></>, { path: '/vorschlaege', route: '*' })

  it('/me 500 meldet nicht ab, sondern bietet Retry', async () => {
    vi.stubGlobal('fetch', fakeApi({ '/me': { status: 500, body: { error: 'x' } } }))
    const { el } = await app()
    await waitFor(() => el.textContent.includes('Erneut versuchen'))
    expect(el.textContent).toContain('Serverfehler')
    expect(el.textContent).not.toContain('Anmelden')
  })

  it('offline: keine Verbindung, kein Login', async () => {
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch') })
    const { el } = await app()
    await waitFor(() => el.textContent.includes('Keine Verbindung'))
    expect(el.textContent).not.toContain('Anmelden')
  })

  it('/me 401 führt zum Login', async () => {
    vi.stubGlobal('fetch', fakeApi({ '/me': { status: 401, body: { error: 'unauthorized' } } }))
    const { el } = await app()
    await waitFor(() => el.textContent.includes('Anmelden'))
  })

  it.each([
    [401, 'E-Mail oder Passwort stimmt nicht.'],
    [429, 'Zu viele Versuche'],
    [500, 'Serverfehler'],
  ])('Login %i → passende Meldung', async (status, text) => {
    vi.stubGlobal('fetch', fakeApi({ '/login': { status, body: { error: 'x' } } }))
    const { el } = await renderScreen(<Login />)
    await act(async () => el.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await waitFor(() => el.querySelector('[role=alert]'))
    expect(el.querySelector('[role=alert]').textContent).toContain(text)
  })
})

describe('K07-AC03 Entwurf bleibt, Retry mit demselben Schlüssel', () => {
  it('Netzfehler beim Senden: Notiz bleibt, zweiter Versuch nutzt denselben Idempotency-Key', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'))
    const s = { id: 7, cinema_key: 'delphi-lux', cinema_name: 'Delphi LUX', is_favorite: true, starts_at: '2026-10-06T20:15:00+02:00', version: 'OmU', auditorium: null, seats: null, attrs: [], ticket_url: null }
    const keys = []
    const base = fakeApi({ '/program/days': { days: ['2026-10-06'] }, '/sources': { sources: [] }, '/program': { movies: [{ id: 1, title: 'Digger', year: 2026, runtime: 129, poster_url: null, screenings: [s] }] } })
    vi.stubGlobal('fetch', async (url, opts = {}) => {
      if (opts.method !== 'POST') return base(url)
      keys.push(opts.headers['Idempotency-Key'])
      if (keys.length === 1) throw new TypeError('network down')
      return json({ id: 42 }, 201)
    })
    const { el } = await renderScreen(<Programm />)
    await waitFor(() => el.textContent.includes('Vorschlagen'))
    await click(el, 'Vorschlagen')
    await click(el, 'Weiter')
    const note = document.querySelector('textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(note, 'Wer kommt?')
      note.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(document.body, 'Vorschlag senden')
    await waitFor(() => document.body.textContent.includes('Keine Verbindung'))
    expect(document.querySelector('textarea').value).toBe('Wer kommt?')
    await click(document.body, 'Vorschlag senden')
    await waitFor(() => keys.length === 2)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
  })
})

describe('K07-AC04 Stimmen in Reihenfolge', () => {
  it('schnelles ✓ dann ✗: zweite Stimme erst nach der ersten gesendet, Anzeige bleibt bei ✗', async () => {
    const sent = []
    let release
    let server = { 1: 'yes' }
    vi.stubGlobal('fetch', async (url, opts = {}) => {
      if (String(url).endsWith('/me')) return json(me)
      if (opts.method === 'PUT') {
        const v = JSON.parse(opts.body).value
        sent.push(v)
        if (sent.length === 1) await new Promise((r) => { release = r })
        server = { 1: v }
        return new Response(null, { status: 204 })
      }
      return json({ members: [{ id: 1, name: 'tuncay' }], proposals: [proposal(server)] })
    })
    const { el } = await renderScreen(<Vorschlaege />, { path: '/vorschlaege', route: '/vorschlaege' })
    await waitFor(() => el.querySelector('.tri'))
    await click(el, '?')
    await click(el, '✗')
    expect(sent).toEqual(['maybe'])
    expect(el.querySelector('.tri .on').textContent).toBe('✗')
    await act(async () => release())
    await waitFor(() => sent.length === 2)
    expect(sent).toEqual(['maybe', 'no'])
    await waitFor(() => server[1] === 'no')
    await act(() => new Promise((r) => setTimeout(r, 30)))
    expect(el.querySelector('.tri .on').textContent).toBe('✗')
  })
})
