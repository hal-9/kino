// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import Vorschlaege from '../screens/Vorschlaege.jsx'
import { fakeApi, renderScreen, waitFor } from './render.jsx'

const me = { id: 1, name: 'tuncay', household: { id: 1, name: 'Kino-Crew' } }

afterEach(() => {
  vi.unstubAllGlobals()
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
