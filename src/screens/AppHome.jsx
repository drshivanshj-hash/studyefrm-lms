import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import OwnerConsole from './OwnerConsole'

// Shown to a signed-in but not-yet-approved user (used by RequireApproved on /app).
export function Waitlist() {
  const { profile, signOut } = useAuth()
  return (
    <div className="wrap gate fade-up">
      <div className="eyebrow" style={{ color: 'var(--primary)' }}>Access requested</div>
      <h1 className="gate-h1">You're on the list.</h1>
      <p className="ds-body">
        We've recorded your request as <b>{profile?.email}</b>. The owner approves new accounts manually —
        you'll get the full clinical curriculum (every ATCRM line with its four-layer trace, theory, evidence,
        assessment and an OSCE station) the moment access is granted.
      </p>
      <p className="ds-body">
        Meanwhile the two <Link to="/">orientation modules</Link> and the open-access curriculum map are
        yours to read now.
      </p>
      <div className="gate-actions">
        <Link className="btn primary sm" to="/">Back to the home page</Link>
        <button className="linkbtn" onClick={signOut}>Sign out</button>
      </div>
    </div>
  )
}

export default function AppHome() {
  const { profile, isAdmin, loading } = useAuth()

  if (loading || !profile) {
    return <div className="wrap gate"><div className="ph"><div className="ph-s">Loading your account…</div></div></div>
  }

  if (!isAdmin) {
    return (
      <div className="wrap gate fade-up">
        <div className="eyebrow" style={{ color: 'var(--primary)' }}>Owner workspace</div>
        <h1 className="gate-h1">Admins only.</h1>
        <p className="ds-body">This area is the owner's approval console. Your learning lives in <Link to="/app">your curriculum</Link>.</p>
        <div className="gate-actions"><Link className="btn primary sm" to="/app">Go to my curriculum</Link></div>
      </div>
    )
  }

  return <OwnerConsole />
}
