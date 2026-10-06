// K22: Wrapped-Bild (1080×1920). Alle Kacheln, gemessener Umbruch, begrenzte Schriftverkleinerung,
// Clipping je Kachel und sichtbares „…“ bei Kürzung. Volltext steht auf dem Bildschirm (Kacheln).
export const W = 1080, H = 1920
const FONT = 'system-ui, sans-serif'
const TOP = 330, BOTTOM = 72, SIDE = 72, GAP = 40, COLS = 2, PAD = 32

// Text in Zeilen ≤ maxW; zu lange Wörter (z. B. CJK ohne Leerzeichen) zeichenweise (Emoji-sicher).
export function wrapText(ctx, text, maxW) {
  const lines = []
  let line = ''
  const fits = (s) => ctx.measureText(s).width <= maxW
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (fits(next)) { line = next; continue }
    if (line) lines.push(line)
    line = ''
    for (const ch of Array.from(word)) {
      if (line && !fits(line + ch)) { lines.push(line); line = ch } else line += ch
    }
  }
  return [...lines, line]
}

// Höchstens maxLines Zeilen; Rest wird mit „…“ sichtbar gekürzt.
export function clampLines(ctx, text, maxW, maxLines) {
  const lines = wrapText(ctx, text, maxW)
  if (lines.length <= maxLines) return { lines, truncated: false }
  const kept = lines.slice(0, maxLines)
  let last = Array.from(kept[maxLines - 1])
  while (last.length && ctx.measureText(`${last.join('')}…`).width > maxW) last.pop()
  kept[maxLines - 1] = `${last.join('').trimEnd()}…`
  return { lines: kept, truncated: true }
}

// Größte Schrift (max → min), bei der der Wert in die verfügbaren Zeilen passt; sonst min + „…“.
export function fitValue(ctx, text, maxW, maxH, { max = 56, min = 32, weight = 700 } = {}) {
  for (let size = max; size >= min; size -= 4) {
    ctx.font = `${weight} ${size}px ${FONT}`
    const maxLines = Math.max(1, Math.floor(maxH / (size * 1.1)))
    const r = clampLines(ctx, text, maxW, maxLines)
    if (!r.truncated || size - 4 < min) return { ...r, size }
  }
}

export function tileRects(n) {
  const rows = Math.max(1, Math.ceil(n / COLS))
  const w = (W - 2 * SIDE - (COLS - 1) * GAP) / COLS
  const h = Math.min(280, (H - TOP - BOTTOM - (rows - 1) * GAP) / rows)
  return Array.from({ length: n }, (_, i) => ({ x: SIDE + (i % COLS) * (w + GAP), y: TOP + Math.floor(i / COLS) * (h + GAP), w, h }))
}

export function drawStory(ctx, tiles, title) {
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, '#a8323f')
  g.addColorStop(1, '#e0705c')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#fff'
  ctx.font = `700 84px ${FONT}`
  const t = fitValue(ctx, title, W - 2 * SIDE, 92, { max: 84, min: 48 })
  ctx.fillText(t.lines[0], SIDE, 190)
  ctx.font = `500 40px ${FONT}`
  ctx.globalAlpha = 0.85
  ctx.fillText('LiLief-Kino', SIDE, 250)
  ctx.globalAlpha = 1
  const rects = tileRects(tiles.length)
  tiles.forEach((tile, i) => {
    const { x, y, w, h } = rects[i]
    const inner = w - 2 * PAD
    ctx.fillStyle = 'rgba(255,255,255,0.18)'
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 36)
    ctx.fill()
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, w, h)
    ctx.clip()
    ctx.fillStyle = '#fff'
    ctx.font = `500 28px ${FONT}`
    const nameY = y + PAD + 24
    ctx.fillText(clampLines(ctx, tile.name, inner, 1).lines[0], x + PAD, nameY)
    let bottom = y + h - PAD
    if (tile.sub) {
      ctx.font = `500 26px ${FONT}`
      ctx.globalAlpha = 0.85
      ctx.fillText(clampLines(ctx, tile.sub, inner, 1).lines[0], x + PAD, bottom)
      ctx.globalAlpha = 1
      bottom -= 26 + 14
    }
    const top = nameY + 16
    const v = fitValue(ctx, String(tile.value), inner, bottom - top)
    v.lines.forEach((l, k) => ctx.fillText(l, x + PAD, top + v.size + k * v.size * 1.1))
    ctx.restore()
  })
}
