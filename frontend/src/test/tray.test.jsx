// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Programm from '../screens/Programm.jsx'
import { renderScreen, waitFor } from './render.jsx'

const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
const buttons = (root, text) => [...root.querySelectorAll('button')].filter((b) => b.textContent === text)
const click = (b) => act(async () => b.click())
const show = (id, starts_at, cinema_name = 'Delphi LUX', extra = {}) => ({ id, cinema_key: 'x', cinema_name, is_favorite: true, starts_at, version: 'OmU', auditorium: null, seats: null, attrs: [], ticket_url: null, ...extra })
const PROGRAM = {
  '2099-10-13': [{ id: 1, title: 'Digger', year: 2026, runtime: 100, poster_url: null, screenings: [show(11, '2099-10-13T18:00:00+02:00'), show(12, '2099-10-13T21:00:00+02:00', 'Zoo Palast')] },
    { id: 2, title: 'Anderer', year: 2026, runtime: null, poster_url: null, screenings: [show(21, '2099-10-13T19:00:00+02:00')] }],
  '2099-10-14': [{ id: 1, title: 'Digger', year: 2026, runtime: 100, poster_url: null, screenings: [show(13, '2099-10-14T20:00:00+02:00')] }],
}

function stub(posts = []) {
  vi.stubGlobal('fetch', async (url, opts = {}) => {
    const u = new URL(String(url), 'http://x')
    if (opts.method === 'POST') { posts.push(JSON.parse(opts.body)); return json({ id: 5 }, 201) }
    if (u.pathname === '/api/program/days') return json({ days: Object.keys(PROGRAM) })
    if (u.pathname === '/api/sources') return json({ sources: [] })
    if (u.pathname === '/api/program') return json({ movies: PROGRAM[u.searchParams.get('date')] ?? [] })
    return json({ error: 'not found' }, 404)
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  sessionStorage.clear()
  document.body.innerHTML = ''
})

describe('K13 Auswahl mehrerer Vorstellungen', () => {
  it('AC01/AC03: drei Vorstellungen über zwei Tage, Notiz; Auswahl übersteht Tageswechsel und Neu-Mount; ein Vorschlag', async () => {
    const posts = []
    stub(posts)
    let r = await renderScreen(<Programm />)
    await waitFor(() => r.el.textContent.includes('Zoo Palast'))
    await click(r.el.querySelector('[aria-label="Vorschlagen: Delphi LUX 18:00"]'))
    await click(r.el.querySelector('[aria-label="Vorschlagen: Zoo Palast 21:00"]'))
    expect(r.el.querySelector('.tray').textContent).toContain('2 Vorstellungen')
    await click(r.el.querySelectorAll('.chip')[1]) // anderer Tag
    await waitFor(() => r.el.querySelector('[aria-label="Vorschlagen: Delphi LUX 20:00"]'))
    await click(r.el.querySelector('[aria-label="Vorschlagen: Delphi LUX 20:00"]'))
    await click(buttons(r.el, 'Weiter')[0])
    const note = document.querySelector('textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(note, 'Wer kommt?')
      note.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(document.querySelector('.compare').textContent).toContain('Ende ca. 20:00 (inkl. ~20 Min. Werbung)')
    expect(document.querySelector('.compare').textContent).toContain('Saal unbekannt')
    // Wegnavigieren (Unmount) und zurück: Auswahl und Notiz sind noch da.
    await r.unmount()
    document.body.innerHTML = ''
    r = await renderScreen(<Programm />)
    await waitFor(() => r.el.querySelector('.tray'))
    expect(r.el.querySelector('.tray').textContent).toContain('3 Vorstellungen')
    await click(buttons(r.el, 'Weiter')[0])
    expect(document.querySelector('textarea').value).toBe('Wer kommt?')
    await click(buttons(document.body, 'Vorschlag senden')[0])
    await waitFor(() => posts.length === 1)
    expect(posts[0]).toEqual({ movie_id: 1, screening_ids: [11, 12, 13], note: 'Wer kommt?' })
  })

  it('AC02 (Client): Filmwechsel nur nach Bestätigung, höchstens fünf, abgelaufene blockieren das Senden', async () => {
    stub()
    const asked = []
    vi.stubGlobal('confirm', (t) => { asked.push(t); return false })
    const { el } = await renderScreen(<Programm />)
    await waitFor(() => el.textContent.includes('Anderer'))
    await click(el.querySelector('[aria-label="Vorschlagen: Delphi LUX 18:00"]'))
    await click(el.querySelector('[aria-label="Vorschlagen: Delphi LUX 19:00"]')) // anderer Film
    expect(asked[0]).toContain('„Digger“ verwerfen')
    expect(el.querySelector('.tray').textContent).toContain('Digger · 1 Vorstellung')
    // Ausgewählt erneut tippen entfernt wieder.
    await click(el.querySelector('[aria-label="Vorschlagen: Delphi LUX 18:00"]'))
    expect(el.querySelector('.tray')).toBeNull()

    sessionStorage.setItem('kino.proposalDraft', JSON.stringify({ movie: { id: 1, title: 'Digger', runtime: null }, shows: [show(11, '2000-01-01T18:00:00+01:00'), ...[2, 3, 4, 5].map((i) => show(30 + i, `2099-11-0${i}T20:00:00+01:00`))], note: '', key: 'k-123456789' }))
    document.body.innerHTML = ''
    const again = await renderScreen(<Programm />)
    await waitFor(() => again.el.textContent.includes('Zoo Palast'))
    await click(again.el.querySelector('[aria-label="Vorschlagen: Zoo Palast 21:00"]'))
    expect(again.el.textContent).toContain('Höchstens 5 Vorstellungen')
    await click(buttons(again.el, 'Weiter')[0])
    expect(document.querySelector('.compare').textContent).toContain('Hat schon begonnen')
    expect(document.querySelector('.compare').textContent).toContain('Ende unbekannt (Laufzeit fehlt)')
    expect(buttons(document.body, 'Vorschlag senden')[0].disabled).toBe(true)
  })
})
