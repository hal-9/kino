import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestApp } from './helpers.js'
import { runSync } from '../src/sync/index.js'

// K03: konservative Identität von Filmen und Vorstellungen.
// Quellen hier: zoopalast/yorck/uci (keine kinoheld-Zeilen, damit die Overlay-Tageslöschung nicht hineinspielt).
const base = { cinemaKey: 'zoo-palast', cinemaName: 'Zoo Palast', startsAt: '2099-10-13T20:00:00+02:00', year: null, version: null, auditorium: null, attrs: [], ticketUrl: null, sourceId: null, runtime: null }

describe('Vorstellungs-Identität', () => {
  let db
  beforeEach(() => ({ db } = setupTestApp()))

  const sync = (adapters) => runSync(db, { adapters, log() {}, minRows: () => 1, fetch: async () => ({ status: 404 }) })
  const src = (source, rows) => ({ fetchShows: async () => rows.map((r) => ({ ...base, source, ...r })) })
  const shows = () => db.prepare('SELECT s.id, m.title, s.version, s.auditorium FROM screenings s JOIN movies m ON m.id = s.movie_id ORDER BY s.id').all()

  it('AC01: Fortsetzungen mit gleichem Titelanfang bleiben zwei Filme und zwei Vorstellungen', async () => {
    await sync({ zoopalast: src('zoopalast', [{ title: 'Mission: Impossible – Dead Reckoning', sourceId: 'z1' }]), yorck: src('yorck', [{ title: 'Mission: Impossible – The Final Reckoning', sourceId: 'y1' }]) })
    expect(shows().map((s) => s.title)).toEqual(['Mission: Impossible – Dead Reckoning', 'Mission: Impossible – The Final Reckoning'])
  })

  it('AC02: gleicher Film und Zeitpunkt in zwei Sälen bzw. OV/DF bleiben getrennt', async () => {
    await sync({ zoopalast: src('zoopalast', [
      { title: 'Digger', sourceId: 'z1', auditorium: 'Kino 1', version: 'OV' },
      { title: 'Digger', sourceId: 'z2', auditorium: 'Kino 2', version: 'OV' },
      { title: 'Digger', sourceId: 'z3', auditorium: 'Kino 1', version: 'DF', startsAt: '2099-10-13T22:00:00+02:00' },
      { title: 'Digger', sourceId: 'z4', auditorium: 'Kino 1', version: 'OV', startsAt: '2099-10-13T22:00:00+02:00' },
    ]) })
    expect(shows()).toHaveLength(4)
  })

  it('AC03: Overlay derselben Vorstellung (gleicher Film, Saal passt) ergänzt; Wiederholung ist idempotent', async () => {
    const adapters = {
      zoopalast: src('zoopalast', [{ title: 'Digger', sourceId: 'z1', auditorium: 'Kino 1' }]),
      yorck: src('yorck', [{ title: 'Digger', sourceId: 'y1', version: 'OmU' }]),
    }
    await sync(adapters)
    await sync(adapters)
    expect(shows()).toEqual([{ id: expect.any(Number), title: 'Digger', version: 'OmU', auditorium: 'Kino 1' }])
    expect(db.prepare('SELECT source, source_key FROM screening_observations ORDER BY source').all()).toEqual([
      { source: 'yorck', source_key: 'y1' }, { source: 'zoopalast', source_key: 'z1' },
    ])
  })

  it('AC03: verifizierter Alias (TMDB-Originaltitel) führt zum selben Film', async () => {
    await sync({ zoopalast: src('zoopalast', [{ title: 'Die vergessene Insel', year: 2026, sourceId: 'z1' }]) })
    db.prepare("UPDATE movies SET tmdb_id = 42, title_original = 'Forgotten Island'").run()
    await sync({ yorck: src('yorck', [{ title: 'Forgotten Island', sourceId: 'y1', version: 'OV' }]) })
    expect(shows()).toEqual([{ id: expect.any(Number), title: 'Die vergessene Insel', version: 'OV', auditorium: null }])
  })

  it('AC04: unbekannter Saal bei mehreren Kandidaten und widersprüchliche Fassung führen nicht zusammen', async () => {
    await sync({
      zoopalast: src('zoopalast', [
        { title: 'Digger', sourceId: 'z1', auditorium: 'Kino 1' },
        { title: 'Digger', sourceId: 'z2', auditorium: 'Kino 2' },
        { title: 'Digger', sourceId: 'z3', version: 'DF', startsAt: '2099-10-13T22:00:00+02:00' },
      ]),
      yorck: src('yorck', [{ title: 'Digger', sourceId: 'y1' }, { title: 'Digger', sourceId: 'y2', version: 'OmU', startsAt: '2099-10-13T22:00:00+02:00' }]),
    })
    expect(shows()).toHaveLength(5)
  })

  it('AC04: Film ohne Jahr bei zwei gleichnamigen Filmen (Remake) wird keinem zugeschlagen', async () => {
    await sync({ zoopalast: src('zoopalast', [
      { title: 'Dune', year: 1984, sourceId: 'z1' }, { title: 'Dune', year: 2021, sourceId: 'z2', startsAt: '2099-10-13T22:00:00+02:00' },
    ]) })
    await sync({ yorck: src('yorck', [{ title: 'Dune', sourceId: 'y1', cinemaKey: 'delphi-lux' }]) })
    expect(db.prepare("SELECT year FROM movies WHERE norm_title = 'dune' ORDER BY year IS NULL, year").all().map((m) => m.year)).toEqual([1984, 2021, null])
  })
})
