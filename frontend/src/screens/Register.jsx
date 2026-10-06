import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api, errorText } from '../api.js'
import Logo from '../components/Logo.jsx'

const MESSAGES = {
  'invalid invite code': 'Der Einladungscode stimmt nicht.',
  'name taken': 'Den Namen gibt es schon.',
  'email taken': 'Die E-Mail ist schon registriert.',
  'validation failed': 'Bitte alle Felder prüfen (Passwort mindestens 8 Zeichen).',
}

export default function Register() {
  const [form, setForm] = useState({ name: '', email: '', password: '', invite_code: '' })
  const [error, setError] = useState(null)
  const [pending, setPending] = useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const me = await api.post('/register', form)
      queryClient.setQueryData(['me'], me)
      navigate('/', { replace: true })
    } catch (err) {
      setError(MESSAGES[err.code] || (err.status === 429 ? 'Zu viele Versuche. Bitte später erneut.' : errorText(err)))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="auth">
      <div className="logo"><Logo size={72} /></div>
      <h1 className="brand-title">Mitmachen</h1>
      <p className="sub">Du brauchst den Einladungscode der Kino-Crew.</p>
      <form onSubmit={submit}>
        <input className="field" placeholder="Vorname" value={form.name} onChange={set('name')} autoComplete="given-name" required minLength={2} />
        <input className="field" type="email" placeholder="E-Mail" value={form.email} onChange={set('email')} autoComplete="email" required />
        <input className="field" type="password" placeholder="Passwort (mind. 8 Zeichen)" value={form.password} onChange={set('password')} autoComplete="new-password" required minLength={8} />
        <input className="field" placeholder="Einladungscode" value={form.invite_code} onChange={set('invite_code')} autoComplete="off" required />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary" type="submit" disabled={pending}>{pending ? 'Moment…' : 'Registrieren'}</button>
      </form>
      <p className="foot">Schon dabei? <Link to="/login">Anmelden</Link></p>
    </div>
  )
}
