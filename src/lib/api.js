import { supabase } from './supabase'

function withTimeout(promise, label, ms = 10000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    }),
  ])
}

const CACHE_TTL = 1000 * 60 * 60

function readCache(key) {
  try {
    const raw = window.sessionStorage.getItem(`studyefrm:${key}`)
    if (!raw) return null
    const cached = JSON.parse(raw)
    if (!cached || Date.now() - cached.t > CACHE_TTL) return null
    return cached.v
  } catch {
    return null
  }
}

function writeCache(key, value) {
  try {
    window.sessionStorage.setItem(`studyefrm:${key}`, JSON.stringify({ t: Date.now(), v: value }))
  } catch {
    // cache is a performance/fallback layer only
  }
}

async function cached(key, loader) {
  const hit = readCache(key)
  if (hit !== null) return hit
  try {
    const value = await loader()
    writeCache(key, value)
    return value
  } catch (err) {
    const stale = readCache(key)
    if (stale !== null) return stale
    throw err
  }
}

// Public, anon-safe: the two orientation modules via the SECURITY DEFINER RPC.
// Returns [] until a module is approved. Reading sections + EACCME metadata only.
export async function getOrientationModules() {
  return cached('orientation-modules', async () => {
    const { data, error } = await withTimeout(supabase.rpc('public_orientation_modules'), 'Orientation modules')
    if (error) throw error
    return data ?? []
  })
}

// Public, anon-safe: aggregate curriculum structure (domains, line counts, mapped
// guideline codes, % approved) via the SECURITY DEFINER RPC. No gated content.
export async function getCurriculumOverview() {
  return cached('curriculum-overview', async () => {
    const { data, error } = await withTimeout(supabase.rpc('public_curriculum_overview'), 'Curriculum overview')
    if (error) throw error
    return data ?? null
  })
}

// EACCME credit: 0.5 ECMEC per 30 min === minutes / 60.
export function ecmec(minutes) {
  if (!minutes) return null
  return Math.round((minutes / 60) * 100) / 100
}

// ── Gated reads (approved users / admin). RLS allows is_approved() OR is_admin();
//    db/08 granted `authenticated` the base SELECTs. Pending users are routed to the
//    waitlist before these run, and RLS would return empty for them regardless.

export async function getDomainCoverage() {
  return cached('domain-coverage', async () => {
    const { data, error } = await withTimeout(
      supabase.from('domain_coverage').select('*').order('domain_number'),
      'Domain coverage'
    )
    if (error) throw error
    return data ?? []
  })
}

export async function getRegistryStats() {
  return cached('registry-stats', async () => {
    const [ka, ga] = await withTimeout(Promise.all([
      supabase.from('knowledge_areas').select('*', { count: 'exact', head: true }),
      supabase.from('guideline_anchors').select('*', { count: 'exact', head: true }),
    ]), 'Registry stats')
    if (ka.error) throw ka.error
    if (ga.error) throw ga.error
    return { knowledge_areas: ka.count ?? 0, guideline_anchors: ga.count ?? 0 }
  })
}

export async function getOsceLmsCases() {
  return cached('osce-cases', async () => {
    const { data, error } = await withTimeout(
      supabase
        .from('osce_lms_cases')
        .select('case_code,title,slug,stations,primary_domain,difficulty,access_tier,source_type,full_analysis,teaching_card')
        .eq('is_published', true)
        .order('case_code'),
      'OSCE cases'
    )
    if (error) throw error
    return data ?? []
  })
}

export async function getDomainByNumber(num) {
  const { data, error } = await supabase
    .from('domain_coverage').select('*').eq('domain_number', num).maybeSingle()
  if (error) throw error
  return data ?? null
}

export async function getDomainLines(domainId) {
  const { data, error } = await supabase
    .from('syllabus_lines')
    .select('id, code, line_text, competency_kind, sort_order, syllabus_trace ( edge_type, guideline_anchors ( code, name, body ) )')
    .eq('domain_id', domainId).order('sort_order')
  if (error) throw error
  return (data ?? []).map(shapeLine)
}

