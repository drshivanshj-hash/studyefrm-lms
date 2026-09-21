import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

// Magic-link landing. The supabase client (detectSessionInUrl:true) exchanges the
// link for a session automatically; AuthProvider picks it up via onAuthStateChange.
// We just wait for the session, then route into the gated app.
export default function AuthCallback() {
  const { session, loading } = useAuth()
  const nav = useNavigate()
  const [msg, setMsg] = useState('Signing you in…')

  useEffect(() => {
    if (loading) return
    if (session) {
      nav('/app', { replace: true })
    } else {
      setMsg('That sign-in link has expired or was already used. Request a fresh one from the home page.')
      const t = setTimeout(() => nav('/', { replace: true }), 3200)
      return () => clearTimeout(t)
    }
  }, [session, loading, nav])

  return (
    <div className="wrap authcb">
      <div className="ph"><div className="ph-s">{msg}</div></div>
    </div>
  )
}
