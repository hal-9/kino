// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Vorschlaege from '../screens/Vorschlaege.jsx'
import { renderScreen, waitFor } from './render.jsx'

const me = { id: 1, name: 'tuncay' }
const members = [me, { id: 2, name: 'kim' }]
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
const snap = { starts_at: '2099-10-13T20:15:00+02:00', cinema_name: 'Delphi LUX', street: 'Kantstraße 10', zip: '10623', version: 'OmU', auditorium: 'Kino 2', runtime: null, ticket_url: 'https://kaufen.example/x' }
const base = { revision: 2, participants: [1, 2], movie: { id: 1, title: 'Digger' }, note: null, meeting: { meet_at: null, meet_place: null, outing_note: null } }
const bookedP = { ...base, id: 5, status: 'booked', booked_option_id: 9, ticket_link: null,
  options: [{ id: 9, snapshot: snap, votes: { 1: 'yes', 2: 'yes' }, changes: [{ id: 1, field: 'auditorium', before: 'Kino 2', after: 'Kino 5', source: 'yorck', certainty: 'confirmed', acknowledged: false }] }] }
const openP = { ...base, id: 6, status: 'open', booked_option_id: null, ticket_link: null, options: [{ id: 10, snapshot: snap, votes: { 1: 'yes' }, changes: [] }] }

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

function stub(posts) {
  vi.stubGlobal('fetch', async (url, opts = {}) => {
    if (String(url).endsWith('/me')) return json(me)
    if (opts.method) { posts.push({ url: String(url), method: opts.method, body: opts.body && JSON.parse(opts.body) }); return json(bookedP) }
    return json({ members, proposals: [openP, bookedP] })
  })
}

describe('K17 Nächster Kinoabend', () => {
  it('AC01/AC02/AC05: Karte zeigt Zeit, Adresse+Route, Saal laut Buchung, Dabei, geschätztes Ende und Abweichung', async () => {
    stub([])
    const { el } = await renderScreen(<Vorschlaege />, { path: '/vorschlaege', route: '/vorschlaege' })
    await waitFor(() => el.querySelector('.outing'))
    const card = el.querySelector('.outing').textContent
    expect(card).toContain('Digger')
    expect(card).toContain('Ende ca. 22:35 (geschätzt: Laufzeit unbekannt, 120 Min. angenommen)')
    expect(card).toContain('Delphi LUX, Kantstraße 10, 10623 Berlin')
    expect(card).toContain('Laut Buchung: Kino 2 · OmU')
    expect(card).toContain('Dabei: tuncay, kim')
    expect(card).toContain('Saal jetzt Kino 5, vorher Kino 2')
    expect(card).toContain('Ticket-Link nicht in Kino erfasst')
    expect(el.querySelector('.outing a[href^="https://www.google.com/maps/dir/"]').getAttribute('href')).toContain('Kantstra%C3%9Fe%2010')
  })

  it('AC03: Kino-Checkout öffnen bucht nichts', async () => {
    const posts = []
    stub(posts)
    const { el } = await renderScreen(<Vorschlaege />, { path: '/vorschlaege', route: '/vorschlaege' })
    await waitFor(() => [...el.querySelectorAll('button')].some((b) => b.textContent === 'Gebucht'))
    await act(async () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Gebucht').click())
    const checkout = [...document.querySelectorAll('a')].find((a) => a.textContent.includes('Tickets beim Kino kaufen'))
    expect(checkout.getAttribute('href')).toBe('https://kaufen.example/x')
    expect(checkout.getAttribute('target')).toBe('_blank')
    checkout.addEventListener('click', (e) => e.preventDefault())
    await act(async () => checkout.click())
    expect(posts).toEqual([])
  })

  it('Treffpunkt wird als Berliner Zeitpunkt mit Revision gespeichert', async () => {
    const posts = []
    stub(posts)
    const { el } = await renderScreen(<Vorschlaege />, { path: '/vorschlaege', route: '/vorschlaege' })
    await waitFor(() => [...el.querySelectorAll('button')].some((b) => b.textContent === 'Treffpunkt'))
    await act(async () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Treffpunkt').click())
    const set = async (label, v) => {
      const input = document.querySelector(`[aria-label="${label}"]`)
      const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true })) })
    }
    expect(document.querySelector('[aria-label="Treffpunkt Datum"]').value).toBe('2099-10-13')
    await set('Treffpunkt Uhrzeit', '19:45')
    await set('Treffpunkt Ort', 'Eingang')
    await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Speichern').click())
    await waitFor(() => posts.length === 1)
    expect(posts[0]).toEqual({ url: '/api/proposals/5/meeting', method: 'PUT', body: { meet_at: '2099-10-13T19:45:00+02:00', meet_place: 'Eingang', outing_note: null, revision: 2 } })
  })
})