export async function getLineByCode(code) {
  const { data, error } = await supabase
    .from('syllabus_lines')
    .select('id, code, line_text, competency_kind, source_section, sort_order, domains ( number, name ), syllabus_trace ( edge_type, knowledge_areas ( code, name ), guideline_anchors ( code, name, body, year, url ) )')
    .eq('code', code).maybeSingle()
  if (error) throw error
  if (!data) return null
  const line = shapeLine(data)
  line.domain = data.domains || null

  // 4th trace layer (EBCOG PACT / MRCOG2024 …) — populated by Routine 1; may be empty now.
  const { data: fw } = await supabase
    .from('line_framework_map')
    .select('relation, framework_nodes ( code, title, curriculum_frameworks ( code, name ) )')
    .eq('line_id', data.id)
  line.frameworks = fw ?? []

  // approved content nodes addressed to this line (Phase 1A: usually none → in-production)
  const { data: nodes } = await supabase
    .from('content_nodes').select('id, node_type, title, slug, status')
    .eq('syllabus_line_id', data.id).eq('status', 'approved')
  line.nodes = nodes ?? []
  return line
}

function shapeLine(row) {
  const edges = row.syllabus_trace || []
  // The basis of a layer lives on its edge (syllabus_trace.note). A line can carry
  // several root edges; if the displayed one has no note, fall back to the first
  // root edge that does, so the reasoning is not lost.
  const rootEdge = edges.find((e) => e.edge_type === 'root' && e.knowledge_areas) || null
  const rootNote = rootEdge?.note || edges.find((e) => e.edge_type === 'root' && e.note)?.note || null
  const root = rootEdge ? { ...rootEdge.knowledge_areas, note: rootNote } : null
  // dedup by code: the live DB can carry duplicate anchored_in edges (a line may legitimately have >1 distinct anchor)
  const anchors = [...new Map(
    edges.filter((e) => e.edge_type === 'anchored_in' && e.guideline_anchors).map((e) => [e.guideline_anchors.code, { ...e.guideline_anchors, note: e.note || null }])
  ).values()]
  return {
    id: row.id, code: row.code, line_text: row.line_text,
    competency_kind: row.competency_kind, source_section: row.source_section,
    sort_order: row.sort_order, root, anchors,
  }
}

// The manuscript for a line is the paid artefact, so it sits in the PRIVATE
// `manuscripts` bucket rather than behind a public URL. library_resources holds
// the object path ("manuscripts/atcrm-1-22.pdf"); the reader needs a URL, so we
// mint a short-lived signed one per load. Storage RLS still decides: the signature
// is only issued to a signed-in user who passes the same approval gate as the LMS.
const MANUSCRIPT_BUCKET = 'manuscripts'
const SIGNED_URL_TTL_S = 60 * 60 * 8   // a full reading session, not an hour

export async function signManuscripts(resources) {
  const pending = resources.filter((r) => (
    r.resource_type === 'manuscript' && r.storage_url && !/^(https?:)?\/\//i.test(r.storage_url)
  ))
  if (!pending.length) return
  const paths = pending.map((r) => String(r.storage_url).replace(new RegExp(`^${MANUSCRIPT_BUCKET}/`), ''))
  try {
    const { data, error } = await supabase.storage.from(MANUSCRIPT_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_S)
    if (error) return
    ;(data || []).forEach((row, i) => { if (row?.signedUrl && pending[i]) pending[i].signed_url = row.signedUrl })
  } catch {
    // an unsigned manuscript degrades to "not available" in the reader, never a crash
  }
}

