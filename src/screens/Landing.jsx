import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { getOrientationModules, getCurriculumOverview, ecmec } from '../lib/api'
import { TraceBlock } from '../components/Primitives'
import SignInForm from '../components/SignInForm'

// Static illustration for the hero trace (no gated data — public-safe).
const SAMPLE = {
  code: 'ATCRM.1.22', kind: 'skill',
  short: 'PCOS — diagnostic work-up',
  text: 'Diagnostic work-up and management of PCOS',
  g: { src: 'ESHRE', name: 'PCOS' },
}

export default function Landing() {
  const nav = useNavigate()
  const [mods, setMods] = useState(null)
  const [modErr, setModErr] = useState(null)
  const [cur, setCur] = useState(null)
  const [curErr, setCurErr] = useState(null)
  const { session, profile } = useAuth()

  useEffect(() => {
    // The RPC also returns 'career' reference modules (reachable at /m/:slug);
    // the landing block is the two orientation modules only.
    getOrientationModules()
      .then((list) => setMods((list || []).filter((m) => m.module_kind === 'orientation')))
      .catch((e) => setModErr(e.message))
    getCurriculumOverview().then(setCur).catch((e) => setCurErr(e.message))
  }, [])

  return (
    <div className="fade-up">
      {session && (
        <div className="signedin-bar">
          <div className="sb-inner">
            <span>Signed in as <b>{profile?.email}</b>{profile && profile.status !== 'approved' ? ' · access pending approval' : ''}.</span>
            <span className="sb-spacer" />
            <Link to="/app">{profile?.status === 'approved' ? 'Open your curriculum →' : 'View your access →'}</Link>
          </div>
        </div>
      )}
      <section className="hero">
        <div className="wrap hero-inner">
          <div className="hero-copy">
            <div className="eyebrow" style={{ color: 'var(--primary)' }}>European Fellowship in Reproductive Medicine</div>
            <h1 className="hero-h1">The EFRM syllabus, fully mapped — and traced to its roots.</h1>
            <p className="hero-sub">
              Every competency shows where it sits in basic O&amp;G (MRCOG), how the European
              specialist curriculum frames it (EBCOG PACT), what it becomes at subspecialty level
              (ATCRM), and which ESHRE / NICE / ASRM guideline is the authority.
            </p>
            <SignInForm />
          </div>

          <aside className="hero-trace card">
            <div className="eyebrow" style={{ marginBottom: 14 }}>The four-layer trace</div>
            <TraceBlock orientation="col" root="Gynaecological problems" pact="Core Reproductive Medicine: indication/treatment" line={SAMPLE} guideline={SAMPLE.g} />
            <div className="hero-trace-cap">No competitor shows you this. It is the whole idea.</div>
          </aside>
        </div>
      </section>

      <section className="wrap" style={{ paddingTop: 8 }}>
        <div className="bp-head">
          <div>
            <div className="eyebrow">Start here · open access</div>
            <h2 className="bp-title">Two orientation modules</h2>
          </div>
        </div>

        {!mods && !modErr && <div className="ph"><div className="ph-s">Loading modules…</div></div>}
        {modErr && <div className="ph"><div className="ph-s">Couldn’t load modules: {modErr}</div></div>}

        <div className="mod-grid">
          {(mods || []).map((m) => (
            <article key={m.slug} className="card mod-card">
              <div className="eyebrow">Orientation</div>
              <h3 className="mod-title">{m.title}</h3>
              <div className="mod-meta code">~{m.estimated_minutes} min · {ecmec(m.estimated_minutes)} ECMEC</div>
              {Array.isArray(m.educational_outcomes) && (
                <ul className="mod-outcomes">
                  {m.educational_outcomes.slice(0, 3).map((o, i) => <li key={i}>{o}</li>)}
                </ul>
              )}
              <button className="btn primary sm" onClick={() => nav(`/m/${m.slug}`)}>Read module →</button>
            </article>
          ))}
        </div>

      </section>

      <section className="wrap cur-sec">
        <div className="bp-head">
          <div>
            <div className="eyebrow">The curriculum map · open access</div>
            <h2 className="bp-title">The whole EFRM syllabus, before you commit</h2>
          </div>
        </div>

        {!cur && !curErr && <div className="ph"><div className="ph-s">Loading the curriculum…</div></div>}
        {curErr && <div className="ph"><div className="ph-s">The curriculum map could not load. Please try again shortly.</div></div>}

        {cur && (
          <>
            <div className="cur-totals">
              <div><b>{cur.totals.domains}</b><span>domains</span></div>
              <div><b>{cur.totals.lines}</b><span>syllabus lines</span></div>
              <div><b>{cur.totals.knowledge_areas}</b><span>MRCOG roots</span></div>
              <div><b>{cur.totals.guideline_anchors}</b><span>guideline anchors</span></div>
            </div>
            <div className="cur-grid">
              {cur.domains.map((d) => (
                <article key={d.number} className="card cur-card">
                  <div className="cur-card-head">
                    <span className="cur-num">{d.number}</span>
                    <h3 className="cur-name">{d.name}</h3>
                  </div>
                  <div className="cur-meta code">{d.line_count} lines</div>
                  {d.guidelines.length > 0 && (
                    <div className="cur-chips">
                      {d.guidelines.slice(0, 3).map((g) => <span key={g} className="cur-chip code">{g}</span>)}
                    </div>
                  )}
                </article>
              ))}
            </div>
            <div className="bp-foot">
              Every line opens to its four-layer trace — MRCOG root → EBCOG&nbsp;PACT → ATCRM/EFRM → guideline —
              with theory, evidence, assessment and an OSCE station. Request access to go inside.
            </div>
          </>
        )}
      </section>
    </div>
  )
}
