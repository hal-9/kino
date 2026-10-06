// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MovieSheet from '../components/MovieSheet.jsx'
import { renderScreen, waitFor } from './render.jsx'

const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
const base = { id: 5, title: 'Digger', year: 2026, cast: [], letterboxd_url: 'https://letterboxd.com/search/Digger/', overview: null }
const btn = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent === text)

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })

describe('Film-Metadaten-Status (K19-AC04)', () => {
  it('Fehltreffer: ehrlicher Hinweis mit nächstem Versuch; Retry zeigt Treffer', async () => {
    const calls = []
    vi.stubGlobal('fetch', async (url, opts = {}) => {
      calls.push([opts.method ?? 'GET', String(url)])
      if (opts.method === 'POST') return json({ ...base, overview: 'Handlung XY', metadata: { status: 'matched', tmdb_id: 99, next_retry_at: null } })
      return json({ ...base, metadata: { status: 'not_found', tmdb_id: null, next_retry_at: '2026-10-13T10:00:00.000Z' } })
    })
    await renderScreen(<MovieSheet movieId={5} onClose={() => {}} />)
    await waitFor(() => document.body.textContent.includes('Kein passender Film'))
    expect(document.body.textContent).toContain('Nächster automatischer Versuch ab')
    await act(async () => btn('Jetzt erneut suchen').click())
    await waitFor(() => document.body.textContent.includes('Handlung XY'))
    expect(calls.some(([m, u]) => m === 'POST' && u.endsWith('/movies/5/tmdb/retry'))).toBe(true)
    expect(document.body.textContent).not.toContain('Kein passender Film')
  })

  it('Korrektur per TMDB-Link sendet die ID; belegte ID → klare Meldung', async () => {
    const bodies = []
    vi.stubGlobal('fetch', async (url, opts = {}) => {
      if (opts.method === 'PUT') { bodies.push(JSON.parse(opts.body)); return json({ error: 'tmdb_id in use' }, 409) }
      return json({ ...base, metadata: { status: 'ambiguous', tmdb_id: null, next_retry_at: null } })
    })
    await renderScreen(<MovieSheet movieId={5} onClose={() => {}} />)
    await waitFor(() => document.body.textContent.includes('Mehrere mögliche Filme'))
    const input = document.querySelector('input[aria-label="TMDB-Link oder -ID"]')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'https://www.themoviedb.org/movie/841-dune')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => btn('Zuordnung speichern').click())
    await waitFor(() => document.body.textContent.includes('gehört schon zu einem anderen Film'))
    expect(bodies).toEqual([{ tmdb_id: 841 }])
  })
})