// The whole line page — line, trace, frameworks and module — in ONE request
// (line_bundle RPC, SECURITY INVOKER so RLS applies exactly as before). If the
// function is unavailable the page falls back to the per-table requests.
export async function getLineBundle(code) {
  const { data, error } = await supabase.rpc('line_bundle', { p_code: code })
  if (error) {
    const line = await getLineByCode(code)
    return { line, module: line ? await getLineModule(line.id) : null }
  }
  if (!data || !data.line) return { line: null, module: null }
  const line = shapeLine(data.line)
  line.domain = data.line.domains || null
  line.frameworks = data.line.frameworks || []
  line.nodes = data.nodes || []
  const module = await shapeModule({
    nodes: data.nodes, theory: data.theory, sections: data.sections, resources: data.resources,
    questions: data.questions, emqGroups: data.emq_groups, osce: data.osce, decon: data.decon, recs: data.recs,
    appraisals: data.appraisals, evidenceRows: data.evidence, secondaryRows: data.secondary, linkRows: data.links,
    linkedNodes: data.linked_nodes, secondaryNodes: data.secondary_nodes, linkedLines: data.linked_lines,
  }, { sign: false })
  // the candidate's own progress + question history came in the same request
  module.progress = Object.fromEntries((data.progress || []).map((r) => [r.node_id, { state: r.state, ...parsePos(r.last_position) }]))
  module.attempts = data.attempts || []
  return { line, module }
}

// Slice 4 — the gated clinical module for a line: pull every approved content node
// addressed to the line + its payload, normalised for the v4 tabbed reader.
// Empty (Phase 1A) → { empty:true }; the reader then shows in-production stubs.
export async function getLineModule(lineId) {
  const { data: nodes, error } = await supabase
    .from('content_nodes').select('id, node_type, title, slug, status')
    .eq('syllabus_line_id', lineId).eq('status', 'approved')
  if (error) throw error
  if (!nodes || !nodes.length) {
    return { empty: true, theory: null, sections: [], resources: [], sba: [], mcq: [], emqGroups: [], osce: [], decon: null, recs: [], appraisals: [], evidenceDocuments: [], broader: [] }
  }
  const ids = nodes.map((n) => n.id)
  const theoryNode = nodes.find((n) => n.node_type === 'theory_module')
  const deconNode = nodes.find((n) => n.node_type === 'guideline')
  const resourceIds = nodes.filter((n) => n.node_type === 'library_resource').map((n) => n.id)
  const osceIds = nodes.filter((n) => n.node_type === 'osce_station').map((n) => n.id)
  const apprIds = nodes.filter((n) => n.node_type === 'abstract_appraisal').map((n) => n.id)
  const [theory, sections, resources, questions, emqGroups, osce, decon, recs, appraisals, evidenceRows, secondaryRows, linkRows] = await Promise.all([
    theoryNode ? supabase.from('theory_modules').select('*').eq('node_id', theoryNode.id).maybeSingle().then((r) => r.data) : null,
    theoryNode ? supabase.from('theory_sections').select('*').eq('module_node', theoryNode.id).order('sort_order').then((r) => r.data || []) : [],
    resourceIds.length ? supabase.from('library_resources').select('*').in('node_id', resourceIds).then((r) => r.data || []) : [],
    supabase.from('questions').select('*').in('node_id', ids).then((r) => r.data || []),
    supabase.from('emq_groups').select('*').in('node_id', ids).then((r) => r.data || []),
    osceIds.length ? supabase.from('osce_stations').select('*').in('node_id', osceIds).then((r) => r.data || []) : [],
    deconNode ? supabase.from('guideline_deconstructions').select('*').eq('node_id', deconNode.id).maybeSingle().then((r) => r.data) : null,
    deconNode ? supabase.from('guideline_recommendations').select('*').eq('deconstruction_node', deconNode.id).order('sort_order').then((r) => r.data || []) : [],
    apprIds.length ? supabase.from('abstract_appraisals').select('*').in('node_id', apprIds).then((r) => r.data || []) : [],
    supabase.from('node_evidence').select('node_id, locator, relation, evidence_documents ( id, doc_type, title, authority, year, citation, storage_url, url )').in('node_id', ids).then((r) => r.data || []),
    theoryNode ? supabase.from('node_syllabus_lines').select('role, lens, link_type, sort_order, syllabus_lines ( id, code, line_text, competency_kind )').eq('node_id', theoryNode.id).eq('role', 'secondary').order('sort_order').then((r) => r.data || []) : [],
    theoryNode ? supabase.from('content_links').select('to_node, link_type').eq('from_node', theoryNode.id).in('link_type', ['related', 'see_also', 'applied_in', 'explains']).then((r) => r.data || []) : [],
  ])
  const linkedIds = [...new Set((linkRows || []).map((r) => r.to_node).filter(Boolean))]
  const secondaryLineIds = [...new Set((secondaryRows || []).map((r) => r.syllabus_lines?.id).filter(Boolean))]
  const { data: linkedNodes } = linkedIds.length
    ? await supabase.from('content_nodes').select('id, title, status, syllabus_line_id').in('id', linkedIds)
    : { data: [] }
  const { data: secondaryNodes } = secondaryLineIds.length
    ? await supabase.from('content_nodes').select('id, title, status, syllabus_line_id').in('syllabus_line_id', secondaryLineIds)
    : { data: [] }
  const linkedLineIds = [...new Set([...(linkedNodes || []).map((n) => n.syllabus_line_id), ...secondaryLineIds].filter(Boolean))]
  const { data: linkedLines } = linkedLineIds.length
    ? await supabase.from('syllabus_lines').select('id, code, line_text, competency_kind').in('id', linkedLineIds)
    : { data: [] }
  return shapeModule({ nodes, theory, sections, resources, questions, emqGroups, osce, decon, recs, appraisals, evidenceRows, secondaryRows, linkRows, linkedNodes, secondaryNodes, linkedLines })
}

