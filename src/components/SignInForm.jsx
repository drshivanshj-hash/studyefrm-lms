import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// Email → one-time code → signed in.
//
// A code is typed wherever the candidate already is, so it works in every
// browser, in an installed home-screen app and in the iOS Simulator. A magic
// link does not: phone mail apps open links in their own in-app browser, which
// signs the candidate in *there* and leaves their real browser signed out.
// The same email still carries the link, which keeps working as a fallback.
const RESEND_AFTER_S = 60 // Supabase refuses a second email to the same address inside 60 s

export default function SignInForm() {
  const nav = useNavigate()
  const [step, setStep] = useState('email') // 'email' | 'code'
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [wait, setWait] = useState(0)
  const codeRef = useRef(null)

  useEffect(() => {
    if (!wait) return undefined
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  useEffect(() => { if (step === 'code') codeRef.current?.focus() }, [step])

  async function sendCode(e) {
    e?.preventDefault()
    setErr(null)
    setBusy(true)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    setBusy(false)
    if (error) { setErr(friendly(error)); return }
    setCode('')
    setStep('code')
    setWait(RESEND_AFTER_S)
  }

  async function verify(e) {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
    setBusy(false)
    if (error) { setErr('That code didn’t work. Check it and try again, or send a new one.'); return }
    nav('/app', { replace: true })
  }

  if (step === 'code') {
    return (
      <div id="access">
        <form className="magic" onSubmit={verify}>
          <input
            ref={codeRef}
            className="otp-input"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={10}
            placeholder="Code from the email"
            aria-label="Sign-in code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            required
          />
          <button className="btn primary" type="submit" disabled={busy || code.length < 6}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <div className="magic-hint">
          We emailed a code to <b>{email.trim()}</b>. The email also has a sign-in link, if you prefer.
        </div>
        <div className="otp-actions">
          <button className="linkbtn" type="button" onClick={() => sendCode()} disabled={busy || wait > 0}>
            {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
          </button>
          <span className="sep">·</span>
          <button className="linkbtn" type="button" onClick={() => { setStep('email'); setErr(null) }}>
            Use a different email
          </button>
        </div>
        {err && <div className="magic-hint otp-err" role="alert">{err}</div>}
      </div>
    )
  }

  return (
    <div id="access">
      <form className="magic" onSubmit={sendCode}>
        <input type="email" required placeholder="you@hospital.org" autoComplete="email"
          aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Email me a sign-in code'}
        </button>
      </form>
      <div className="magic-hint">We email a one-time code. <b>No passwords anywhere.</b></div>
      {err && <div className="magic-hint otp-err" role="alert">{err}</div>}
    </div>
  )
}

function friendly(error) {
  const m = String(error?.message || '')
  if (/rate|too many|seconds/i.test(m)) return 'Please wait a minute before asking for another code.'
  if (/invalid.*email|email.*invalid/i.test(m)) return 'That email address doesn’t look right.'
  return 'We couldn’t send the code just now. Please try again in a moment.'
}
