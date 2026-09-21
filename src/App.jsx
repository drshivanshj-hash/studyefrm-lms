import { useEffect, useState } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { Logo } from './components/Primitives'
import { useAuth } from './lib/auth'

// App shell (layout) + role-aware topbar (slice 2).
export default function App() {
  const { session, profile, isApproved, isAdmin, signOut } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const [menu, setMenu] = useState(false)
  useEffect(() => { setMenu(false) }, [loc.pathname])
  async function handleSignOut() {
    await signOut()
    nav('/', { replace: true })
  }
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}><Logo /></Link>
        <div className="spacer" />
        {session ? (
          <div className="topbar-auth">
            <span className="who">{profile?.email}</span>
            {isAdmin && <Link className="btn secondary sm tb-wide" to="/owner">Owner</Link>}
            {isApproved && <Link className="btn secondary sm tb-wide" to="/app/osce">OSCE cases</Link>}
            <Link className="btn primary sm" to="/app">{isApproved ? 'My curriculum' : 'My access'}</Link>
            <button className="linkbtn tb-wide" onClick={handleSignOut}>Sign out</button>
            {/* phones: the secondary links fold into one menu so nothing is pushed off-screen */}
            <button className="tb-menu" type="button" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              {menu ? '✕' : '☰'}
            </button>
            {menu && (
              <div className="tb-drop" role="menu">
                <div className="tb-drop-who">{profile?.email}</div>
                {isAdmin && <Link role="menuitem" to="/owner">Owner</Link>}
                {isApproved && <Link role="menuitem" to="/app/osce">OSCE cases</Link>}
                <button role="menuitem" type="button" onClick={handleSignOut}>Sign out</button>
              </div>
            )}
          </div>
        ) : (
          <a className="btn secondary sm" href="/#access">Request access</a>
        )}
      </header>

      <main className="main"><Outlet /></main>

      <footer className="kit-footer">
        <div className="wrap kf-inner">
          <Logo />
          <span className="kf-note">EFRM exam preparation · ESHRE-anchored, MRCOG-rooted</span>
        </div>
      </footer>
    </div>
  )
}
