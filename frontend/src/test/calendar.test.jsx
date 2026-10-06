// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CalendarLink from '../components/CalendarLink.jsx'
import { renderScreen, waitFor } from './render.jsx'

const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
const click = (el, text) => act(async () => [...el.querySelectorAll('button')].find((b) => b.textContent === text).click())
const URL1 = 'https://kino.example/api/cal/' + '1'.repeat(64) + '.ics'

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

function server(initial) {
  let state = initial
  const calls = []
  vi.stubGlobal('fetch', async (url, opts = {}) => {
    calls.push([opts.method ?? 'GET', opts.body ?? null])
    if (opts.method === 'POST') { state = { exists: true, legacy: false, https_url: null, webcal_url: null, include_tickets: JSON.parse(opts.body).include_tickets }; return json({ ...state, https_url: URL1, webcal_url: URL1.replace('https:', 'webcal:') }, 201) }
    if (opts.method === 'DELETE') { state = { exists: false, legacy: false, https_url: null, webcal_url: null, include_tickets: false }; return new Response(null, { status: 204 }) }
    return json(state)
  })
  return calls
}

describe('Kalender-Link-Steuerung (K10-AC04)', () => {
  it('erstellen zeigt den Link einmal, Kopieren meldet Erfolg, Ticket-Links standardmäßig aus', async () => {
    const calls = server({ exists: false, legacy: false, https_url: null, webcal_url: null, include_tickets: false })
    const write = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText: write } })
    const { el } = await renderScreen(<CalendarLink />)
    await waitFor(() => el.textContent.includes('Kalender-Link erstellen'))
    expect(el.querySelector('input[type=checkbox]').checked).toBe(false)
    await click(el, 'Kalender-Link erstellen')
    await waitFor(() => el.querySelector('input[aria-label="Kalender-Link"]'))
    expect(calls.find(([m]) => m === 'POST')[1]).toBe('{"include_tickets":false}')
    expect(el.querySelector('input[aria-label="Kalender-Link"]').value).toBe(URL1)
    await click(el, 'Link kopieren')
    expect(write).toHaveBeenCalledWith(URL1)
    expect(el.querySelector('[role=status]').textContent).toContain('Neuer Link')
    expect(el.textContent).toContain('Link kopiert.')
  })

  it('Kopieren schlägt fehl → verständliche Meldung', async () => {
    server({ exists: true, legacy: true, https_url: URL1, webcal_url: URL1, include_tickets: true })
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => { throw new Error('denied') } } })
    const { el } = await renderScreen(<CalendarLink />)
    await waitFor(() => el.textContent.includes('Älterer Link'))
    await click(el, 'Link kopieren')
    await waitFor(() => el.textContent.includes('Kopieren nicht möglich'))
  })

  it('Rotieren nur nach Bestätigung; Abbruch sendet nichts', async () => {
    const calls = server({ exists: true, legacy: false, https_url: null, webcal_url: null, include_tickets: false })
    vi.stubGlobal('confirm', () => false)
    const { el } = await renderScreen(<CalendarLink />)
    await waitFor(() => el.textContent.includes('Neuen Link erzeugen'))
    expect(el.textContent).toContain('nur beim Erzeugen angezeigt')
    await click(el, 'Neuen Link erzeugen')
    expect(calls.some(([m]) => m === 'POST')).toBe(false)
    vi.stubGlobal('confirm', () => true)
    await click(el, 'Neuen Link erzeugen')
    await waitFor(() => el.querySelector('input[aria-label="Kalender-Link"]'))
  })

  it('Fehler beim Laden zeigt Retry statt leerem Bereich', async () => {
    vi.stubGlobal('fetch', async () => json({ error: 'x' }, 500))
    const { el } = await renderScreen(<CalendarLink />)
    await waitFor(() => el.textContent.includes('Erneut versuchen'))
  })
})
