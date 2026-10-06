// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Besuche from '../screens/Besuche.jsx'
import { renderScreen, waitFor } from './render.jsx'

const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

describe('K30 Saal-Notizen im Besuch', () => {
  it('lädt Notizen genau dieses Kinos/Saals erst beim Öffnen und speichert privat per Standard', async () => {
    const calls = []
    let notes = [{ id: 1, mine: false, user_name: 'kim', noted_on: '2026-08-01', row: '9', seat: null, note: 'Ton laut', shared: true }]
    vi.stubGlobal('fetch', async (url, opts = {}) => {
      const u = String(url).replace(/^\/api/, '')
      calls.push({ u, method: opts.method ?? 'GET', body: opts.body && JSON.parse(opts.body) })
      if (u === '/me') return json({ id: 1, name: 'tuncay' })
      if (u === '/visits') return json({ members: [{ id: 1, name: 'tuncay' }, { id: 2, name: 'kim' }], visits: [{ id: 5, user_id: 1, user_name: 'tuncay', snapshot: { title: 'Digger', cinema_key: 'zoo-palast', cinema_name: 'Zoo Palast' }, watched_on: '2026-09-01', auditorium: 'Saal 1', row: '9', seats: '11', companions: [], attendance: 'manual' }] })
      if (u === '/visits/pending') return json({ pending: [] })
      if (u.startsWith('/rooms/notes?')) return json({ notes })
      if (u === '/rooms/notes') { notes = [...notes, { id: 2, mine: true, noted_on: '2026-09-01', note: 'gut', shared: false }]; return json({}, 201) }
      return json({ error: 'not found' }, 404)
    })
    const { el } = await renderScreen(<Besuche />)
    await waitFor(() => el.textContent.includes('Notizen zu Saal 1'))
    expect(calls.some((c) => c.u.startsWith('/rooms'))).toBe(false)
    const det = el.querySelector('details.fix')
    await act(async () => { det.open = true; det.dispatchEvent(new Event('toggle')) })
    await waitFor(() => el.textContent.includes('Ton laut'))
    expect(calls.find((c) => c.u.startsWith('/rooms')).u).toBe('/rooms/notes?cinema_key=zoo-palast&room=Saal+1')
    expect(el.textContent).not.toMatch(/bester Platz/i)
    const input = el.querySelector('[aria-label="Notiz zum Saal"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    await act(async () => { setter.call(input, 'gut'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Notiz speichern').click())
    await waitFor(() => el.textContent.includes(': gut'))
    expect(calls.find((c) => c.method === 'POST').body).toMatchObject({ cinema_key: 'zoo-palast', room: 'Saal 1', visit_id: 5, row: '9', seat: '11', shared: false })
  })
})

describe('K35 Reaktionen im Besuch', () => {
  it('Spoiler zugeklappt, Wartende nur als Zahl, Speichern standardmäßig privat', async () => {
    const calls = []
    vi.stubGlobal('fetch', async (url, opts = {}) => {
      const u = String(url).replace(/^\/api/, '')
      calls.push({ u, method: opts.method ?? 'GET', body: opts.body && JSON.parse(opts.body) })
      if (u === '/me') return json({ id: 1, name: 'tuncay' })
      if (u === '/visits') return json({ members: [{ id: 1, name: 'tuncay' }], visits: [{ id: 5, user_id: 1, user_name: 'tuncay', snapshot: { title: 'Digger', cinema_name: 'Zoo Palast' }, watched_on: '2026-09-01', companions: [], attendance: 'manual' }] })
      if (u === '/visits/pending') return json({ pending: [] })
      if (u === '/visits/5/reactions') return json({ reactions: [{ visit_id: 6, mine: false, user_name: 'kim', line: 'Am Ende ist er tot', spoiler: true, visibility: 'household' }], waiting: 1 })
      if (u === '/visits/5/reaction') return json({})
      return json({ error: 'not found' }, 404)
    })
    const { el } = await renderScreen(<Besuche />)
    await waitFor(() => el.textContent.includes('Reaktionen'))
    const det = [...el.querySelectorAll('details.fix')].find((d) => d.querySelector('summary').textContent === 'Reaktionen')
    await act(async () => { det.open = true; det.dispatchEvent(new Event('toggle')) })
    await waitFor(() => el.querySelector('[aria-label="Deine Reaktion"]'))
    const spoiler = det.querySelector('ul details')
    expect(spoiler.open).toBe(false)
    expect(spoiler.querySelector('summary').textContent).toBe('Spoiler anzeigen')
    expect(el.textContent).toContain('1 Reaktion(en) zum gemeinsamen Aufdecken')
    const input = el.querySelector('[aria-label="Deine Reaktion"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    await act(async () => { setter.call(input, 'Schön'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Reaktion speichern').click())
    await waitFor(() => calls.some((c) => c.method === 'PUT'))
    expect(calls.find((c) => c.method === 'PUT').body).toEqual({ line: 'Schön', spoiler: false, visibility: 'private' })
  })
})
