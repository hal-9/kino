import { Navigate, Route, Routes } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from './api.js'
import BottomNav from './components/BottomNav.jsx'
import Header from './components/Header.jsx'
import Login from './screens/Login.jsx'
import Register from './screens/Register.jsx'
import Programm from './screens/Programm.jsx'

function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.get('/me'), retry: false })
}

function Guard({ children }) {
  const { data: me, isLoading, isError } = useMe()
  if (isLoading) return <main className="center muted">Lädt…</main>
  if (isError || !me) return <Navigate to="/login" replace />
  return (
    <>
      <Header me={me} />
      <main className="shell">{children}</main>
      <BottomNav />
    </>
  )
}

const Soon = ({ m }) => <div className="empty"><h2>Kommt in {m}</h2></div>

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/registrieren" element={<Register />} />
      <Route path="/" element={<Guard><Programm /></Guard>} />
      <Route path="/vorschlaege/*" element={<Guard><Soon m="M2" /></Guard>} />
      <Route path="/besuche/*" element={<Guard><Soon m="M3" /></Guard>} />
      <Route path="/wrapped" element={<Guard><Soon m="M4" /></Guard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
