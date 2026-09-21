import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getLineByCode } from '../lib/api'
import { KindBadge, TraceBlock } from '../components/Primitives'
import LineModule from './LineModule'

export default function LineView() {
  const { code } = useParams()
  const [line, setLine] = useState(undefined) // undefined=loading, null=not found
  const [err, setErr] = useState(null)

  useEffect(() => {
    let on = true
    setLine(undefined); setErr(null)
    getLineByCode(code).then((l) => on && setLine(l)).catch((e) => on && setErr(e.message))
    return () => { on = false }
  }, [code])

  if (err) return <div className="wrap page-head"><p className="ds-body">Error: {err}</p></div>
  if (line === undefined) return <div className="wrap page-head"><p className="ds-body">Loading…</p></div>
  if (!line) return <div className="wrap page-head"><p className="ds-body">Line not found. <Link to="/app">Back to curriculum</Link></p></div>

  const anchors = line.anchors || []
  // the trace's "Guideline" node shows the ESHRE anchor first (ESHRE/EFRM exam); the caption lists them all
  const anchor = anchors.find((a) => /ESHRE/i.test(a.body || '')) || anchors[0]
  const pactRow = (line.frameworks || []).find((f) => f.framework_nodes?.curriculum_frameworks?.code === 'EBCOG.PACT')
  const pact = pactRow ? (pactRow.framework_nodes.title || pactRow.framework_nodes.code) : null

  return (
    <div className="wrap fade-up lineview">
      <div className="breadcrumb" style={{ paddingTop: 24 }}>
        <Link to="/app">Curriculum</Link><span className="sep">›</span>
        {line.domain && <><Link to={`/app/domain/${line.domain.number}`}>{line.domain.name}</Link><span className="sep">›</span></>}
        <span className="code" style={{ fontSize: 12 }}>{line.code}</span>
      </div>

      <div className="lv-head">
        <div className="lv-codeline">
          <span className="code lv-code">{line.code}</span>
          <KindBadge kind={line.competency_kind} />
        </div>
        <h1 className="lv-text">{line.line_text}</h1>
      </div>

      <div className="lv-section">
        <div className="eyebrow lv-eyebrow">Knowledge trace</div>
        <TraceBlock
          root={line.root?.name || 'MRCOG foundation'}
          pact={pact}
          line={{ code: line.code, kind: line.competency_kind, text: line.line_text }}
          guideline={anchor ? { src: anchor.body, name: anchor.name } : null}
          orientation="row"
        />
        <p className="lv-trace-cap">
          This competency roots into the MRCOG knowledge area <b>{line.root?.name || '—'}</b>, sits at
          subspecialty level as <span className="code">{line.code}</span>
          {pact ? <>, mapped to the EBCOG PACT competency <b>{pact}</b></> : null}
          {anchors.length
            ? <>, and governed by {anchors.map((a, i) => <span key={a.code}>{i > 0 ? '; ' : ''}<b>{a.body} {a.name}</b>{a.url && <> (<a href={a.url} target="_blank" rel="noreferrer">source ↗</a>)</>}</span>)}.</>
            : <>.</>}
        </p>
      </div>

      <div className="lv-section">
        <div className="eyebrow lv-eyebrow">Module</div>
        <LineModule line={line} />
      </div>
    </div>
  )
}
