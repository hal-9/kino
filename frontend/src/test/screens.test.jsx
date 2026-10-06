// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Vorschlaege from '../screens/Vorschlaege.jsx'
import Programm from '../screens/Programm.jsx'
import { fakeApi, renderScreen, waitFor } from './render.jsx'

const me = { id: 1, name: 'tuncay', household: { id: 1, name: 'Kino-Crew' } }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  sessionStorage.clear()
  document.body.innerHTML = ''
})

describe('Vorschläge', () => {
  it('zeigt die Liste (Positivkontrolle)', async () => {
    vi.stubGlobal('fetch', fakeApi({ '/me': me, '/proposals': { members: [], proposals: [] } }))
    const { el } = await renderScreen(<Vorschlaege />, { path: '/vorschlaege', route: '/vorschlaege' })
    await waitFor(() => el.textContent.includes('Noch nichts vorgeschlagen'))
  })

  it('fehlgeschlagene Abfrage rendert den Screen mit Fehlermeldung statt abzustürzen', async () => {
    vi.stubGlobal('fetch', fakeApi({ '/me': me, '/proposals': { status: 500, body: { error: 'boom' } } }))
    const { el } = await renderScreen(<Vorschlaege />, { path: '/vorschlaege', route: '/vorschlaege' })
    await waitFor(() => !el.textContent.includes('Lädt…'))
    expect(el.textContent).toContain('Vorschläge konnten nicht geladen werden')
  })
})

describe('Programm', () => {
  it('nennt den ersten Tag „Morgen“, wenn heute nichts mehr läuft (Berliner Datum, eingefroren 2026-10-06)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-06T21:30:00Z')) // 23:30 Berlin, UTC noch 6.10.
    vi.stubGlobal('fetch', fakeApi({ '/program/days': { days: ['2026-10-07', '2026-10-08'] }, '/sources': { sources: [] }, '/program': { movies: [] } }))
    const { el } = await renderScreen(<Programm />)
    await waitFor(() => el.querySelectorAll('.chip').length > 2)
    const chips = [...el.querySelectorAll('.chip')].map((c) => c.textContent)
    expect(chips[0]).toBe('Morgen')
    expect(chips).not.toContain('Heute')
  })

  it('409 beim Absenden: Entwurf mit Notiz bleibt, Hinweis erscheint', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'))
    const s = { id: 7, cinema_key: 'delphi-lux', cinema_name: 'Delphi LUX', is_favorite: true, starts_at: '2026-10-06T20:15:00+02:00', version: 'OmU', auditorium: null, seats: null, attrs: [], ticket_url: null }
    vi.stubGlobal('fetch', fakeApi({
      '/program/days': { days: ['2026-10-06'] }, '/sources': { sources: [] },
      '/program': { movies: [{ id: 1, title: 'Digger', year: 2026, runtime: 129, poster_url: null, screenings: [s] }] },
      '/proposals': { status: 409, body: { error: 'expired' } },
    }))
    const { el } = await renderScreen(<Programm />)
    await waitFor(() => el.textContent.includes('Vorschlagen'))
    await act(async () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Vorschlagen').click())
    await act(async () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Weiter').click()) // K13: Auswahl → Senden
    const note = document.querySelector('textarea')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(note, 'Wer kommt?')
      note.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Vorschlag senden').click())
    await waitFor(() => document.body.textContent.includes('schon begonnen'))
    expect(document.querySelector('textarea').value).toBe('Wer kommt?')
  })
})
