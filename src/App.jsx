import { Outlet, Link } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { Logo } from './components/Primitives'
import { useAuth } from './lib/auth'

// App shell (layout) + role-aware topbar (slice 2).
export default function App() {
  const { session, profile, isApproved, isAdmin, signOut } = useAuth()
  const nav = useNavigate()
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
            {isAdmin && <Link className="btn secondary sm" to="/owner">Owner</Link>}
            {isApproved && <Link className="btn secondary sm" to="/app/osce">OSCE cases</Link>}
            <Link className="btn primary sm" to="/app">{isApproved ? 'My curriculum' : 'My access'}</Link>
            <button className="linkbtn" onClick={handleSignOut}>Sign out</button>
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
