import { describe, expect, it } from 'vitest'
import { clampLines, drawStory, tileRects, wrapText, W, H } from './storyCanvas.js'
import { tilesOf } from '../screens/Wrapped.jsx'

// Fake-2D-Kontext: Breite = Zeichen × 0,6 × Schriftgröße (breite Glyphen ×1,2), protokolliert Text und Clip.
function fakeCtx() {
  const calls = []
  let clip = null
  const size = (font) => Number(/(\d+)px/.exec(font)[1])
  const ctx = {
    font: '10px x', fillStyle: '', globalAlpha: 1,
    measureText: (s) => ({ width: Array.from(s).reduce((n, ch) => n + (ch.codePointAt(0) > 0x2e80 ? 1.2 : 0.6), 0) * size(ctx.font) }),
    fillText: (text, x, y) => calls.push({ text, x, y, size: size(ctx.font), width: ctx.measureText(text).width, clip }),
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect() {}, beginPath() {}, roundRect() {}, fill() {},
    rect: (x, y, w, h) => { ctx._rect = { x, y, w, h } },
    clip: () => { clip = ctx._rect },
    save() {}, restore: () => { clip = null },
  }
  return { ctx, calls }
}

const long = 'Der unglaublich lange Filmtitel mit Überlänge: Teil Zwei – Die Rückkehr der Untertitel'
const fixture = {
  year: 2026, scope: 'group', count: 123456, outings: 98765, films: 4321, person_visits: 123456, person_hours: 98765.5, unknown_runtime: 12, unconfirmed: 3, ungrouped: 7,
  ov_share: 0.42,
  top_cinema: { name: 'Kino in der Kulturbrauerei mit sehr langem Namen 🎬', count: 99 },
  top_auditorium: { name: 'Delphi LUX · Saal 7 – Großer Premierensaal mit Überlänge', count: 12 },
  top_row: { name: '１２３４５６７８９０１２３４５６７８９０', count: 4 },
  top_companion: { name: '山田太郎山田太郎山田太郎山田太郎', count: 30 },
  top_month: { month: 12, count: 40 },
  first: { title: long, date: '2026-01-01' },
  last: { title: '🎬🍿🎟️'.repeat(20), date: '2026-12-31' },
}

describe('K22 Wrapped-Bild', () => {
  it('Umbruch bricht auch Wörter ohne Leerzeichen (CJK/Emoji) und kürzt sichtbar', () => {
    const { ctx } = fakeCtx()
    ctx.font = '700 50px x'
    for (const l of wrapText(ctx, '山田太郎'.repeat(10), 200)) expect(ctx.measureText(l).width).toBeLessThanOrEqual(200)
    const r = clampLines(ctx, long, 300, 2)
    expect(r).toMatchObject({ truncated: true })
    expect(r.lines).toHaveLength(2)
    expect(r.lines[1].endsWith('…')).toBe(true)
  })

  it('AC01/AC02/AC04: alle Kacheln im Bild, keine Überlappung, Text bleibt in seiner Kachel, Kürzung mit „…“', () => {
    const tiles = tilesOf(fixture)
    expect(tiles.length).toBe(12)
    const { ctx, calls } = fakeCtx()
    drawStory(ctx, tiles, 'Unser Kinojahr 2026')
    const rects = tileRects(tiles.length)
    // Kacheln überlappen nicht und liegen im Bild.
    rects.forEach((a, i) => {
      expect(a.x >= 0 && a.y >= 0 && a.x + a.w <= W && a.y + a.h <= H).toBe(true)
      rects.slice(i + 1).forEach((b) => expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true))
    })
    const inTiles = calls.filter((c) => c.clip)
    for (const c of inTiles) {
      expect(c.x + c.width).toBeLessThanOrEqual(c.clip.x + c.clip.w)
      expect(c.y - c.size).toBeGreaterThanOrEqual(c.clip.y)
      expect(c.y).toBeLessThanOrEqual(c.clip.y + c.clip.h)
    }
    // Jede Kachel (Name) erscheint; Zahlen-Kacheln exakt wie auf dem Bildschirm.
    const texts = inTiles.map((c) => c.text)
    for (const t of tiles) expect(texts.some((x) => x === t.name || (x.endsWith('…') && t.name.startsWith(x.slice(0, -1))))).toBe(true)
    for (const v of ['98765', '123456', '4321', '98765,5']) expect(texts).toContain(v)
    expect(texts.some((x) => x.endsWith('…'))).toBe(true)
  })

  it('leere Werte: wenige Kacheln behalten Standardgröße', () => {
    expect(tileRects(2)[0].h).toBe(280)
    const { ctx, calls } = fakeCtx()
    drawStory(ctx, [{ name: 'Besuche', value: 0 }], 'Mein Kinojahr 2026')
    expect(calls.map((c) => c.text)).toContain('0')
  })
})
