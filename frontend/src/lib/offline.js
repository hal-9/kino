import { useSyncExternalStore } from 'react'
import { api } from '../api.js'

// K23: Offline nur lesend. Gemerkt wird ausschließlich das öffentliche Programm (Liste + Tage), je Pfad mit
// Ladezeitpunkt, höchstens MAX Einträge. Keine privaten Antworten, keine Tickets/Feed-Links/Sitzungsdaten.
const KEY = 'kino.offline.v1'
const MAX = 4
const PUBLIC = /^\/program(\/days)?(\?|$)/
const DRAFT_KEYS = ['kino.proposalDraft']

const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? {} } catch { return {} }
}

// Online: normal laden und merken. Keine Verbindung (status 0): letzte gespeicherte Antwort mit
// `offline.savedAt` (Zeitpunkt des Ladens), sonst den Fehler weiterreichen.
export async function cachedGet(path) {
  if (!PUBLIC.test(path)) throw new Error(`not cacheable: ${path}`)
  try {
    const data = await api.get(path)
    const all = { ...read(), [path]: { savedAt: new Date().toISOString(), data } }
    const keep = Object.entries(all).sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt)).slice(0, MAX)
    try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(keep))) } catch {}
    return data
  } catch (err) {
    const hit = err.status === 0 && read()[path]
    if (!hit) throw err
    return { ...hit.data, offline: { savedAt: hit.savedAt } }
  }
}

// Abmelden/Kontowechsel (auch offline): gemerkte Antworten und Entwürfe des Kontos löschen.
export function clearOfflineData() {
  try { localStorage.removeItem(KEY); localStorage.removeItem(OWNER) } catch {}
  for (const k of DRAFT_KEYS) try { sessionStorage.removeItem(k) } catch {}
}

// Anderes Konto als beim letzten Mal auf diesem Gerät → erst löschen, dann neu zuordnen.
const OWNER = 'kino.offline.owner'
export function claimOfflineData(userId) {
  try {
    const prev = localStorage.getItem(OWNER)
    if (prev !== null && prev !== String(userId)) clearOfflineData()
    localStorage.setItem(OWNER, String(userId))
  } catch {}
}

const subscribe = (cb) => {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => { window.removeEventListener('online', cb); window.removeEventListener('offline', cb) }
}
export const useOnline = () => useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
