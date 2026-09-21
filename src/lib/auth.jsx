import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from './supabase'

// ── Auth + role/status context ──────────────────────────────────────────────
// Magic-link only (no passwords). On first sign-in we create the user's own row
// as { role:'student', status:'pending' } — the users_self_insert RLS policy pins
// those values, so a student cannot self-elevate. The owner is a row with
// role='admin' (set directly in the DB); there is NO in-app role toggle — the
// magic link IS the role.
const AuthCtx = createContext(null)

function profileCacheKey(userId) {
  return `studyefrm:profile:${userId}`
}

function readProfileCache(userId) {
  try {
    const raw = window.sessionStorage.getItem(profileCacheKey(userId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeProfileCache(userId, profile) {
  try {
    if (profile) window.sessionStorage.setItem(profileCacheKey(userId), JSON.stringify(profile))
  } catch {
    // profile cache is only a UI resilience layer
  }
}

function withTimeout(promise, ms = 8000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => window.setTimeout(() => reject(new Error('Profile timed out')), ms)),
  ])
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null) // the users row
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (sess) => {
    if (!sess?.user) { setProfile(null); return }
    const cached = readProfileCache(sess.user.id)
    if (cached) setProfile(cached)
    // public.users row is created server-side by the on_auth_user_created trigger
    // (db/07); the client only reads it.
    try {
      const { data } = await withTimeout(supabase.from('users').select('*').eq('id', sess.user.id).maybeSingle())
      if (data) {
        writeProfileCache(sess.user.id, data)
        setProfile(data)
      } else if (!cached) {
        setProfile(null)
      }
    } catch {
      if (!cached) setProfile(null)
    }
  }, [])

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      await loadProfile(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, sess) => {
      if (!active) return
      setSession(sess)
      await loadProfile(sess)
      setLoading(false)
    })
    return () => { active = false; sub.subscription.unsubscribe() }
  }, [loadProfile])

  const signOut = useCallback(async () => {
    setLoading(true)
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
    setLoading(false)
  }, [])

  const value = {
    session,
    profile,
    loading,
    isApproved: profile?.status === 'approved',
    isAdmin: profile?.role === 'admin',
    signOut,
    reloadProfile: () => loadProfile(session),
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
