import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CoverageBar, InProdPill, RegistryPill } from '../components/Primitives'
import {
  approveContentNode,
  getDomainCoverage,
  getOwnerContentQueue,
  getOwnerUsers,
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
  const [content, setContent] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  async function load() {
    setError('')
    setLoading(true)
    try {
      const [u, c, q] = await Promise.all([getOwnerUsers(), getDomainCoverage(), getOwnerContentQueue()])
      setUsers(u)
      setCoverage(c)
      setContent(q)
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
    pending: acc.pending + Number(d.pending || 0),
  }), { lines: 0, guidelines: 0, approved: 0, pending: 0 }), [coverage])

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

  async function approveNode(node) {
    setBusy(node.id)
    setError('')
    try {
      await approveContentNode(node.id, profile?.email || 'owner')
      await load()
    } catch (err) {
      setError(err.message || 'Content approval failed.')
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
        <div className="card owner-stat"><span className="os-num">{content.length}</span><span>pending content nodes</span></div>
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
        <div className="list-head"><span>Content approval</span><span className="list-count">{content.length} pending / needs edit</span></div>
        <div className="card owner-card">
          {content.length === 0 ? (
            <div className="owner-empty">No pending content nodes.</div>
          ) : content.map((node) => (
            <div className="owner-row content" key={node.id}>
              <div>
                <div className="owner-title">{node.title}</div>
                <div className="owner-meta">
                  <span className="code">{node.slug}</span> · {node.node_type}
                  {node.syllabus_lines?.code ? ` · ${node.syllabus_lines.code}` : ''}
                  {node.domains?.number ? ` · D${node.domains.number}` : ''}
                </div>
              </div>
              <StatusPill status={node.status} />
              <button className="btn primary sm" disabled={busy === node.id} onClick={() => approveNode(node)}>
                {busy === node.id ? 'Approving…' : 'Approve'}
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
                <th>Vantage</th><th>Approved</th><th>Pending</th><th className="r">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {coverage.map((d) => (
                <tr key={d.domain_number}>
                  <td className="l dom"><span className="did">D{d.domain_number}</span>{d.domain_name}</td>
                  <td>{d.lines}</td><td>{d.guidelines}</td><td>{d.deconstructions}</td>
                  <td>{d.vantage}</td><td>{d.approved}</td><td>{d.pending}</td>
                  <td className="r"><div className="mini-cov"><CoverageBar pct={Number(d.coverage_pct || 0)} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="owner-table-foot">
            <RegistryPill />
            <InProdPill>{totals.pending > 0 ? `${totals.pending} pending` : 'Content In Production'}</InProdPill>
          </div>
        </div>
      </section>
    </div>
  )
}