// Rows → the module shape the line page consumes. Shared by the one-request
// bundle (line_bundle RPC) and the per-table fallback, so both render identically.
async function shapeModule({ nodes, theory, sections, resources, questions, emqGroups, osce, decon, recs, appraisals, evidenceRows, secondaryRows, linkRows, linkedNodes, secondaryNodes, linkedLines }, { sign = true } = {}) {
  if (!nodes || !nodes.length) {
    return { empty: true, theory: null, sections: [], resources: [], sba: [], mcq: [], emqGroups: [], osce: [], decon: null, recs: [], appraisals: [], evidenceDocuments: [], broader: [] }
  }
  const nodeById = Object.fromEntries(nodes.map((n) => [n.id, n]))
  const slugById = Object.fromEntries(nodes.map((n) => [n.id, n.slug]))
  // MCQ (5 true/false statements) must be split out explicitly — it would
  // otherwise fall into the SBA bucket, which renders single-choice options.
  const withKey = (q) => ({ ...q, key: slugById[q.node_id] || q.node_id })
  const sba = (questions || []).filter((q) => q.type !== 'EMQ_item' && q.type !== 'MCQ').map(withKey)
  const mcq = (questions || []).filter((q) => q.type === 'MCQ').map(withKey)
  const emqItems = (questions || []).filter((q) => q.type === 'EMQ_item').map((q) => ({ ...q, key: slugById[q.node_id] || q.node_id }))
  const emqGroupsShaped = (emqGroups || []).map((g) => {
    const items = emqItems.filter((it) => it.emq_group_node === g.node_id)
    return { ...g, items, paper: items[0]?.paper || '1' }
  })
  const lineById = Object.fromEntries((linkedLines || []).map((l) => [l.id, l]))
  const nodeByLinkedId = Object.fromEntries((linkedNodes || []).map((n) => [n.id, n]))
  const broader = []
  ;(secondaryRows || []).forEach((r) => {
    if (!r.syllabus_lines) return
    const target = (secondaryNodes || []).find((n) => n.syllabus_line_id === r.syllabus_lines.id && n.status === 'approved')
      || (secondaryNodes || []).find((n) => n.syllabus_line_id === r.syllabus_lines.id)
    broader.push({ ...r.syllabus_lines, title: target?.title, lens: r.lens, link_type: r.link_type, status: target?.status || 'in_production', source: 'secondary' })
  })
  ;(linkRows || []).forEach((r) => {
    const node = nodeByLinkedId[r.to_node]
    const linkedLine = node && lineById[node.syllabus_line_id]
    if (!linkedLine) return
    broader.push({ ...linkedLine, title: node.title, link_type: r.link_type, status: node.status, source: 'content_link' })
  })
  const broaderUnique = [...broader.filter((r) => r.code).reduce((map, row) => {
    const previous = map.get(row.code)
    map.set(row.code, previous ? { ...row, lens: previous.lens || row.lens, status: previous.status === 'approved' || row.status === 'approved' ? 'approved' : row.status } : row)
    return map
  }, new Map()).values()]
  const shapedResources = (resources || []).map((r) => ({ ...r, node: nodeById[r.node_id] || null }))
  if (sign) await signManuscripts(shapedResources)
  return {
    empty: false, nodes, theory, sections,
    resources: shapedResources,
    sba, mcq, emqGroups: emqGroupsShaped,
    osce: osce || [], decon, recs: recs || [], appraisals: appraisals || [],
    evidenceDocuments: (evidenceRows || []).map((r) => ({ ...r.evidence_documents, locator: r.locator, relation: r.relation, node_id: r.node_id })).filter((r) => r.id),
    broader: broaderUnique,
  }
}

