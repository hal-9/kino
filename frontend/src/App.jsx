import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, errorText } from './api.js'
import BottomNav from './components/BottomNav.jsx'
import Header from './components/Header.jsx'
import Login from './screens/Login.jsx'
import Register from './screens/Register.jsx'
import Programm from './screens/Programm.jsx'
import Vorschlaege from './screens/Vorschlaege.jsx'
import Besuche from './screens/Besuche.jsx'
import Wrapped from './screens/Wrapped.jsx'
import Einstellungen from './screens/Einstellungen.jsx'
import Planen from './screens/Planen.jsx'
import { loginPath } from './lib/returnTo.js'
import { claimOfflineData, useOnline } from './lib/offline.js'

function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), retry: false })
}

function Guard({ children }) {
  const { data: me, isLoading, error, refetch } = useMe()
  const location = useLocation()
  const online = useOnline()
  useEffect(() => { if (me) claimOfflineData(me.id) }, [me?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const banner = !online && (
    <p className="stale" role="status">Offline: nur Lesen. Abstimmen, Vorschlagen und Buchen werden nicht gespeichert und nicht später automatisch gesendet.</p>
  )
  if (isLoading) return <main className="center muted">Lädt…</main>
  // Nur ein echtes 401 von /me meldet ab; Ausfall/429/500 lässt die Sitzung in Ruhe.
  // Ziel merken (nur geprüfte interne Route), damit ein geteilter Link nach dem Login wieder öffnet.
  if (error?.status === 401 || (!error && !me)) return <Navigate to={loginPath(location)} replace />
  // K23: ohne Verbindung (status 0) bleibt das Programm (Offline-Kopie) lesbar; private Seiten haben keine Kopie.
  if (error?.status === 0 && !me && location.pathname === '/') {
    return (
      <>
        <main className="shell">{banner || <p className="stale" role="status">Keine Verbindung zum Server.</p>}{children}</main>
        <BottomNav />
      </>
    )
  }
  if (error && !me) {
    return (
      <main className="center" role="alert">
        <p>{errorText(error)}</p>
        <button className="btn" onClick={() => refetch()}>Erneut versuchen</button>
        {error.status === 0 && <Link className="link-btn" to="/">Programm (Offline-Kopie) ansehen</Link>}
      </main>
    )
  }
  return (
    <>
      <Header me={me} />
      <main className="shell">{banner}{children}</main>
      <BottomNav />
    </>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/registrieren" element={<Register />} />
      <Route path="/" element={<Guard><Programm /></Guard>} />
      <Route path="/vorschlaege" element={<Guard><Vorschlaege /></Guard>} />
      <Route path="/vorschlaege/:id" element={<Guard><Vorschlaege /></Guard>} />
      <Route path="/einstellungen" element={<Guard><Einstellungen /></Guard>} />
      <Route path="/besuche" element={<Guard><Besuche /></Guard>} />
      <Route path="/besuche/:id" element={<Guard><Besuche /></Guard>} />
      <Route path="/wrapped" element={<Guard><Wrapped /></Guard>} />
      <Route path="/planen" element={<Guard><Planen /></Guard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
