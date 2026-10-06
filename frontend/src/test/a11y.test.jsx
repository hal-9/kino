// @vitest-environment jsdom
import fs from 'node:fs'
import path from 'node:path'
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Sheet from '../components/Sheet.jsx'
import Vorschlaege from '../screens/Vorschlaege.jsx'
import { renderScreen, waitFor } from './render.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const reduce = (on) => vi.stubGlobal('matchMedia', (q) => ({ matches: on && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
const key = (el, k, shift = false) => act(async () => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true })))
const settle = () => act(() => new Promise((r) => setTimeout(r, 50)))

function Demo({ dirty = false, removeTrigger = false }) {
  const [open, setOpen] = useState(false)
  const [gone, setGone] = useState(false)
  return (
    <main>
      {!gone && <button id="trigger" onClick={() => setOpen(true)}>Öffnen</button>}
      <Sheet open={open} label="Testdialog" dirty={dirty} onClose={() => { setOpen(false); if (removeTrigger) setGone(true) }}>
        <h3>Titel</h3>
        <input id="first" aria-label="Eins" />
        <button id="last">OK</button>
      </Sheet>
    </main>
  )
}

async function mount(props) {
  const host = document.createElement('div')
  host.id = 'root'
  document.body.appendChild(host)
  await act(async () => createRoot(host).render(<Demo {...props} />))
  const trigger = document.getElementById('trigger')
  trigger.focus()
  await act(async () => trigger.click())
  return { host, trigger, dialog: document.querySelector('[role=dialog]') }
}

beforeEach(() => reduce(true))
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; document.body.style.overflow = '' })

describe('Sheet (K08-AC01/02/03/05)', () => {
  it('modal, benannt, Fokus im Dialog, Hintergrund inert, Scroll gesperrt', async () => {
    const { host, dialog } = await mount()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBe('Testdialog')
    expect(document.activeElement).toBe(dialog)
    expect(host.hasAttribute('inert')).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')
    expect(dialog.querySelector('button[aria-label="Schließen"]')).toBeTruthy()
  })

  it('Tab bleibt im Dialog', async () => {
    const { dialog } = await mount()
    const close = dialog.querySelector('.sheet-close')
    document.getElementById('last').focus()
    await key(dialog, 'Tab')
    expect(document.activeElement).toBe(close)
    await key(dialog, 'Tab', true)
    expect(document.activeElement).toBe(document.getElementById('last'))
  })

  it('Escape schließt und gibt Fokus an den Auslöser zurück; Hintergrund wieder bedienbar', async () => {
    const { host, trigger, dialog } = await mount()
    await key(dialog, 'Escape')
    await settle()
    expect(document.querySelector('[role=dialog]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(host.hasAttribute('inert')).toBe(false)
    expect(document.body.style.overflow).toBe('')
  })

  it('entfernter Auslöser → Fokus auf den Hauptbereich', async () => {
    const { dialog } = await mount({ removeTrigger: true })
    await act(async () => dialog.querySelector('.sheet-close').click())
    await settle()
    expect(document.activeElement).toBe(document.querySelector('main'))
  })

  it('geänderter Entwurf: Schließen fragt nach, Abbruch lässt offen', async () => {
    const ask = vi.fn(() => false)
    vi.stubGlobal('confirm', ask)
    const { dialog } = await mount({ dirty: true })
    await key(dialog, 'Escape')
    await settle()
    expect(ask).toHaveBeenCalled()
    expect(document.querySelector('[role=dialog]')).not.toBeNull()
  })

  it('ohne reduzierte Bewegung ebenfalls bedienbar (Animation an)', async () => {
    reduce(false)
    const { dialog } = await mount()
    expect(document.activeElement).toBe(dialog)
  })
})

describe('Stimmen sind benannt und zeigen den Zustand (K08-AC02)', () => {
  it('aria-pressed + Name je Stimme, Avatare mit Klartext', async () => {
    const snap = { starts_at: '2099-10-13T20:15:00+02:00', cinema_name: 'Delphi LUX', version: 'OmU', auditorium: null }
    const body = { members: [{ id: 1, name: 'tuncay' }, { id: 2, name: 'kim' }], proposals: [{ id: 3, status: 'open', movie: { id: 1, title: 'Digger' }, note: null, options: [{ id: 9, snapshot: snap, votes: { 1: 'yes' } }] }] }
    vi.stubGlobal('fetch', async (url) => new Response(JSON.stringify(String(url).endsWith('/me') ? { id: 1, name: 'tuncay', household: { id: 1 } } : body)))
    const { el } = await renderScreen(<Vorschlaege />, { path: '/vorschlaege', route: '/vorschlaege' })
    await waitFor(() => el.querySelector('.tri'))
    const btns = [...el.querySelectorAll('.tri button')]
    expect(btns.map((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-pressed')])).toEqual([['Ja', 'true'], ['Vielleicht', 'false'], ['Nein', 'false']])
    expect([...el.querySelectorAll('.avatar')].map((a) => a.getAttribute('aria-label'))).toEqual(['tuncay: Ja', 'kim: offen'])
  })
})

// Kontrast aus den CSS-Tokens berechnet (WCAG-Formel). Keine Browser-Messung: Verläufe nur an beiden Enden geprüft.
describe('Token-Kontrast (K08-AC04, berechnet)', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../index.css'), 'utf8')
  const block = (re) => Object.fromEntries([...css.match(re)[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]))
  const light = block(/:root \{([^}]*)\}/)
  const dark = { ...light, ...block(/prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}/) }
  const lum = (h) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const pairs = [['text', 'bg'], ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surface2'], ['primary', 'primary-dim'], ['primary', 'surface'],
    ['on-primary', 'primary'], ['on-primary', 'grad-from'], ['on-primary', 'grad-to'], ['on-accent', 'accent'], ['on-primary', 'danger'], ['danger', 'surface'], ['danger', 'surface2']]
  it.each([['hell', light], ['dunkel', dark]])('%s: Textpaare ≥ 4.5:1', (_, t) => {
    const low = pairs.map(([f, b]) => [f, b, ratio(t[f], t[b]).toFixed(2)]).filter(([, , r]) => r < 4.5)
    expect(low).toEqual([])
  })
})
