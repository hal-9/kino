// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import Einstellungen from '../screens/Einstellungen.jsx'
import { renderScreen, waitFor } from './render.jsx'

const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
const coord = {
  days: 90, proposals: { created: 3, open: 1, booked: 1, cancelled: 1, booked_share_of_decided: 0.5 }, decision_hours_median: 2.5, decided_with_time: 1,
  open_waiting: { proposals: 1, unanswered_people: 2 }, sources: { total: 5, failing: ['yorck'] }, changes_reviewed: 0,
  visits: { confirmed: 2, manual: 1, inferred: 3, legacy: 1 },
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('K36 Kennzahlen in den Einstellungen', () => {
  it('zeigt Nenner, Quellenfehler und Unbestätigte getrennt', async () => {
    vi.stubGlobal('fetch', async (url) => {
      const u = String(url)
      if (u.includes('/stats/coordination')) return json(coord)
      if (u.endsWith('/me')) return json({ id: 1, name: 'tuncay', household: { name: 'Crew' } })
      if (u.endsWith('/settings')) return json({ letterboxd_user: null, letterboxd: {} })
      return json({ sources: [] })
    })
    const { el } = await renderScreen(<Einstellungen />)
    await waitFor(() => el.textContent.includes('Gebucht von entschiedenen'))
    const t = el.querySelector('[aria-label="Planungs-Kennzahlen"]').textContent
    expect(t).toContain('3 angelegt · 1 gebucht · 1 abgesagt · 1 offen')
    expect(t).toContain('50 %')
    expect(t).toContain('2,5 h (aus 1)')
    expect(t).toContain('Quellen mit Fehler: yorck (von 5)')
    expect(t).toContain('2 bestätigt · 1 selbst eingetragen · 4 abgeleitet, unbestätigt')
  })
})
