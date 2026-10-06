import { NavLink } from 'react-router-dom'

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }

const TABS = [
  {
    to: '/', label: 'Programm',
    icon: <svg viewBox="0 0 24 24" {...stroke}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M8 5v4M16 5v4" /></svg>,
  },
  {
    to: '/vorschlaege', label: 'Vorschläge',
    icon: <svg viewBox="0 0 24 24" {...stroke}><path d="M9 12l2 2 4-4" /><rect x="4" y="4" width="16" height="16" rx="3" /></svg>,
  },
  {
    to: '/besuche', label: 'Besuche',
    icon: <svg viewBox="0 0 24 24" {...stroke}><path d="M3 9a2 2 0 0 0 0 6v3h18v-3a2 2 0 0 0 0-6V6H3z" /><path d="M13 6v12" strokeDasharray="2 2" /></svg>,
  },
  {
    to: '/wrapped', label: 'Wrapped',
    icon: <svg viewBox="0 0 24 24" {...stroke}><path d="M12 3l2.2 5.3 5.8.5-4.4 3.8 1.4 5.6L12 15l-5 3.2 1.4-5.6L4 8.8l5.8-.5z" /></svg>,
  },
]

export default function BottomNav() {
  return (
    <nav className="nav" aria-label="Hauptnavigation">
      <div className="nav-inner">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            {t.icon}
            <span>{t.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
