// @vitest-environment jsdom
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onlineManager } from '@tanstack/react-query'
import App from '../App.jsx'
import { cachedGet, claimOfflineData, clearOfflineData } from '../lib/offline.js'
import { createQueryClient } from '../queryClient.js'
import { renderScreen, waitFor } from './render.jsx'

const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
const offline = () => vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch') })
const program = { movies: [{ id: 1, title: 'Digger', year: 2026, runtime: 100, poster_url: null, screenings: [{ id: 7, cinema_key: 'zoo', cinema_name: 'Zoo Palast', is_favorite: false, starts_at: '2099-10-13T20:15:00+02:00', version: 'OV', auditorium: null, seats: null, attrs: [], ticket_url: null }] }] }

beforeEach(() => { localStorage.clear(); sessionStorage.clear() })
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  onlineManager.setOnline(true)
  document.body.innerHTML = ''
})

describe('K23 Offline (nur lesen)', () => {
  it('AC01: angesehenes Programm offline mit Ladezeitpunkt; ohne Kopie Fehler; nur öffentliche Pfade', async () => {
    vi.stubGlobal('fetch', async () => json(program))
    await cachedGet('/program?date=2099-10-13')
    offline()
    const r = await cachedGet('/program?date=2099-10-13')
    expect(r.movies[0].title).toBe('Digger')
    expect(Date.parse(r.offline.savedAt)).toBeGreaterThan(0)
    await expect(cachedGet('/program?date=2099-10-14')).rejects.toMatchObject({ status: 0 })
    await expect(cachedGet('/me')).rejects.toThrow('not cacheable')
    await expect(cachedGet('/proposals')).rejects.toThrow('not cacheable')
  })

  it('AC01: App ohne Verbindung zeigt Programm-Kopie mit Hinweis statt Fehlerseite', async () => {
    vi.stubGlobal('fetch', async (url) => {
      const u = String(url)
      if (u.endsWith('/program/days')) return json({ days: ['2099-10-13'] })
      if (u.includes('/program?')) return json(program)
      return json({ error: 'nope' }, 404)
    })
    await cachedGet('/program/days')
    await cachedGet('/program?date=2099-10-13')
    let calls = 0
    vi.stubGlobal('fetch', async () => { calls++; throw new TypeError('Failed to fetch') })
    const { el } = await renderScreen(<App />, { path: '/', route: '*' })
    await waitFor(() => el.textContent.includes('Digger'))
    expect(el.textContent).toContain('Offline-Kopie, geladen')
    const settled = calls
    await waitFor(() => false, 200).catch(() => {})
    expect(calls).toBe(settled) // kein Neu-Laden-Kreislauf
  })

  it('AC02: offline schlägt eine Änderung sofort fehl und wird beim Wiederverbinden nicht nachgesendet', async () => {
    const client = createQueryClient()
    let calls = 0
    onlineManager.setOnline(false)
    const m = client.getMutationCache().build(client, { mutationFn: async () => { calls++; throw Object.assign(new Error('offline'), { status: 0 }) } })
    await expect(m.execute()).rejects.toMatchObject({ status: 0 })
    onlineManager.setOnline(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(calls).toBe(1)
    expect(client.getMutationCache().getAll().some((x) => x.state.isPaused)).toBe(false)
  })

  it('AC03: Abmelden und Kontowechsel löschen Kopie und Entwurf; erster Start nach Update nicht', async () => {
    vi.stubGlobal('fetch', async () => json(program))
    sessionStorage.setItem('kino.proposalDraft', '{"note":"x"}')
    claimOfflineData(1) // erster Start: nichts löschen (Entwurf bleibt über das Update)
    expect(sessionStorage.getItem('kino.proposalDraft')).not.toBeNull()
    await cachedGet('/program/days')
    claimOfflineData(2)
    expect(localStorage.getItem('kino.offline.v1')).toBeNull()
    expect(sessionStorage.getItem('kino.proposalDraft')).toBeNull()
    await cachedGet('/program/days')
    clearOfflineData()
    expect(Object.keys(localStorage).filter((k) => k.startsWith('kino.offline'))).toEqual([])
  })

  it('AC05: Service Worker cacht keine API-Antworten; Offline-Kopie enthält nur Programmdaten', async () => {
    const cfg = fs.readFileSync(path.join(process.cwd(), 'vite.config.js'), 'utf8')
    expect(cfg).not.toContain('runtimeCaching')
    expect(cfg).toContain('navigateFallbackDenylist: [/^\\/api/]')
    vi.stubGlobal('fetch', async () => json(program))
    await cachedGet('/program?date=2099-10-13')
    expect(Object.keys(JSON.parse(localStorage.getItem('kino.offline.v1')))).toEqual(['/program?date=2099-10-13'])
  })
})
