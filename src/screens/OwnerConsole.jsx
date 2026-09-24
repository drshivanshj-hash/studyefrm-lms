import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CoverageBar, InProdPill, RegistryPill } from '../components/Primitives'
import {
  getDomainCoverage,
  getOwnerUsers,
  getOwnerFlags,
  resolveFlag,
  updateUserStatus,
} from '../lib/api'
import { useAuth } from '../lib/auth'

function fmtDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function StatusPill({ status }) {
  const cls = status === 'approved' ? 'ok' : status === 'pending' ? 'pending' : 'inprod'
  return <span className={`pill ${cls}`}>{status}</span>
}

export default function OwnerConsole() {
  const { profile, signOut } = useAuth()
  const [users, setUsers] = useState([])
  const [coverage, setCoverage] = useState([])
  const [flags, setFlags] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  async function load() {
    setError('')
    setLoading(true)
    try {
      const [u, c] = await Promise.all([getOwnerUsers(), getDomainCoverage()])
      setUsers(u)
      setCoverage(c)
      // flags load separately: a failure here must not blank the rest of the console
      getOwnerFlags().then(setFlags).catch(() => setFlags([]))
    } catch (err) {
      setError(err.message || 'Owner console failed to load.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const pendingUsers = users.filter((u) => u.status === 'pending')
  const totals = useMemo(() => coverage.reduce((acc, d) => ({
    lines: acc.lines + Number(d.lines || 0),
    guidelines: acc.guidelines + Number(d.guidelines || 0),
    approved: acc.approved + Number(d.approved || 0),
  }), { lines: 0, guidelines: 0, approved: 0 }), [coverage])

  const emailById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u.email])), [users])
  const SECTION_NAME = { theory: 'Theory', evidence: 'Evidence & Vantage', part1: 'Q-bank · Part 1', osce: 'OSCE', appraisal: 'Appraisal' }

  async function resolve(flag) {
    if (!window.confirm('Resolve this flag? It will be removed from the inbox and from the candidate’s list.')) return
    setBusy(flag.id)
    const ok = await resolveFlag(flag.id)
    setBusy(null)
    if (ok) setFlags((f) => f.filter((x) => x.id !== flag.id))
    else setError('Could not resolve that flag.')
  }

  async function approveUser(user) {
    setBusy(user.id)
    setError('')
    try {
      const updated = await updateUserStatus(user.id, 'approved')
      setUsers((rows) => rows.map((r) => (r.id === user.id ? { ...r, ...updated } : r)))
    } catch (err) {
      setError(err.message || 'User approval failed.')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return <div className="wrap gate"><div className="ph"><div className="ph-s">Loading owner console…</div></div></div>
  }

  return (
    <div className="wrap owner fade-up">
      <div className="page-head owner-head">
        <div>
          <div className="eyebrow" style={{ color: 'var(--primary)' }}>Owner workspace</div>
          <h1 className="page-h1">Approval queue & production tracker</h1>
          <p className="page-lede">Signed in as <b>{profile?.email}</b>. All counts below come from live Supabase.</p>
        </div>
        <div className="owner-actions">
          <Link className="btn secondary sm" to="/app">Curriculum</Link>
          <button className="btn secondary sm" onClick={load}>Refresh</button>
          <button className="linkbtn" onClick={signOut}>Sign out</button>
        </div>
      </div>

      {error && <div className="owner-error">{error}</div>}

      <section className="owner-stats">
        <div className="card owner-stat"><span className="os-num">{pendingUsers.length}</span><span>pending users</span></div>
        <div className="card owner-stat"><span className="os-num">{flags.length}</span><span>open flags</span></div>
        <div className="card owner-stat"><span className="os-num">{totals.approved}</span><span>approved nodes</span></div>
        <div className="card owner-stat"><span className="os-num">{totals.lines}</span><span>registry lines</span></div>
      </section>

      <section className="owner-section">
        <div className="list-head"><span>User approval</span><span className="list-count">{pendingUsers.length} pending</span></div>
        <div className="card owner-card">
          {pendingUsers.length === 0 ? (
            <div className="owner-empty">No pending access requests.</div>
          ) : pendingUsers.map((u) => (
            <div className="owner-row" key={u.id}>
              <div>
                <div className="owner-title">{u.email}</div>
                <div className="owner-meta">Requested {fmtDate(u.created_at)} · role {u.role}</div>
              </div>
              <StatusPill status={u.status} />
              <button className="btn primary sm" disabled={busy === u.id} onClick={() => approveUser(u)}>
                {busy === u.id ? 'Approving…' : 'Approve'}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="owner-section">
        <div className="list-head"><span>Flagged for review</span><span className="list-count">{flags.length} open</span></div>
        <div className="card owner-card">
          {flags.length === 0 ? (
            <div className="owner-empty">No open flags from candidates.</div>
          ) : flags.map((f) => (
            <div className="owner-row flag" key={f.id}>
              <div>
                <div className="owner-title">{f.body}</div>
                <div className="owner-meta">
                  {emailById[f.user_id] || 'candidate'} · {f.line?.code ? <Link to={`/app/line/${f.line.code}`}>{f.line.code}</Link> : 'line'}
                  {' · '}{SECTION_NAME[f.section] || f.section} · {fmtDate(f.created_at)}
                </div>
              </div>
              <button className="btn secondary sm" disabled={busy === f.id} onClick={() => resolve(f)}>
                {busy === f.id ? 'Resolving…' : 'Resolve'}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="owner-section">
        <div className="list-head"><span>Production tracker</span><span className="list-count">live domain_coverage</span></div>
        <div className="card admin-card">
          <table className="prodtable">
            <thead>
              <tr>
                <th className="l">Domain</th><th>Lines</th><th>Guidelines</th><th>Deconstructed</th>
                <th>Vantage</th><th>Approved</th><th className="r">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {coverage.map((d) => (
                <tr key={d.domain_number}>
                  <td className="l dom"><span className="did">D{d.domain_number}</span>{d.domain_name}</td>
                  <td>{d.lines}</td><td>{d.guidelines}</td><td>{d.deconstructions}</td>
                  <td>{d.vantage}</td><td>{d.approved}</td>
                  <td className="r"><div className="mini-cov"><CoverageBar pct={Number(d.coverage_pct || 0)} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="owner-table-foot">
            <RegistryPill />
            <InProdPill>Content In Production</InProdPill>
          </div>
        </div>
      </section>
    </div>
  )
}
