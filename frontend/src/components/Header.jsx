import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import Sheet from './Sheet.jsx'
import Logo from './Logo.jsx'

export function initial(name) {
  return String(name ?? '?').trim().charAt(0).toUpperCase()
}

export default function Header({ me }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const members = [me]

  async function logout() {
    await api.post('/logout').catch(() => {})
    queryClient.clear()
    navigate('/login', { replace: true })
  }

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <h1 className="brand"><Logo size={26} /><span>LiLief<em>-Kino</em></span></h1>
          <button className="avatars" onClick={() => setOpen(true)} aria-label="Mitglieder und Abmelden">
            {members.map((m) => (
              <span key={m.id} className={`avatar${m.id === me.id ? ' me' : ''}`} title={m.name}>
                {initial(m.name)}
              </span>
            ))}
          </button>
        </div>
      </header>
      <Sheet open={open} onClose={() => setOpen(false)}>
        <h3>{me.household.name}</h3>
        <p className="sub">{members.map((m) => m.name).join(' · ')}</p>
        <div className="sheet-actions">
          <button className="btn" onClick={() => setOpen(false)}>Schließen</button>
          <button className="btn danger" onClick={logout}>Abmelden</button>
        </div>
      </Sheet>
    </>
  )
}
