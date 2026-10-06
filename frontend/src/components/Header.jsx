import { useNavigate } from 'react-router-dom'
import Logo from './Logo.jsx'

export function initial(name) {
  return String(name ?? '?').trim().charAt(0).toUpperCase()
}

export default function Header({ me }) {
  const navigate = useNavigate()
  const members = [me]

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <h1 className="brand"><Logo size={26} /><span>LiLief<em>-Kino</em></span></h1>
          <button className="avatars" onClick={() => navigate('/einstellungen')} aria-label="Einstellungen">
            {members.map((m) => (
              <span key={m.id} className={`avatar${m.id === me.id ? ' me' : ''}`} title={m.name}>
                {initial(m.name)}
              </span>
            ))}
          </button>
        </div>
      </header>
    </>
  )
}
