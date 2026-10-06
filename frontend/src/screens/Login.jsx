import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api, errorText } from '../api.js'
import Logo from '../components/Logo.jsx'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [pending, setPending] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  async function submit(e) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const me = await api.post('/login', { email, password })
      queryClient.setQueryData(['me'], me)
      navigate('/', { replace: true })
    } catch (err) {
      // Nur 401 heißt falsche Zugangsdaten; Ausfall/429/500 nicht.
      setError(err.status === 401 ? 'E-Mail oder Passwort stimmt nicht.' : err.status === 429 ? 'Zu viele Versuche. Bitte später erneut.' : errorText(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="auth">
      <div className="logo"><Logo size={72} /></div>
      <h1 className="brand-title">LiLief-Kino</h1>
      <p className="sub">Welches Kino zeigt was, wann und in welchem Saal.</p>
      <form onSubmit={submit}>
        <input className="field" type="email" placeholder="E-Mail" value={email} autoComplete="username"
          onChange={(e) => setEmail(e.target.value)} required />
        <input className="field" type="password" placeholder="Passwort" value={password} autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary" type="submit" disabled={pending}>{pending ? 'Moment…' : 'Anmelden'}</button>
      </form>
      <p className="foot">Neu hier? <Link to="/registrieren">Mit Einladungscode registrieren</Link></p>
    </div>
  )
}
