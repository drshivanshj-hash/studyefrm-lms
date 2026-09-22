import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getLineBundle } from '../lib/api'
import LineModule from './LineModule'

export default function LineView() {
  const { code } = useParams()
  const [line, setLine] = useState(undefined) // undefined=loading, null=not found
  const [module, setModule] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let on = true
    setLine(undefined); setModule(null); setErr(null)
    getLineBundle(code)
      .then(({ line: l, module: m }) => { if (on) { setModule(m); setLine(l) } })
      .catch((e) => on && setErr(e.message))
    return () => { on = false }
  }, [code])

  if (err) return <div className="wrap page-head"><p className="ds-body">Error: {err}</p></div>
  if (line === undefined) return <div className="wrap page-head"><p className="ds-body">Loading…</p></div>
  if (!line) return <div className="wrap page-head"><p className="ds-body">Line not found. <Link to="/app">Back to curriculum</Link></p></div>

  return (
    <div className="wrap fade-up lineview">
      <div className="breadcrumb" style={{ paddingTop: 24 }}>
        <Link to="/app">Curriculum</Link><span className="sep">›</span>
        {line.domain && <><Link to={`/app/domain/${line.domain.number}`}>{line.domain.name}</Link><span className="sep">›</span></>}
        <span className="code" style={{ fontSize: 12 }}>{line.code}</span>
      </div>

      <LineModule line={line} preloaded={module} />
    </div>
  )
}
