// PDF reader — continuous scroll, thumbnails, find, highlighting.
//
// Reads like Adobe / PDF Expert: every page is stacked in one scrolling column.
// Pages size themselves immediately (so the scrollbar is honest), then paint
// only as they approach the viewport and release their bitmap once they fall
// well behind — a 300-page document costs about the same as a 4-page one.
// Built on PDF.js (Apache-2.0).
//
// IMPORTANT: only render documents you own or have licensed. Hosting third-party
// journal PDFs is a copyright exposure and an explicit EACCME review criterion.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import '../styles/pdf.css'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]

/* ── one page ── */
function Page({ doc, num, scale, highlights, onSelect, observe, active }) {
  const hostRef = useRef(null)
  const canvasRef = useRef(null)
  const textRef = useRef(null)
  const [dims, setDims] = useState(null)
  const [painted, setPainted] = useState(false)
  const task = useRef(null)
  const run = useRef(0)

  // measure first, so total scroll height is right before anything paints
  useEffect(() => {
    let ok = true
    doc.getPage(num).then((p) => {
      const v = p.getViewport({ scale })
      if (ok) { setDims({ w: Math.floor(v.width), h: Math.floor(v.height) }); setPainted(false) }
    }).catch(() => {})
    return () => { ok = false }
  }, [doc, num, scale])

  useEffect(() => {
    if (!hostRef.current) return undefined
    return observe(hostRef.current, num)
  }, [observe, num])

  useEffect(() => {
    if (!dims) return undefined
    if (!active) {
      const c = canvasRef.current
      if (c && painted) { c.width = 0; c.height = 0; textRef.current?.replaceChildren(); setPainted(false) }
      return undefined
    }
    if (painted) return undefined
    const mine = ++run.current
    ;(async () => {
      try {
        const page = await doc.getPage(num)
        if (mine !== run.current) return
        const v = page.getViewport({ scale })
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const c = canvasRef.current
        if (!c) return
        c.width = Math.floor(v.width * dpr); c.height = Math.floor(v.height * dpr)
        c.style.width = `${Math.floor(v.width)}px`; c.style.height = `${Math.floor(v.height)}px`
        const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        task.current?.cancel()
        task.current = page.render({ canvasContext: ctx, viewport: v })
        await task.current.promise
        if (mine !== run.current) return

        // TextLayer measures via layout, so its container must be attached.
        // Render into an own child, then drop any sibling a superseded pass left.
        const host = textRef.current
        host.style.width = `${Math.floor(v.width)}px`
        host.style.height = `${Math.floor(v.height)}px`
        const layer = document.createElement('div')
        layer.className = 'pdf-text-inner'
        host.appendChild(layer)
        const tl = new pdfjs.TextLayer({
          textContentSource: await page.getTextContent(), container: layer, viewport: v,
        })
        await tl.render()
        if (mine !== run.current) { layer.remove(); return }
        ;[...host.children].forEach((ch) => { if (ch !== layer) ch.remove() })
        setPainted(true)
      } catch (e) {
        if (e?.name !== 'RenderingCancelledException') { /* leave placeholder */ }
      }
    })()
    return undefined
  }, [active, dims, doc, num, scale, painted])

  const mine = useMemo(
    () => highlights.filter((h) => h.anchor?.page === num && Array.isArray(h.anchor?.rects)),
    [highlights, num]
  )

  return (
    <div className="pdf-pg" ref={hostRef} data-page={num}
      style={dims ? { width: dims.w, height: dims.h } : { width: 480, height: 640 }}
      onMouseUp={() => onSelect(num, textRef.current)}>
      <canvas ref={canvasRef} />
      <div className="pdf-text" ref={textRef} />
      <div className="pdf-marks" aria-hidden="true">
        {mine.map((h) => h.anchor.rects.map((r, i) => (
          <span key={`${h.id}-${i}`} className="pdf-mark" title={h.body}
            style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />
        )))}
      </div>
      {!painted ? <div className="pdf-pg-ph">{num}</div> : null}
    </div>
  )
}

