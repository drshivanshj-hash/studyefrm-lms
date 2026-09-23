/* StudyEFRM shared primitives — ported from the design kit (window globals → ES modules). */
import { kindMeta } from '../lib/constants'

export function Logo({ onClick }) {
  return (
    <div className="brand" onClick={onClick}>
      <img src="/logo-mark.svg" alt="StudyEFRM" />
      <span className="word">Study<span className="b">EFRM</span></span>
    </div>
  )
}

export function Arrow({ w = 18, h = 13 }) {
  return (
    <svg width={w} height={h} viewBox="0 0 20 14" fill="none">
      <path d="M1 7h15m0 0-4-4m4 4-4 4" stroke="currentColor" strokeWidth="1.4"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function RegistryPill() {
  return <span className="pill registry"><span className="dot" style={{ background: 'var(--primary)' }} />Registry Complete</span>
}

export function InProdPill({ children = 'Content In Production' }) {
  return <span className="pill inprod"><span className="dot" style={{ background: 'var(--inprod)' }} />{children}</span>
}

export function KindBadge({ kind, compact = false }) {
  const m = kindMeta[kind]
  if (!m) return null
  return (
    <span className="kbadge" style={{ color: m.ink }} title={m.label}>
      <span className="key" style={{ background: m.color }}>{m.key}</span>
      {!compact && m.label}
    </span>
  )
}

export function GuidelineChip({ g }) {
  if (!g) return <span className="code" style={{ fontSize: 11, color: 'var(--ink-4)' }}>—</span>
  return <span className="chip"><span className="src">{g.src}</span>{g.name}</span>
}

export function CoverageBar({ pct = 0 }) {
  if (pct <= 0) return <div className="track"><div className="hatch" /></div>
  return <div className="track"><div className="fill" style={{ width: pct + '%' }} /></div>
}

/* The signature knowledge trace. 3-layer by default (MRCOG root → ATCRM/EFRM →
   guideline); pass `pact` to light up the EBCOG-PACT 4th card when that mapping
   exists. orientation: 'row' (desktop) | 'col' (stacked). */
export function TraceBlock({ root, pact, line, guideline, orientation = 'row', notes = {} }) {
  const basis = (t) => (t ? <div className="tnote">{t}</div> : null)
  const conn = <div className="tr-conn"><Arrow /></div>
  return (
    <div className={'trace ' + orientation}>
      <div className="tnode root">
        <div className="tlabel">MRCOG Root</div>
        <div className="tname">{root}</div>
        <div className="tsub">Foundation</div>
        {basis(notes.root)}
      </div>
      {conn}
      {pact ? (
        <>
          <div className="tnode pact">
            <div className="tlabel">EBCOG · PACT</div>
            <div className="tname">{pact}</div>
            <div className="tsub">Specialist</div>
            {basis(notes.pact)}
          </div>
          {conn}
        </>
      ) : null}
      <div className="tnode centre">
        <div className="tlabel">ATCRM · EFRM</div>
        <div className="tname">{line.short || line.text}</div>
        <div className="tsub">{line.code}{line.kind ? ' · ' + (kindMeta[line.kind]?.label || '') : ''}</div>
      </div>
      {guideline ? (
        <>
          {conn}
          <div className="tnode auth">
            <div className="tlabel">Guideline</div>
            <div className="tname">{guideline.src + ' ' + guideline.name}</div>
            <div className="tsub">Authority ↗</div>
            {basis(notes.guideline)}
          </div>
        </>
      ) : null}
    </div>
  )
}

export function MiniTrace() {
  return (
    <span className="mini-trace" title="MRCOG → ATCRM → Guideline">
      <span className="d" style={{ background: 'var(--root)' }} />
      <span className="d" style={{ background: 'var(--primary)' }} />
      <span className="d" style={{ background: 'var(--authority)' }} />
    </span>
  )
}

/* Keyboard-accessible click props for non-button clickable surfaces (cards, rows).
   Spread onto a <div>: adds role=button, focusability, and Enter/Space activation. */
export function clickable(onClick) {
  return {
    role: 'button',
    tabIndex: 0,
    onClick,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e) }
    },
  }
}
