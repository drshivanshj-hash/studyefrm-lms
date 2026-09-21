import { useEffect, useState } from 'react'
import { getOrientationModules, getOsceLmsCases } from '../lib/api'
import StudyEFRMOsceCaseLibrary from '../components/StudyEFRMOsceCaseLibrary'

export default function OsceLibrary() {
  const [cases, setCases] = useState(null)
  const [orientationModules, setOrientationModules] = useState([])
  const [err, setErr] = useState('')
  const [orientationErr, setOrientationErr] = useState('')

  useEffect(() => {
    let on = true
    getOsceLmsCases()
      .then((rows) => on && setCases(rows))
      .catch((e) => on && setErr(e.message))
    getOrientationModules()
      .then((rows) => on && setOrientationModules(rows || []))
      .catch((e) => on && setOrientationErr(e.message))
    return () => { on = false }
  }, [])

  if (err) {
    return (
      <div className="wrap page-head">
        <p className="ds-body">The OSCE library could not load. Check your connection and try again.</p>
        <button className="btn secondary sm" onClick={() => window.location.reload()}>Try again</button>
      </div>
    )
  }

  if (!cases) {
    return <div className="wrap"><div className="ph"><div className="ph-s">Loading OSCE cases…</div></div></div>
  }

  // the component always receives real cases; nothing to show → show nothing
  if (!cases.length) return null

  return <StudyEFRMOsceCaseLibrary
    cases={cases}
    orientationModules={orientationModules}
    notice={orientationErr ? `Orientation module data could not load: ${orientationErr}.` : ''}
  />
}