/* ── thumbnail ── */
function Thumb({ doc, num, current, onGo }) {
  const ref = useRef(null)
  useEffect(() => {
    let ok = true
    doc.getPage(num).then(async (p) => {
      const v0 = p.getViewport({ scale: 1 })
      const v = p.getViewport({ scale: 112 / v0.width })
      const c = ref.current
      if (!c || !ok) return
      c.width = v.width; c.height = v.height
      await p.render({ canvasContext: c.getContext('2d'), viewport: v }).promise
    }).catch(() => {})
    return () => { ok = false }
  }, [doc, num])
  return (
    <button className={'pdf-th' + (current ? ' on' : '')} onClick={() => onGo(num)} aria-label={`Page ${num}`}>
      <canvas ref={ref} /><span>{num}</span>
    </button>
  )
}

export default function PdfReader({
  url, title, highlights = [], onAddHighlight, onDeleteHighlight, onPageViewed,
}) {
  const [doc, setDoc] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [scale, setScale] = useState(null)
  const [fit, setFit] = useState('width')
  const [outline, setOutline] = useState([])
  const [rail, setRail] = useState(null)
  const [err, setErr] = useState(null)
  const [sel, setSel] = useState(null)
  const [near, setNear] = useState(() => new Set([1, 2]))
  const [q, setQ] = useState('')
  const [hits, setHits] = useState(null)
  const [finding, setFinding] = useState(false)
  const [boxW, setBoxW] = useState(0)
  const [boxH, setBoxH] = useState(0)
  const [full, setFull] = useState(false)
  // false on iPhone Safari (only video can go full screen there); true on iPad, Android, desktop
  const canFull = typeof document !== 'undefined' && !!document.fullscreenEnabled

  const rootRef = useRef(null)
  const scrollRef = useRef(null)
  const io = useRef(null)
  const baseW = useRef(612)
  const baseH = useRef(792)

  useEffect(() => {
    let dead = false
    setDoc(null); setErr(null); setOutline([]); setPage(1); setNear(new Set([1, 2])); setHits(null)
    if (!url) return undefined
    const t = pdfjs.getDocument({ url, isEvalSupported: false })
    t.promise.then(async (d) => {
      if (dead) return
      try {
        const v0 = (await d.getPage(1)).getViewport({ scale: 1 })
        baseW.current = v0.width; baseH.current = v0.height
      } catch { /* default */ }
      if (dead) return
      setDoc(d); setTotal(d.numPages)
      try { const o = await d.getOutline(); if (!dead && o?.length) setOutline(o) } catch { /* optional */ }
    }).catch((e) => { if (!dead) setErr(e?.message || 'Could not open this document') })
    return () => { dead = true; t.destroy?.() }
  }, [url])

  // Container width is tracked as STATE rather than read inside a one-shot
  // effect: the previous version computed fit-to-width once and never again,
  // so resizing the window (or opening a rail) left the page overflowing its
  // column. Both a ResizeObserver and a window listener feed it, because the
  // observer alone missed resizes that did not change the observed box.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return undefined
    const read = () => { setBoxW(el.clientWidth); setBoxH(el.clientHeight) }
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    window.addEventListener('resize', read)
    return () => { ro.disconnect(); window.removeEventListener('resize', read) }
  }, [doc, rail])

  // fit is derived, so it can never go stale
  useEffect(() => {
    if (!doc) return
    if (fit === 'width' && boxW) setScale(Math.max(0.3, (boxW - 44) / baseW.current))
    if (fit === 'page' && boxW && boxH) {
      setScale(Math.max(0.3, Math.min((boxW - 44) / baseW.current, (boxH - 36) / baseH.current)))
    }
  }, [fit, boxW, boxH, doc])

  // Fullscreen keeps the clinician inside StudyEFRM: the document fills the
  // screen in place, instead of being handed to the browser's own PDF viewer.
  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === rootRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  async function toggleFull() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await rootRef.current?.requestFullscreen()
    } catch { /* browser refused — the inline reader still works */ }
  }

  // Created on first use, NOT in an effect: React runs child effects before the
  // parent's, so every Page called observe() while the observer was still null
  // and nothing was ever watched — the reader painted page 1 and then stopped
  // responding to scroll.
  const ensureIO = useCallback(() => {
    if (io.current) return io.current
    io.current = new IntersectionObserver((entries) => {
      setNear((prev) => {
        const next = new Set(prev)
        entries.forEach((e) => { e.isIntersecting ? next.add(e.target.__page) : next.delete(e.target.__page) })
        return next
      })
      const best = entries.filter((e) => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
      if (best) setPage(best.target.__page)
    }, { root: scrollRef.current, rootMargin: '700px 0px', threshold: [0, 0.3, 0.7] })
    return io.current
  }, [])

  const observe = useCallback((node, num) => {
    node.__page = num
    const obs = ensureIO()
    obs.observe(node)
    return () => obs.unobserve(node)
  }, [ensureIO])

  // a new document needs a fresh observer bound to the fresh page nodes
  useEffect(() => () => { io.current?.disconnect(); io.current = null }, [url])

  useEffect(() => { if (doc && total) onPageViewed?.(page - 1, total) }, [doc, page, total]) // eslint-disable-line react-hooks/exhaustive-deps

  function goto(n) {
    const t = Math.min(Math.max(1, n), total || 1)
    scrollRef.current?.querySelector(`[data-page="${t}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    setPage(t)
  }

  async function gotoDest(dest) {
    if (!doc || !dest) return
    try {
      const d = typeof dest === 'string' ? await doc.getDestination(dest) : dest
      goto((await doc.getPageIndex(d[0])) + 1)
    } catch { /* broken outline entry */ }
  }

  function zoomBy(dir) {
    setFit(null)
    const cur = scale || 1
    setFit('custom')
    if (dir > 0) {
      const nxt = ZOOM_STEPS.find((z) => z > cur + 0.001)
      setScale(nxt ?? ZOOM_STEPS[ZOOM_STEPS.length - 1])
    } else {
      const lower = [...ZOOM_STEPS].reverse().find((z) => z < cur - 0.001)
      setScale(lower ?? ZOOM_STEPS[0])
    }
  }

  const onSelect = useCallback((num, host) => {
    const s = window.getSelection()
    if (!s || s.isCollapsed || !host) return setSel(null)
    const text = s.toString().trim()
    if (!text || !host.contains(s.anchorNode)) return setSel(null)
    const base = host.getBoundingClientRect()
    const rects = [...s.getRangeAt(0).getClientRects()]
      .filter((r) => r.width > 1 && r.height > 1)
      .map((r) => ({
        x: (r.left - base.left) / base.width, y: (r.top - base.top) / base.height,
        w: r.width / base.width, h: r.height / base.height,
      }))
    if (!rects.length) return setSel(null)
    setSel({ page: num, rects, text: text.slice(0, 400) })
  }, [])

  async function search(e) {
    e?.preventDefault()
    if (!doc || !q.trim()) { setHits(null); return }
    setFinding(true)
    const needle = q.trim().toLowerCase()
    const found = []
    for (let n = 1; n <= total && found.length < 200; n++) {
      try {
        const tc = await doc.getPage(n).then((p) => p.getTextContent())
        const s = tc.items.map((i) => i.str).join(' ')
        const low = s.toLowerCase()
        let at = low.indexOf(needle)
        while (at !== -1 && found.length < 200) {
          found.push({ page: n, snippet: s.slice(Math.max(0, at - 38), at + needle.length + 38).trim() })
          at = low.indexOf(needle, at + needle.length)
        }
      } catch { /* skip page */ }
    }
    setFinding(false); setHits(found)
    if (found.length) goto(found[0].page)
  }

  if (err) {
    return (
      <div className="pdf-err">
        <b>This document could not be opened.</b><span>{err}</span>
        <button className="btn secondary sm" onClick={() => window.location.reload()}>Try again</button>
      </div>
    )
  }

  return (
    <div className={'pdf' + (full ? ' full' : '')} ref={rootRef}>
      <div className="pdf-bar">
        <button className={'pdf-b' + (rail === 'thumbs' ? ' on' : '')} title="Page thumbnails"
          onClick={() => setRail(rail === 'thumbs' ? null : 'thumbs')}>▤</button>
        {outline.length ? (
          <button className={'pdf-b' + (rail === 'toc' ? ' on' : '')}
            onClick={() => setRail(rail === 'toc' ? null : 'toc')}>Contents</button>
        ) : null}

        <div className="pdf-pager">
          <button className="pdf-b" onClick={() => goto(page - 1)} disabled={page <= 1} aria-label="Previous page">◀</button>
          <input type="number" min="1" max={total || 1} value={page}
            onChange={(e) => goto(Number(e.target.value) || 1)} aria-label="Page number" />
          <em>of {total || '—'}</em>
          <button className="pdf-b" onClick={() => goto(page + 1)} disabled={!!total && page >= total} aria-label="Next page">▶</button>
        </div>

        <form className="pdf-find" onSubmit={search}>
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Find in document" aria-label="Find in document" />
          {finding ? <span className="pdf-hits">searching…</span>
            : hits ? <span className="pdf-hits">{hits.length || 'no'} match{hits.length === 1 ? '' : 'es'}</span> : null}
        </form>

        <div className="pdf-zoom">
          <button className="pdf-b" onClick={() => zoomBy(-1)} aria-label="Zoom out">−</button>
          <span className="pdf-zv">{Math.round((scale || 1) * 100)}%</span>
          <button className="pdf-b" onClick={() => zoomBy(1)} aria-label="Zoom in">+</button>
          <button className={'pdf-b' + (fit === 'width' ? ' on' : '')} title="Fit width"
            onClick={() => setFit('width')}>↔</button>
          <button className={'pdf-b' + (fit === 'page' ? ' on' : '')} title="Fit page"
            onClick={() => setFit('page')}>▭</button>
          {canFull ? (
            <button className={'pdf-b' + (full ? ' on' : '')} title={full ? 'Exit full screen' : 'Full screen'}
              onClick={toggleFull}>⛶</button>
          ) : null}
        </div>
      </div>

      <div className="pdf-body">
        {rail === 'toc' && outline.length ? (
          <nav className="pdf-toc" aria-label="Table of contents">
            <div className="pdf-toc-h">Contents</div>
            <ul>
              {outline.map((it, i) => (
                <li key={i}>
                  <button onClick={() => gotoDest(it.dest)}>{it.title}</button>
                  {it.items?.length ? <ul>{it.items.map((s, j) => (
                    <li key={j}><button onClick={() => gotoDest(s.dest)}>{s.title}</button></li>
                  ))}</ul> : null}
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        {rail === 'thumbs' && doc ? (
          <div className="pdf-thumbs" aria-label="Page thumbnails">
            {Array.from({ length: total }, (_, i) => (
              <Thumb key={i + 1} doc={doc} num={i + 1} current={page === i + 1} onGo={goto} />
            ))}
          </div>
        ) : null}

        <div className="pdf-scroll" ref={scrollRef}>
          {!doc ? <div className="pdf-load">Opening {title || 'document'}…</div> : null}
          {doc && scale ? (
            <div className="pdf-col">
              {Array.from({ length: total }, (_, i) => (
                <Page key={i + 1} doc={doc} num={i + 1} scale={scale} highlights={highlights}
                  onSelect={onSelect} observe={observe} active={near.has(i + 1)} />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {hits?.length ? (
        <div className="pdf-hitlist">
          {hits.slice(0, 8).map((h, i) => (
            <button key={i} onClick={() => goto(h.page)}><b>p{h.page}</b> …{h.snippet}…</button>
          ))}
        </div>
      ) : null}

      {sel ? (
        <div className="pdf-selbar" role="dialog" aria-label="Highlight selection">
          <span className="pdf-selq">“{sel.text.slice(0, 90)}{sel.text.length > 90 ? '…' : ''}”</span>
          <button className="btn primary sm" onClick={() => { onAddHighlight?.(sel); setSel(null); window.getSelection()?.removeAllRanges() }}>Highlight &amp; note</button>
          <button className="linkbtn" onClick={() => { setSel(null); window.getSelection()?.removeAllRanges() }}>Cancel</button>
        </div>
      ) : null}

      {highlights.length ? (
        <div className="pdf-hl-list">
          <div className="pdf-hl-h">Your highlights · {highlights.length}</div>
          {highlights.map((h) => (
            <div className="pdf-hl" key={h.id}>
              <p>{h.body}</p>
              {h.anchor?.text ? <q>{h.anchor.text.slice(0, 160)}</q> : null}
              <div className="pdf-hl-a">
                <button className="linkbtn" onClick={() => goto(h.anchor.page)}>Go to p{h.anchor.page}</button>
                <button className="linkbtn" onClick={() => onDeleteHighlight?.(h.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
