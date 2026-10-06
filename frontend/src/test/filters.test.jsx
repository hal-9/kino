// @vitest-environment jsdom
import { act } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Programm from '../screens/Programm.jsx'
import { renderScreen, waitFor } from './render.jsx'

const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
const click = (b) => act(async () => b.click())
const chip = (root, text) => [...root.querySelectorAll('.chip')].find((b) => b.textContent === text)
const show = (id, starts_at, extra = {}) => ({ id, cinema_key: 'x', cinema_name: 'Delphi LUX', is_favorite: true, starts_at, version: 'OmU', auditorium: null, seats: null, attrs: [], ticket_url: null, ...extra })
const PROGRAM = {
  '2099-10-13': [
    { id: 1, title: 'Digger', year: 2026, runtime: 100, poster_url: null, screenings: [show(11, '2099-10-13T18:00:00+02:00'), show(12, '2099-10-13T22:30:00+02:00'), show(13, '2099-10-13T20:00:00+02:00', { version: 'DF' })] },
    { id: 2, title: 'Ohne Angaben', year: 2026, runtime: null, poster_url: null, screenings: [show(21, '2099-10-13T19:00:00+02:00', { version: null })] },
  ],
  '2099-10-14': [{ id: 1, title: 'Digger', year: 2026, runtime: 100, poster_url: null, screenings: [show(14, '2099-10-14T20:00:00+02:00')] }],
}
const me = { id: 1, name: 'tuncay' }

function stub(requested = []) {
  vi.stubGlobal('fetch', async (url) => {
    const u = new URL(String(url), 'http://x')
    if (u.pathname === '/api/me') return json(me)
    if (u.pathname === '/api/program/days') return json({ days: Object.keys(PROGRAM) })
    if (u.pathname === '/api/sources') return json({ sources: [] })
    if (u.pathname === '/api/program') { requested.push(u.search); return json({ movies: PROGRAM[u.searchParams.get('date')] ?? [] }) }
    return json({ error: 'not found' }, 404)
  })
}
function Probe() {
  const loc = useLocation()
  const navigate = useNavigate()
  return <><output id="loc">{loc.search}</output><button id="back" onClick={() => navigate(-1)}>zurück</button></>
}
const render = (path = '/') => renderScreen(<><Programm /><Probe /></>, { path })
const loc = () => document.getElementById('loc').textContent
const rows = (el) => [...el.querySelectorAll('[aria-label^="Vorschlagen:"]')].map((b) => b.getAttribute('aria-label'))

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
  localStorage.clear()
  document.body.innerHTML = ''
})

describe('K14 Programm-Filter', () => {
  it('AC01: URL-Filter werden angewandt, Chips schreiben die URL, Zurück stellt wieder her', async () => {
    const requested = []
    stub(requested)
    const { el } = await render('/?tag=2099-10-14&ov=1')
    await waitFor(() => rows(el).length > 0)
    expect(requested.at(-1)).toContain('date=2099-10-14')
    expect(chip(el, 'OV/OmU').getAttribute('aria-pressed')).toBe('true')
    await click(chip(el, 'Nur Favoriten'))
    expect(loc()).toContain('fav=1')
    expect(loc()).toContain('tag=2099-10-14')
    await click(document.getElementById('back'))
    expect(loc()).not.toContain('fav=1')
    expect(chip(el, 'Nur Favoriten').getAttribute('aria-pressed')).toBe('false')
  })

  it('AC02: abgelaufener Tag fällt auf den nächsten zurück, übrige Filter bleiben', async () => {
    stub()
    const { el } = await render('/?tag=2020-01-01&ov=1&ab=19:00')
    await waitFor(() => el.textContent.includes('Der gewählte Tag ist vorbei'))
    expect(el.querySelector('.chip.active').textContent).not.toBe('OV/OmU')
    expect(chip(el, 'OV/OmU').getAttribute('aria-pressed')).toBe('true')
    expect(el.querySelector('[aria-label="Beginn ab"]').value).toBe('19:00')
  })

  it('AC04: unbekannte Fassung/Laufzeit erfüllen harte Filter nicht, stehen getrennt als unsicher', async () => {
    stub()
    const { el } = await render('/?tag=2099-10-13&ov=1&bis=23:00')
    await waitFor(() => el.textContent.includes('Ohne Angaben'))
    // 18:00 + 120 = 20:00 passt; 22:30 → 00:30 zu spät; DF raus; Film ohne Laufzeit/Fassung nur unsicher.
    expect(rows(el)).toEqual(['Vorschlagen: Delphi LUX 18:00', 'Vorschlagen: Delphi LUX 19:00'])
    const unsure = el.querySelector('.unsure')
    expect(unsure.textContent).toContain('Unsicher')
    expect(unsure.closest('.group').textContent).toContain('Ohne Angaben')
    expect(el.textContent).toContain('Ende ca. 20:00')
  })

  it('AC05: Filter verwerfen die Auswahl nicht', async () => {
    stub()
    const { el } = await render('/?tag=2099-10-13')
    await waitFor(() => rows(el).length > 0)
    await click(el.querySelector('[aria-label="Vorschlagen: Delphi LUX 20:00"]')) // DF
    await click(chip(el, 'OV/OmU'))
    expect(rows(el)).not.toContain('Vorschlagen: Delphi LUX 20:00')
    expect(el.querySelector('.tray').textContent).toContain('1 Vorstellung')
  })

  it('persönliche Standards je Konto; ausdrückliche URL gewinnt', async () => {
    localStorage.setItem('kino.programPrefs.v1.1', JSON.stringify({ v: 1, ov: true, fav: false, ab: '', bis: '' }))
    localStorage.setItem('kino.programPrefs.v1.2', JSON.stringify({ v: 1, ov: false, fav: true, ab: '', bis: '' }))
    stub()
    let r = await render('/')
    await waitFor(() => loc().includes('ov=1'))
    expect(loc()).not.toContain('fav=1')
    await r.unmount()
    document.body.innerHTML = ''
    r = await render('/?fav=1')
    await waitFor(() => rows(r.el).length > 0)
    expect(loc()).not.toContain('ov=1')
    // Geteilter Link ändert den gespeicherten Standard nicht; eigene Änderung schon.
    expect(JSON.parse(localStorage.getItem('kino.programPrefs.v1.1'))).toMatchObject({ ov: true, fav: false })
    await click(chip(r.el, 'OV/OmU'))
    expect(JSON.parse(localStorage.getItem('kino.programPrefs.v1.1'))).toMatchObject({ ov: true, fav: true })
    expect(JSON.parse(localStorage.getItem('kino.programPrefs.v1.2'))).toMatchObject({ fav: true, ov: false })
  })
})