// ── Assessment scoring (slice 5) ─────────────────────────────────────────────
// `questions.node_id` is the PK — one question per content_node — so each answered
// question is exactly one `user_attempts` row. Schema is consumed, never altered:
// user_attempts(user_id, node_id, selected_answer, is_correct, time_taken_s).

// Persist one graded attempt (every answered item in the deck). Best-effort: a
// scoring failure must never block the candidate from seeing their result.
export async function saveQuizAttempt({ userId, items, answers, timings = {} }) {
  if (!userId || !items?.length) return { saved: 0 }
  const rows = items
    .filter((q) => answers[q.key] != null && q.node_id)
    .map((q) => ({
      user_id: userId,
      node_id: q.node_id,
      selected_answer: answers[q.key],
      is_correct: answers[q.key] === q.correct_answer,
      time_taken_s: Math.max(0, Math.round(timings[q.key] || 0)) || null,
    }))
  if (!rows.length) return { saved: 0 }
  const { error } = await supabase.from('user_attempts').insert(rows)
  if (error) return { saved: 0, error: error.message }
  return { saved: rows.length }
}

// The candidate's own history on this deck's questions (RLS: attempts_own).
export async function getMyQuestionStats(userId, nodeIds) {
  if (!userId || !nodeIds?.length) return null
  const { data, error } = await supabase
    .from('user_attempts')
    .select('node_id, is_correct, time_taken_s, attempted_at')
    .eq('user_id', userId)
    .in('node_id', nodeIds)
    .order('attempted_at', { ascending: false })
  if (error) return null
  return statsFromAttempts(data ?? [])
}

// Attempt rows (newest first) → last/best score per sitting.
export function statsFromAttempts(rows) {
  if (!rows?.length) return { attempts: 0, sessions: [], bestPct: null, lastPct: null }
  // group rows into sessions by attempt timestamp bucket (same submit ≈ same second)
  const buckets = new Map()
  rows.forEach((r) => {
    const k = String(r.attempted_at || '').slice(0, 16) // to the minute
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(r)
  })
  const sessions = [...buckets.entries()]
    .map(([when, rs]) => ({
      when,
      total: rs.length,
      correct: rs.filter((r) => r.is_correct).length,
      pct: Math.round((rs.filter((r) => r.is_correct).length / rs.length) * 100),
    }))
    .sort((a, b) => (a.when < b.when ? 1 : -1))
  return {
    attempts: rows.length,
    sessions,
    bestPct: sessions.reduce((m, s) => Math.max(m, s.pct), 0),
    lastPct: sessions[0]?.pct ?? null,
  }
}

