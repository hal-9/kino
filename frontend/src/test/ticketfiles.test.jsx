// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TicketFiles from '../components/TicketFiles.jsx'
import { renderScreen, waitFor } from './render.jsx'

const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

async function pick(el, file) {
  const input = el.querySelector('[aria-label="Ticket-Datei wählen"]')
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}

describe('K32 Ticket-Datei hochladen', () => {
  it('sendet die Datei roh mit Typ; Erkanntes nur nach Prüfung übernehmen; Fehler verständlich', async () => {
    const calls = []
    let reply = json({ file: { id: 9 }, extraction: { status: 'ok', fields: { date: '2099-10-07', time: '19:50', auditorium: '4', seats: [{ row: '9', seat: '11' }] } } }, 201)
    vi.stubGlobal('fetch', async (url, opts = {}) => {
      const u = String(url).replace(/^\/api/, '')
      calls.push({ u, method: opts.method ?? 'GET', type: opts.headers?.['Content-Type'], body: opts.body })
      if (opts.method === 'POST') return reply
      return json({ files: [{ id: 9, mime: 'application/pdf', uploaded_by: 1, created_at: '2026-10-06 10:00:00' }] })
    })
    const onReview = vi.fn()
    const { el } = await renderScreen(<TicketFiles p={{ id: 3 }} me={{ id: 1 }} onReview={onReview} />)
    const file = new File(['%PDF-'], 'ticket.pdf', { type: 'application/pdf' })
    await pick(el, file)
    await waitFor(() => el.textContent.includes('Erkannt:'))
    const post = calls.find((c) => c.method === 'POST')
    expect(post).toMatchObject({ u: '/proposals/3/ticket-files', type: 'application/pdf' })
    expect(post.body).toBe(file)
    expect(el.textContent).toContain('2099-10-07 · 19:50 · Saal 4 · Reihe 9 Sitz 11')
    expect(onReview).not.toHaveBeenCalled()
    await act(async () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Prüfen und übernehmen').click())
    expect(onReview).toHaveBeenCalledWith(expect.objectContaining({ date: '2099-10-07' }))
    expect(el.querySelector('a[href="/api/ticket-files/9"]')).not.toBeNull()
    reply = json({ error: 'type mismatch' }, 415)
    await pick(el, new File(['x'], 'a.png', { type: 'image/png' }))
    await waitFor(() => el.textContent.includes('Dateityp passt nicht zum Inhalt.'))
  })
})
