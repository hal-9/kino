// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TicketDetails from '../components/TicketDetails.jsx'
import { renderScreen, waitFor } from './render.jsx'

const snapshot = { starts_at: '2099-10-07T19:50:00+02:00', cinema_name: 'Zoo Palast', title: 'Digger' }
const p = { id: 5, revision: 2, ticket: null }

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

// React-kontrollierte Felder: Wert über den nativen Setter setzen, dann input-Event.
function type(el, value) {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('K31 Ticketdaten prüfen', () => {
  it('falscher Tag blockiert; unbekanntes Kino braucht Bestätigung; Fehler behält Formular, Retry mit demselben Key, kein Rohtext gesendet', async () => {
    const sent = []
    let fail = true
    vi.stubGlobal('fetch', async (url, opts) => {
      sent.push({ url: String(url), body: opts.body, key: opts.headers['Idempotency-Key'] })
      if (fail) return new Response(JSON.stringify({ error: 'boom' }), { status: 500 })
      return new Response(JSON.stringify({}), { status: 200 })
    })
    const saved = vi.fn()
    const { el } = await renderScreen(<TicketDetails p={p} snapshot={snapshot} open onClose={() => {}} onSaved={saved} />)
    const q = (label) => document.querySelector(`[aria-label="${label}"]`)
    const saveBtn = () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Speichern')

    await act(async () => type(q('Bestätigungstext'), 'Saal 4\n08.10.2099 19:50 Uhr\nReihe 9, Sitz 11\nReihe 9, Sitz 12'))
    expect(q('Datum laut Ticket').value).toBe('2099-10-08')
    expect(q('Plätze').value).toBe('Reihe 9 Sitz 11, Reihe 9 Sitz 12')
    expect(document.body.textContent).toContain('Das Ticket passt nicht zu dieser Buchung')
    expect(saveBtn().disabled).toBe(true)

    await act(async () => type(q('Datum laut Ticket'), '2099-10-07'))
    expect(saveBtn().disabled).toBe(true) // Kino/Film im Text nicht genannt → Bestätigung nötig
    await act(async () => document.querySelector('input[type=checkbox]').click())
    expect(saveBtn().disabled).toBe(false)

    await act(async () => saveBtn().click())
    await waitFor(() => document.querySelector('[role=alert]'))
    expect(q('Plätze').value).toBe('Reihe 9 Sitz 11, Reihe 9 Sitz 12')
    expect(q('Bestätigungstext').value).toContain('Saal 4')
    fail = false
    await act(async () => saveBtn().click())
    await waitFor(() => saved.mock.calls.length === 1)
    expect(sent).toHaveLength(2)
    expect(sent[0].key).toBe(sent[1].key)
    const body = JSON.parse(sent[1].body)
    expect(body).toEqual({ date: '2099-10-07', time: '19:50', auditorium: '4', seats: [{ row: '9', seat: '11' }, { row: '9', seat: '12' }], revision: 2 })
    expect(sent[1].body).not.toContain('Reihe 9, Sitz')
    void el
  })
})