// Cohort comparison — aggregate only (no individual identities). Served by the
// SECURITY DEFINER RPC in db/24; returns null until that migration is applied,
// and the UI simply hides the cohort row in that case.
export async function getCohortQuestionStats(nodeIds) {
  if (!nodeIds?.length) return null
  try {
    const { data, error } = await withTimeout(
      supabase.rpc('public_cohort_question_stats', { node_ids: nodeIds }),
      'Cohort stats',
      8000
    )
    if (error) return null
    const row = Array.isArray(data) ? data[0] : data
    if (!row || !row.candidates) return null
    return {
      candidates: row.candidates,
      avgPct: row.avg_pct == null ? null : Math.round(Number(row.avg_pct)),
      medianPct: row.median_pct == null ? null : Math.round(Number(row.median_pct)),
    }
  } catch {
    return null
  }
}

// Percentile band vs the cohort — deliberately a band, not a rank, so no
// individual candidate is identifiable.
export function percentileBand(myPct, cohort) {
  if (myPct == null || !cohort || cohort.avgPct == null) return null
  const d = myPct - cohort.avgPct
  if (d >= 15) return { label: 'Well above cohort average', tone: 'ok' }
  if (d >= 5) return { label: 'Above cohort average', tone: 'ok' }
  if (d > -5) return { label: 'At cohort average', tone: 'mid' }
  if (d > -15) return { label: 'Below cohort average', tone: 'low' }
  return { label: 'Well below cohort average', tone: 'low' }
}

// ── Flags / bookmarks + per-tab notes (db/25) ────────────────────────────────
// Both degrade to no-ops if db/25 hasn't been run, so the UI never breaks.

// kind: 'flag' = revisit during/after this attempt · 'bookmark' = keep for later
export async function getMyMarks(userId, nodeIds) {
  const empty = { flag: new Set(), bookmark: new Set() }
  if (!userId || !nodeIds?.length) return empty
  const { data, error } = await supabase
    .from('user_bookmarks').select('node_id, kind')
    .eq('user_id', userId).in('node_id', nodeIds)
  if (error) return empty
  const out = { flag: new Set(), bookmark: new Set() }
  ;(data ?? []).forEach((r) => { if (out[r.kind]) out[r.kind].add(r.node_id) })
  return out
}

export async function toggleMark(userId, nodeId, kind, on) {
  if (!userId || !nodeId) return false
  if (on) {
    const { error } = await supabase
      .from('user_bookmarks').upsert(
        { user_id: userId, node_id: nodeId, kind },
        { onConflict: 'user_id,node_id,kind' }
      )
    return !error
  }
  const { error } = await supabase
    .from('user_bookmarks').delete()
    .eq('user_id', userId).eq('node_id', nodeId).eq('kind', kind)
  return !error
}

// ── Per-tab notes (db/25) ───────────────────────────────────────────────────
export async function getNotes(userId, lineId, tab) {
  if (!userId || !lineId) return []
  const { data, error } = await supabase
    .from('user_notes').select('id, tab, anchor, body, created_at')
    .eq('user_id', userId).eq('line_id', lineId).eq('tab', tab)
    .order('created_at', { ascending: false })
  if (error) return []
  return data ?? []
}

export async function addNote({ userId, lineId, tab, body, anchor = null }) {
  if (!userId || !lineId || !body?.trim()) return null
  const { data, error } = await supabase
    .from('user_notes')
    .insert({ user_id: userId, line_id: lineId, tab, body: body.trim(), anchor })
    .select('id, tab, anchor, body, created_at').maybeSingle()
  if (error) return null
  return data
}

export async function deleteNote(userId, noteId) {
  if (!userId || !noteId) return false
  const { error } = await supabase
    .from('user_notes').delete().eq('id', noteId).eq('user_id', userId)
  return !error
}

