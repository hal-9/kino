import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Fake-API: { '/me': body | { status, body } } → fetch-Stub. Unbekannte Pfade → 404.
export function fakeApi(routes) {
  return async (url) => {
    const path = String(url).replace(/^\/api/, '').split('?')[0]
    const hit = routes[path]
    const { status = 200, body = hit } = hit && 'status' in hit ? hit : { body: hit }
    if (hit === undefined) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    return new Response(JSON.stringify(body), { status })
  }
}

// Rendert einen echten Screen mit Router und frischem QueryClient (ohne Retry).
export async function renderScreen(element, { path = '/', route = '/' } = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes><Route path={route} element={element} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  })
  return { el, unmount: () => act(() => root.unmount()) }
}

// Wartet, bis cond() wahr ist (Query-Auflösung).
export async function waitFor(cond, ms = 1000) {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('waitFor timeout')
    await act(() => new Promise((r) => setTimeout(r, 10)))
  }
}
