import { describe, expect, it } from 'vitest'
import { loginPath, safeReturnTo } from './returnTo.js'

const BS = String.fromCharCode(0x5c) // Backslash, ohne Escape-Sequenz im Quelltext

describe('K16-AC03 Rücksprungziel', () => {
  it('erlaubt interne Routen', () => {
    for (const ok of ['/', '/vorschlaege', '/vorschlaege/42', '/besuche/7', '/einstellungen', '/wrapped', '/?tag=2099-10-13&ov=1']) expect(safeReturnTo(ok)).toBe(ok)
  })

  it('verwirft externe, protokoll-relative, Backslash-, Steuerzeichen-, Kodier- und Login-Ziele', () => {
    const bad = [
      'https://evil.example', '//evil.example', '/' + BS + 'evil.example', BS + BS + 'evil.example', '/%2F%2Fevil.example', '%2F%2Fevil.example',
      '/%5Cevil.example', 'javascript:alert(1)', '/vorschlaege/1%0Aevil', '/vorschlaege/1\n', '/login', '/login?next=/login', '/registrieren',
      '/vorschlaege/../login', '/vorschlaege/1#x', ' /vorschlaege', '/%E0%A4%A', null, undefined, 42, '/' + 'a'.repeat(400),
    ]
    for (const v of bad) expect(safeReturnTo(v), String(v)).toBe('/')
    expect(BS.length).toBe(1)
  })

  it('Login-Pfad trägt nur gültige Ziele', () => {
    expect(loginPath({ pathname: '/vorschlaege/5', search: '' })).toBe('/login?next=%2Fvorschlaege%2F5')
    expect(loginPath({ pathname: '/', search: '' })).toBe('/login')
    expect(loginPath({ pathname: '//evil.example', search: '' })).toBe('/login')
  })
})