// ── Flags for review ─────────────────────────────────────────────────────────
// A candidate's "Flag for review" is a user_notes row whose tab is
// "flag:<section>". notes_own (user_id = auth.uid() OR is_admin()) already lets
// the owner read and delete every flag — no schema or policy change.
export const flagTab = (section) => `flag:${section}`

export async function getOwnerFlags() {
  const { data, error } = await supabase
    .from('user_notes').select('id, user_id, line_id, tab, body, created_at')
    .like('tab', 'flag:%').order('created_at', { ascending: false })
  if (error) throw error
  const rows = data ?? []
  const lineIds = [...new Set(rows.map((r) => r.line_id).filter(Boolean))]
  const { data: lines } = lineIds.length
    ? await supabase.from('syllabus_lines').select('id, code, line_text').in('id', lineIds)
    : { data: [] }
  const byId = Object.fromEntries((lines || []).map((l) => [l.id, l]))
  return rows.map((r) => ({ ...r, section: r.tab.slice(5), line: byId[r.line_id] || null }))
}

// Resolving removes the flag (the notes policy lets the owner delete, not edit).
export async function resolveFlag(id) {
  if (!id) return false
  const { error } = await supabase.from('user_notes').delete().eq('id', id)
  return !error
}

// ── Completion by viewing (db: user_node_progress) ──────────────────────────
// Evidence is "opened and viewed": a section, PDF page or slide counts once the
// candidate has actually opened it. When every section of a node has been seen,
// the candidate may mark it completed. `zone` is deliberately NOT written — the
// schema states it is derived, and completion is not a RAG judgement.
//
//   state          'unseen' | 'in_progress' | 'completed'
//   last_position  JSON: {"viewed":[0,2,3],"total":8,"resume":{"sec":"theory","page":12}}
//                  (TEXT column, no migration). `resume` lives on the theory node and
//                  is where the line workspace reopens — it follows the candidate
//                  across devices.

function parsePos(raw) {
  try {
    const v = JSON.parse(raw || '{}')
    return {
      viewed: Array.isArray(v.viewed) ? v.viewed : [],
      total: v.total || 0,
      resume: v.resume && typeof v.resume === 'object' ? v.resume : null,
    }
  } catch { return { viewed: [], total: 0, resume: null } }
}

export async function getNodeProgress(userId, nodeId) {
  if (!userId || !nodeId) return null
  const { data, error } = await supabase
    .from('user_node_progress').select('state, last_position, updated_at')
    .eq('user_id', userId).eq('node_id', nodeId).maybeSingle()
  if (error) return null
  if (!data) return { state: 'unseen', viewed: [], total: 0, resume: null }
  const pos = parsePos(data.last_position)
  return { state: data.state, viewed: pos.viewed, total: pos.total, resume: pos.resume }
}

// Every progress row the candidate has on one line, in one request.
// Returns { [node_id]: { state, viewed, total, resume } }.
export async function getLineProgress(userId, nodeIds) {
  if (!userId || !nodeIds?.length) return {}
  const { data, error } = await supabase
    .from('user_node_progress').select('node_id, state, last_position')
    .eq('user_id', userId).in('node_id', nodeIds)
  if (error) return {}
  return Object.fromEntries((data || []).map((r) => [r.node_id, { state: r.state, ...parsePos(r.last_position) }]))
}

// Where the workspace should reopen (section + PDF page). Stored on the theory
// node alongside its page-view evidence, which it never overwrites.
export async function saveResume(userId, nodeId, resume) {
  if (!userId || !nodeId || !resume) return false
  const cur = await getNodeProgress(userId, nodeId)
  const { error } = await supabase.from('user_node_progress').upsert({
    user_id: userId,
    node_id: nodeId,
    state: cur?.state && cur.state !== 'unseen' ? cur.state : 'in_progress',
    last_position: JSON.stringify({ viewed: cur?.viewed || [], total: cur?.total || 0, resume }),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,node_id' })
  return !error
}

// Records that one section/page/slide has been opened. Idempotent per index.
export async function markSectionViewed(userId, nodeId, index, total) {
  if (!userId || !nodeId || index == null) return null
  const current = await getNodeProgress(userId, nodeId)
  const viewed = current?.viewed || []
  if (viewed.includes(index) && current?.total === total) return current
  const nextViewed = viewed.includes(index) ? viewed : [...viewed, index].sort((a, b) => a - b)
  const next = {
    user_id: userId,
    node_id: nodeId,
    state: current?.state === 'completed' ? 'completed' : 'in_progress',
    last_position: JSON.stringify({ viewed: nextViewed, total, resume: current?.resume || null }),
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabase
    .from('user_node_progress').upsert(next, { onConflict: 'user_id,node_id' })
  if (error) return current
  return { state: next.state, viewed: nextViewed, total, resume: current?.resume || null }
}

export async function setNodeCompleted(userId, nodeId, done, viewed = [], total = 0) {
  if (!userId || !nodeId) return false
  const cur = await getNodeProgress(userId, nodeId)
  const { error } = await supabase
    .from('user_node_progress').upsert({
      user_id: userId,
      node_id: nodeId,
      state: done ? 'completed' : 'in_progress',
      last_position: JSON.stringify({ viewed, total, resume: cur?.resume || null }),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,node_id' })
  return !error
}

// ── Cycle domain view ────────────────────────────────────────────────────────
// Phase now derives from viewing evidence, not from a self-declared zone:
//   carried = a node on that line is completed
//   due     = opened but not finished
//   open    = never opened
export async function getDomainCycle(userId, domainId, lines) {
  const total = lines?.length || 0
  const empty = { total, carried: 0, due: 0, open: total, pct: 0, byLine: {} }
  if (!userId || !total) return empty

  const lineIds = lines.map((l) => l.id)
  const { data, error } = await supabase
    .from('user_node_progress')
    .select('state, content_nodes!inner ( syllabus_line_id )')
    .eq('user_id', userId)
    .in('content_nodes.syllabus_line_id', lineIds)
  if (error) return empty

  // strongest signal per line wins: completed > in_progress
  const byLine = {}
  ;(data ?? []).forEach((r) => {
    const lid = r.content_nodes?.syllabus_line_id
    if (!lid) return
    const phase = r.state === 'completed' ? 'carried' : 'due'
    if (byLine[lid]?.phase === 'carried') return
    byLine[lid] = { phase }
  })
  lines.forEach((l) => { if (!byLine[l.id]) byLine[l.id] = { phase: 'open' } })

  const carried = Object.values(byLine).filter((v) => v.phase === 'carried').length
  const due = Object.values(byLine).filter((v) => v.phase === 'due').length
  return { total, carried, due, open: total - carried - due, pct: Math.round((carried / total) * 100), byLine }
}

// ── Owner console (admin only; enforced again by RLS/is_admin()) ─────────────

export async function getOwnerUsers() {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, role, status, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function updateUserStatus(userId, status) {
  const { data, error } = await supabase
    .from('users')
    .update({ status })
    .eq('id', userId)
    .select('id, email, role, status')
    .maybeSingle()
  if (error) throw error
  return data
}

export async function getOwnerContentQueue() {
  const { data, error } = await supabase
    .from('content_nodes')
    .select('id, slug, title, node_type, status, submitted_at, approved_at, approved_by, syllabus_lines ( code ), domains ( number, name )')
    .in('status', ['pending', 'needs_edit'])
    .order('submitted_at', { ascending: false })
    .limit(80)
  if (error) throw error
  return data ?? []
}

export async function approveContentNode(nodeId, approvedBy) {
  const { data, error } = await supabase
    .from('content_nodes')
    .update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: approvedBy || 'owner' })
    .eq('id', nodeId)
    .select('id, slug, title, node_type, status')
    .maybeSingle()
  if (error) throw error
  return data
}
