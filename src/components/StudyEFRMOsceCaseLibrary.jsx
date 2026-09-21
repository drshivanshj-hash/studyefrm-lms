import React, { useMemo, useState } from "react";
import "../styles/module.css";

// ── Station vocabulary (Part 2 OSCE) ────────────────────────────────────────
// EFRM Part 2 OSCE — 2026 exam structure (9 stations, 12 min each; ESHRE confirmation 04 Jul 2026)
const DOMAIN_LABELS = {
  ST1: "Reproductive Endocrinology",
  ST2: "MAR / Infertility",
  ST3: "Embryology",
  ST4: "Andrology",
  ST5: "Reproductive Surgery",
  ST6: "Early Pregnancy & Implantation",
  ST7: "Fertility Preservation",
  ST8: "Abstract / Statistics",
  ST9: "PGT & Genetics",
};

// ── RICH CASE SHAPE (the locked schema — mirrors ATCRM 1.01_R2_osce.json) ────
// osce_lms_cases.full_analysis JSONB:
//   { candidate_brief:{station_label,time_available,format,scenario_text},
//     examiner_questions:[{question_id,question,marks,mark_breakdown{},model_answer,distinction_addition}],
//     mark_scheme:{total_marks,pass_mark,merit_mark,distinction_mark,global_descriptors{}},
//     distinction_vs_pass:{pass_candidate[],distinction_candidate[]},
//     fail_traps:[{trap_id,trap_description,consequence,examiner_probe,correct_anchor}],
//     source_evidence:[{doc_id,citation,recommendation_type,relevance}] }
// osce_lms_cases.teaching_card JSONB = the quick "decision trap" glance card.
//
// Cases come only from the database (RLS: approved users). Nothing is bundled
// into the shipped JavaScript, which any visitor can download without signing in.

const PYRAMID = [
  { key: "meta", label: "Meta-analysis / Systematic review" },
  { key: "rct", label: "Randomised controlled trial" },
  { key: "cohort", label: "Cohort study" },
  { key: "case_control", label: "Case-control study" },
  { key: "cross_sectional", label: "Cross-sectional / diagnostic" },
  { key: "case_series", label: "Case series / case reports" },
  { key: "expert", label: "Expert opinion / editorial" },
];

const BIAS_GLOSSARY = {
  selection: "Selection bias — entrants differ systematically from non-entrants. Ask: are these patients representative of my clinical population?",
  performance: "Performance bias — participants/providers behave differently knowing allocation. Mitigated by blinding.",
  detection: "Detection bias — outcomes measured differently between groups. Mitigated by blinded outcome assessment.",
  attrition: "Attrition bias — dropouts differ from completers. Ask dropout rate, reasons, balance; ITT is conservative.",
  reporting: "Reporting / publication bias — positive or favourable results are more likely to appear or be emphasised.",
  confounding: "Confounding — a third variable linked to both exposure and outcome creates a false association.",
  recall: "Recall bias — differential accuracy of recollection between cases and controls.",
};

const VERDICT_COLOR = { ok: "var(--ok)", caution: "var(--authority)", flaw: "var(--danger)", na: "var(--ink-4)" };
const BOTTOM_LINE = {
  adopt: ["ok", "Practice-changing — adopt"],
  adopt_selected: ["caution", "Cautiously adopt in selected patients"],
  do_not_adopt: ["flaw", "Do not change practice yet"],
  use_with_caution: ["caution", "Use with caution"],
  use_for_mechanistic_basis: ["caution", "Use for mechanistic basis"],
};

// ── helpers ─────────────────────────────────────────────────────────────────
function asObject(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try { const p = JSON.parse(value); return p && typeof p === "object" ? p : {}; } catch { return {}; }
  }
  return typeof value === "object" ? value : {};
}
function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (!value) return [];
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return [];
    if (t.startsWith("[")) { try { const p = JSON.parse(t); return Array.isArray(p) ? p.filter(Boolean) : []; } catch { return []; } }
    return t.split(/[,+/]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function normalizeCase(row) {
  const fa = asObject(row.full_analysis || row.fullAnalysis);
  const tc = asObject(row.teaching_card || row.teachingCard);
  const brief = asObject(fa.candidate_brief);
  const appraisal = asObject(fa.article_appraisal);
  const isRoutine3Appraisal = row.source_type === "routine3_appraisal" || (!!fa.appraisal && !!fa.stats_summary && !!fa.article_title);
  const routine3Sources = isRoutine3Appraisal ? asArray(fa.source_evidence) : [];
  const sources = isRoutine3Appraisal ? routine3Sources : asArray(fa.source_evidence);
  const sourceAnchor = sources.map((s) => s?.citation || s?.authority || s?.doc_id).filter(Boolean).join(" · ");
  const stations = asArray(row.stations || row.primary_domain || tc.station);
  const isAppraisal = isRoutine3Appraisal || stations.includes("ST8") || fa.meta?.node_type === "osce_abstract_appraisal_station";
  const appraisalScenario = [
    (isRoutine3Appraisal ? fa.article_title : appraisal.article_title) ? `Article: ${isRoutine3Appraisal ? fa.article_title : appraisal.article_title}` : "",
    (isRoutine3Appraisal ? fa.study_design : appraisal.study_design) ? `Design: ${isRoutine3Appraisal ? fa.study_design : appraisal.study_design}` : "",
    appraisal.exam_task || "",
  ].filter(Boolean).join("\n");
  return {
    caseCode: row.case_code || row.caseCode,
    title: row.title || tc.title,
    slug: row.slug,
    stations,
    difficulty: row.difficulty || 3,
    accessTier: row.access_tier || row.accessTier || "pilot",
    isAppraisal,
    appraisalPayload: isRoutine3Appraisal ? fa : null,
    teachingCard: {
      scenario: isAppraisal
        ? (tc.scenario || appraisalScenario || brief.scenario_text || "")
        : (tc.scenario || tc.diagnosis || brief.clinical_scenario || brief.scenario_text || ""),
      commonError: tc.commonError || tc.common_error || tc.critical_gap || "",
      anchor: tc.eshreAnchor || tc.eshre_anchor || tc.anchor || brief.guideline_anchor || sourceAnchor || "",
      nextStepGaps: asArray(tc.nextStepGaps || tc.next_step_gaps),
      examinerChallenges: asArray(tc.examinerChallenges || tc.examiner_challenges),
    },
    brief,
    questions: asArray(fa.examiner_questions),
    markScheme: asObject(fa.mark_scheme),
    passVsDistinction: asObject(fa.distinction_vs_pass),
    failTraps: asArray(fa.fail_traps),
    sources,
  };
}

function AppraisalReport({ a }) {
  const ap = asObject(a.appraisal);
  const stats = asObject(a.stats_summary);
  const domains = asArray(ap.domains);
  const metrics = asArray(stats.metrics);
  const biases = asArray(a.biases);
  const [openD, setOpenD] = useState(() => new Set(domains.length ? [0] : []));
  const toggleD = (i) => setOpenD((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const plKey = ap.evidence_level && ap.evidence_level.pyramid_key;
  const plIdx = PYRAMID.findIndex((p) => p.key === plKey);
  const pyramidRank = plIdx >= 0 ? plIdx + 1 : (ap.evidence_level && ap.evidence_level.rank) || 0;
  const [bClass, bLabel] = BOTTOM_LINE[ap.verdict] || [null, null];
  const hasStats = stats.primary_outcome || metrics.length || stats.sample_size || stats.analysis || stats.interpretation;

  return (
    <div className="card osl-sec block osl-appraisal">
      <div className="eyebrow osl-sec-h">Routine 3 appraisal report</div>
      <div className="lm-ap">
        <div className="lm-ap-head">
          <div className="lm-ap-title">{a.article_title || "Untitled abstract"}</div>
          {(a.journal || a.publish_year || a.doi) && (
            <div className="lm-ap-cite">
              {[a.journal, a.publish_year].filter(Boolean).join(" · ")}
              {a.doi ? <> · <span className="code">{a.doi}</span></> : null}
            </div>
          )}
          {(a.study_design || a.grade) && (
            <div className="lm-ap-chips">
              {a.study_design ? <span className="lm-ap-chip design">{a.study_design}</span> : null}
              {a.grade ? <span className="lm-ap-chip grade">GRADE {a.grade}</span> : null}
            </div>
          )}
        </div>

        {a.pico ? <><div className="lm-h4">PICO</div><p className="ds-body">{a.pico}</p></> : null}

        {ap.opening_line ? (
          <div className="lm-ap-opener"><div className="vh">How to open in the viva</div>{ap.opening_line}</div>
        ) : null}

        {pyramidRank ? (
          <>
            <div className="lm-h4">Hierarchy of evidence</div>
            <div className="lm-ap-pyramid">
              {PYRAMID.map((p, i) => (
                <div key={p.key} className={"lvl" + (i + 1 === pyramidRank ? " on" : i + 1 < pyramidRank ? " above" : "")} style={{ width: `${100 - i * 11}%` }}>{p.label}</div>
              ))}
            </div>
          </>
        ) : null}

        {domains.length ? (
          <>
            <div className="lm-h4">Critical appraisal — {domains.length} domains</div>
            {domains.map((d, i) => (
              <div className={"lm-ap-dom" + (openD.has(i) ? " open" : "")} key={d.key || i}>
                <div className="lm-ap-dom-h" onClick={() => toggleD(i)}>
                  <span className="lm-ap-dot" style={{ background: VERDICT_COLOR[d.verdict] || "var(--ink-4)" }} />
                  <span className="t">{d.n ? `${d.n}. ` : ""}{d.title}</span>
                  <span className="a">▶</span>
                </div>
                <div className="lm-ap-dom-b">
                  {d.findings ? <p>{d.findings}</p> : null}
                  {d.examiner_probe ? <div className="lm-ap-probe"><b>Examiner probe:</b> {d.examiner_probe}</div> : null}
                  {d.model_answer ? <div className="lm-ap-model"><b>Model answer:</b> {d.model_answer}</div> : null}
                </div>
              </div>
            ))}
          </>
        ) : null}

        {hasStats ? (
          <>
            <div className="lm-h4">Statistics</div>
            {stats.primary_outcome ? <p className="ds-body"><b>Primary outcome:</b> {stats.primary_outcome}</p> : null}
            {metrics.length ? (
              <table className="lm-ap-stats">
                <thead><tr><th>Measure</th><th>Estimate</th><th>95% CI</th><th>p</th><th>Interpretation</th></tr></thead>
                <tbody>
                  {metrics.map((m, i) => (
                    <tr key={i} className={m.significant === true ? "sig" : m.significant === false ? "nonsig" : ""}>
                      <td><b>{m.label}</b></td><td>{m.value ?? "—"}</td><td>{m.ci || "—"}</td><td>{m.p || "—"}</td><td>{m.note || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {(stats.sample_size || stats.analysis) && (
              <div className="lm-ap-statmeta">
                {stats.sample_size ? <span><b>Sample</b> n={stats.sample_size.n ?? "—"} · {stats.sample_size.powered ? "adequately powered" : "power not demonstrated"}{stats.sample_size.calculation ? ` — ${stats.sample_size.calculation}` : ""}</span> : null}
                {stats.analysis ? <span><b>Analysis</b> {stats.analysis}</span> : null}
              </div>
            )}
            {stats.interpretation ? <p className="ds-body">{stats.interpretation}</p> : null}
          </>
        ) : null}

        {biases.length ? (
          <>
            <div className="lm-h4">Bias &amp; threats to validity</div>
            <div className="lm-ap-bias">
              {biases.map((b, i) => {
                const key = String(b).toLowerCase().split(/[\s_—-]/)[0];
                const desc = BIAS_GLOSSARY[key];
                return <div className="lm-ap-bchip" key={i}><b>{b}</b>{desc ? <span>{desc}</span> : null}</div>;
              })}
            </div>
          </>
        ) : null}

        {a.applicability ? <><div className="lm-h4">Clinical applicability</div><p className="ds-body">{a.applicability}</p></> : null}

        {(bLabel || ap.bottom_line) ? (
          <div className={"lm-ap-bottom " + (bClass || "caution")}>
            <div className="vh">{bLabel || "Bottom line"}</div>
            {ap.bottom_line ? <p>{ap.bottom_line}</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function orientationSummary(modules = []) {
  const safeModules = Array.isArray(modules) ? modules.filter(Boolean) : [];
  const minutes = safeModules.reduce((sum, mod) => sum + (Number(mod.estimated_minutes) || 0), 0);
  const outcomes = safeModules.flatMap((mod) => asArray(mod.educational_outcomes)).slice(0, 4);
  const sections = safeModules
    .flatMap((mod) => asArray(mod.sections).map((section) => section.section_title || section.sectionTitle))
    .filter(Boolean)
    .slice(0, 5);

  return {
    count: safeModules.length,
    minutes,
    outcomes,
    sections,
    titles: safeModules.map((mod) => mod.title).filter(Boolean),
  };
}

function OsceOrientationCard({ modules = [] }) {
  const summary = orientationSummary(modules);
  const stationEntries = Object.entries(DOMAIN_LABELS);
  return (
    <section className="card osl-orient" aria-label="OSCE orientation">
      <div className="osl-orient-main">
        <div>
          <div className="eyebrow">OSCE orientation</div>
          <h2 className="osl-orient-title">EFRM Part 2 2026 · London station map</h2>
          <p className="ds-body">
            Confirmation anchor: Saturday 04 July 2026 at ExCeL London, One Western Gateway,
            Royal Victoria Dock, London E16 1XL. Registration is 14:00 GMT, exam starts 14:30,
            ends 16:42. There are 9 successive OSCE stations, 12 minutes each.
          </p>
        </div>
        <div className="osl-orient-facts">
          <div><b>9</b><span>stations</span></div>
          <div><b>12</b><span>min each</span></div>
          <div><b>132</b><span>exam min</span></div>
          <div><b>{summary.count || "0"}</b><span>orientation modules</span></div>
        </div>
      </div>

      <div className="osl-orient-grid">
        <div className="osl-orient-block">
          <div className="osl-block-h">Official sequence</div>
          <div className="osl-station-grid">
            {stationEntries.map(([code, label]) => (
              <div key={code} className="osl-station-chip"><span>{code}</span>{label}</div>
            ))}
          </div>
        </div>
        <div className="osl-orient-block">
          <div className="osl-block-h">Use orientation module for</div>
          <ul className="osl-orient-list">
            {(summary.outcomes.length ? summary.outcomes : [
              "Understand where StudyEFRM fits in the EFRM preparation pathway",
              "Read the curriculum through the mapped LMS layers",
              "Use case practice as timed examiner-facing OSCE rehearsal",
            ]).map((item, index) => <li key={index}>{item}</li>)}
          </ul>
          {summary.minutes > 0 && <div className="osl-orient-meta code">Orientation reading: ~{summary.minutes} min</div>}
        </div>
      </div>

      {summary.sections.length > 0 && (
        <div className="osl-orient-sections">
          {summary.sections.map((section, index) => <span key={index}>{section}</span>)}
        </div>
      )}
    </section>
  );
}

// ── component ────────────────────────────────────────────────────────────────
export default function StudyEFRMOsceCaseLibrary({ cases, orientationModules = [], notice = "" }) {
  const source = cases;
  const normalized = useMemo(() => source.map(normalizeCase), [source]);
  const [activeDomain, setActiveDomain] = useState("ALL");
  const [query, setQuery] = useState("");
  const [selectedCode, setSelectedCode] = useState(normalized[0]?.caseCode);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return normalized.filter((c) => {
      const dom = activeDomain === "ALL" || c.stations.includes(activeDomain);
      const txt = !q || `${c.caseCode} ${c.title} ${c.teachingCard.commonError}`.toLowerCase().includes(q);
      return dom && txt;
    });
  }, [activeDomain, normalized, query]);

  const sel = useMemo(
    () => normalized.find((c) => c.caseCode === selectedCode) || filtered[0] || normalized[0],
    [filtered, normalized, selectedCode]
  );

  const ms = sel?.markScheme || {};
  const pvd = sel?.passVsDistinction || {};
  const briefMeta = [sel?.brief?.time_available, sel?.brief?.reading_time].filter(Boolean).join(" · ");

  return (
    <div className="osce-lib wrap fade-up">
      <style>{styles}</style>

      <div className="page-head osl-head">
        <div>
          <div className="eyebrow" style={{ color: "var(--primary)" }}>StudyEFRM · Part 2 OSCE</div>
          <h1 className="page-h1">Real Case Library</h1>
          <p className="page-lede">
            Depersonalised OSCE stations as full examiner vivas — decision traps, model answers,
            mark schemes, and the guideline anchor behind every mark.
          </p>
        </div>
        <div className="osl-stats">
          <div><b>{normalized.length}</b><span>cases</span></div>
          <div><b>{Object.keys(DOMAIN_LABELS).length}</b><span>stations</span></div>
          <div><b>{normalized.filter((c) => c.accessTier === "free").length}</b><span>free</span></div>
        </div>
      </div>

      {notice && <div className="osl-notice">{notice}</div>}

      <OsceOrientationCard modules={orientationModules} />

      <div className="osl-shell">
        <aside className="osl-rail">
          <input className="osl-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search cases" />
          <div className="osl-tabs">
            <button className={activeDomain === "ALL" ? "on" : ""} onClick={() => setActiveDomain("ALL")}>All</button>
            {Object.keys(DOMAIN_LABELS).map((code) => (
              <button key={code} className={activeDomain === code ? "on" : ""} onClick={() => setActiveDomain(code)} title={DOMAIN_LABELS[code]}>{code}</button>
            ))}
          </div>
          <div className="osl-list">
            {filtered.map((c) => (
              <button key={c.caseCode} className={"osl-case" + (sel?.caseCode === c.caseCode ? " on" : "")} onClick={() => setSelectedCode(c.caseCode)}>
                <span className="code">{c.caseCode}</span>
                <span className="osl-case-title">{c.title}</span>
                <span className="osl-case-meta">{c.stations.join(" + ")} · D{c.difficulty} · {c.accessTier}</span>
              </button>
            ))}
            {filtered.length === 0 && <div className="ph"><div className="ph-s">No cases match.</div></div>}
          </div>
        </aside>

        <main className="osl-stage">
          {!sel ? <div className="ph"><div className="ph-s">No case selected.</div></div> : (
            <>
              <div className="card osl-topline">
                <div>
                  <div className="osl-stationline code">{sel.stations.map((s) => DOMAIN_LABELS[s] || s).join(" / ")}</div>
                  <h2 className="osl-title">{sel.title}</h2>
                </div>
                <div className="osl-diff">D{sel.difficulty}</div>
              </div>

              <div className="osl-tc">
                <div className="osl-tc-block scenario">
                  <div className="eyebrow">{sel.isAppraisal ? "Abstract appraisal scenario" : "Clinical scenario"}</div>
                  <p className="ds-body">{sel.teachingCard.scenario}</p>
                </div>
                <div className="osl-tc-grid">
                  <div className="osl-tc-block err">
                    <div className="eyebrow">Common error</div>
                    <p className="ds-sm">{sel.teachingCard.commonError}</p>
                  </div>
                  <div className="osl-tc-block anchor">
                    <div className="eyebrow">Guideline anchor</div>
                    <p className="ds-sm">{sel.teachingCard.anchor}</p>
                  </div>
                </div>
              </div>

              {sel.appraisalPayload && <AppraisalReport a={sel.appraisalPayload} />}

              {!sel.appraisalPayload && sel.brief.scenario_text && (
                <details className="card osl-sec" open>
                  <summary><span className="eyebrow">Candidate brief</span><span className="osl-sum-meta code">{briefMeta}</span></summary>
                  <pre className="osl-brief">{sel.brief.scenario_text}</pre>
                </details>
              )}

              {!sel.appraisalPayload && sel.questions.length > 0 && (
                <div className="card osl-sec block">
                  <div className="eyebrow osl-sec-h">Examiner questions &amp; model answers</div>
                  {sel.questions.map((q, i) => (
                    <details key={q.question_id || i} className="osl-q" open={i === 0}>
                      <summary>
                        <span className="osl-q-n code">{q.question_id || `Q${i + 1}`}</span>
                        <span className="osl-q-stem">{q.question}</span>
                        <span className="osl-q-marks">{q.marks} marks</span>
                      </summary>
                      <div className="osl-q-body">
                        <div className="osl-ma">{q.model_answer}</div>
                        {q.distinction_addition && (
                          <div className="osl-dist"><b>Distinction:</b> {q.distinction_addition}</div>
                        )}
                        {q.mark_breakdown && Object.keys(q.mark_breakdown).length > 0 && (
                          <ul className="osl-mb">
                            {Object.values(q.mark_breakdown).map((m, k) => <li key={k}>{m}</li>)}
                          </ul>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              )}

              {!sel.appraisalPayload && (ms.total_marks || pvd.pass_candidate) && (
                <div className="card osl-sec block">
                  <div className="eyebrow osl-sec-h">Mark scheme</div>
                  {ms.total_marks && (
                    <div className="osl-marks">
                      <span className="pill">Total {ms.total_marks}</span>
                      <span className="pill ok">Pass {ms.pass_mark}</span>
                      <span className="pill">Merit {ms.merit_mark}</span>
                      <span className="pill ok">Distinction {ms.distinction_mark}</span>
                    </div>
                  )}
                  <div className="osl-cols">
                    <div>
                      <div className="osl-col-h">Pass candidate</div>
                      <ul>{asArray(pvd.pass_candidate).map((x, i) => <li key={i}>{x}</li>)}</ul>
                    </div>
                    <div>
                      <div className="osl-col-h">Distinction candidate also</div>
                      <ul>{asArray(pvd.distinction_candidate).map((x, i) => <li key={i}>{x}</li>)}</ul>
                    </div>
                  </div>
                </div>
              )}

              {!sel.appraisalPayload && sel.failTraps.length > 0 && (
                <div className="card osl-sec block">
                  <div className="eyebrow osl-sec-h">Things that fail candidates</div>
                  {sel.failTraps.map((t, i) => (
                    <div key={t.trap_id || i} className="osl-trap">
                      <div className="osl-trap-desc">{t.trap_description}</div>
                      {t.examiner_probe && <div className="osl-trap-probe"><b>Probe:</b> {t.examiner_probe}</div>}
                      {t.correct_anchor && <div className="osl-trap-anchor"><b>Correct:</b> {t.correct_anchor}</div>}
                    </div>
                  ))}
                </div>
              )}

              {sel.sources.length > 0 && (
                <div className="card osl-sec block">
                  <div className="eyebrow osl-sec-h">Sources</div>
                  <ol className="osl-sources">
                    {sel.sources.map((s, i) => {
                      // sources come in two shapes: {citation, recommendation_type, relevance}
                      // and the ADDITION-pool shape {authority, use, url}. Render either.
                      const label = s.citation || s.authority || s.title || s.source || ""
                      const meta = s.recommendation_type || s.use || s.relevance || ""
                      if (!label) return null
                      return (
                        <li key={s.doc_id || s.authority || i}><span className="ds-sm">{label}</span>{meta && <span className="osl-src-type code"> · {meta}</span>}</li>
                      )
                    })}
                  </ol>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

const styles = `
.osce-lib{ padding-bottom:56px; }
.osl-head{ display:flex; justify-content:space-between; align-items:flex-end; gap:24px; flex-wrap:wrap; }
.osl-stats{ display:flex; gap:1px; background:var(--line); border:1px solid var(--line); border-radius:var(--r-md); overflow:hidden; }
.osl-stats div{ background:var(--surface); padding:14px 20px; text-align:center; min-width:78px; }
.osl-stats b{ display:block; font-family:var(--font-serif); font-size:30px; color:var(--primary); line-height:1; }
.osl-stats span{ display:block; margin-top:5px; font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-3); }
.osl-notice{ margin:0 0 16px; padding:11px 14px; background:var(--warn-weak); border:1px solid #E6D6BE; color:var(--warn); font-size:13px; border-radius:var(--r-sm); }
.osl-orient{ margin:0 0 20px; padding:20px 22px; display:flex; flex-direction:column; gap:16px; }
.osl-orient-main{ display:grid; grid-template-columns:minmax(0,1fr) auto; gap:22px; align-items:start; }
@media(max-width:760px){ .osl-orient-main{ grid-template-columns:1fr; } }
.osl-orient-title{ font-family:var(--font-serif); font-size:24px; line-height:1.15; margin:6px 0 8px; color:var(--ink); }
.osl-orient-main p{ margin:0; max-width:780px; }
.osl-orient-facts{ display:grid; grid-template-columns:repeat(2,92px); gap:1px; background:var(--line); border:1px solid var(--line); border-radius:var(--r-md); overflow:hidden; }
.osl-orient-facts div{ background:var(--paper-sunk); padding:12px 10px; text-align:center; min-height:70px; }
.osl-orient-facts b{ display:block; font-family:var(--font-serif); font-size:28px; line-height:1; color:var(--primary); }
.osl-orient-facts span{ display:block; margin-top:6px; font-size:10px; line-height:1.25; letter-spacing:.06em; text-transform:uppercase; color:var(--ink-3); }
.osl-orient-grid{ display:grid; grid-template-columns:minmax(0,1.35fr) minmax(260px,.65fr); gap:14px; }
@media(max-width:900px){ .osl-orient-grid{ grid-template-columns:1fr; } }
.osl-orient-block{ border:1px solid var(--line); background:var(--surface-2); border-radius:var(--r-md); padding:14px 15px; }
.osl-block-h{ font-size:12px; font-weight:700; color:var(--ink); margin-bottom:10px; }
.osl-station-grid{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
@media(max-width:620px){ .osl-station-grid{ grid-template-columns:1fr; } }
.osl-station-chip{ min-height:46px; border:1px solid var(--line); background:var(--surface); border-radius:var(--r-sm); padding:8px 10px; font-size:12.5px; line-height:1.3; color:var(--ink-2); }
.osl-station-chip span{ display:inline-block; margin-right:7px; font-family:var(--font-mono); font-size:11px; font-weight:700; color:var(--primary); }
.osl-orient-list{ margin:0; padding-left:18px; display:flex; flex-direction:column; gap:7px; }
.osl-orient-list li{ font-size:13px; line-height:1.45; color:var(--ink-2); }
.osl-orient-meta{ margin-top:12px; font-size:11px; color:var(--ink-3); }
.osl-orient-sections{ display:flex; flex-wrap:wrap; gap:7px; }
.osl-orient-sections span{ border:1px solid var(--line); background:var(--primary-weak); color:var(--primary); border-radius:999px; padding:5px 9px; font-size:11.5px; line-height:1.2; }
.osl-shell{ display:grid; grid-template-columns:316px minmax(0,1fr); gap:22px; align-items:start; }
@media(max-width:900px){ .osl-shell{ grid-template-columns:1fr; } }
.osl-rail{ position:sticky; top:74px; }
@media(max-width:900px){ .osl-rail{ position:static; } }
.osl-search{ width:100%; height:38px; border:1px solid var(--line-strong); border-radius:var(--r-sm); padding:0 12px; font:inherit; background:var(--surface); }
.osl-search:focus{ outline:none; border-color:var(--primary); box-shadow:var(--sh-focus); }
.osl-tabs{ display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin:10px 0; }
.osl-tabs button{ height:30px; border:1px solid var(--line); background:var(--paper-sunk); color:var(--ink-3); font-size:12px; font-weight:600; border-radius:var(--r-xs); }
.osl-tabs button.on{ background:var(--primary); color:#fff; border-color:var(--primary); }
.osl-list{ display:flex; flex-direction:column; gap:8px; max-height:calc(100vh - 200px); overflow:auto; padding-right:4px; }
.osl-case{ display:flex; flex-direction:column; gap:3px; text-align:left; border:1px solid var(--line); background:var(--surface); border-radius:var(--r-md); padding:12px 13px; cursor:pointer; }
.osl-case.on{ border-color:var(--primary); background:var(--primary-weak); }
.osl-case-title{ font-weight:600; font-size:13.5px; line-height:1.32; color:var(--ink); }
.osl-case-meta{ font-size:11.5px; color:var(--ink-3); }
.osl-stage{ display:flex; flex-direction:column; gap:16px; }
.osl-topline{ display:flex; justify-content:space-between; gap:20px; align-items:flex-start; padding:22px 24px; }
.osl-stationline{ font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--primary); }
.osl-title{ font-family:var(--font-serif); font-size:26px; line-height:1.12; color:var(--ink); margin:7px 0 0; }
.osl-diff{ flex:none; width:46px; height:46px; display:grid; place-items:center; background:var(--ink); color:#fff; border-radius:var(--r-sm); font-family:var(--font-mono); font-weight:600; }
.osl-tc{ display:flex; flex-direction:column; gap:12px; }
.osl-tc-grid{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
@media(max-width:680px){ .osl-tc-grid{ grid-template-columns:1fr; } }
.osl-tc-block{ background:var(--surface); border:1px solid var(--line); border-radius:var(--r-md); padding:16px 18px; }
.osl-tc-block .eyebrow{ margin-bottom:7px; }
.osl-tc-block.scenario{ background:var(--primary-weak); border-color:var(--primary-weak-2); }
.osl-tc-block.err{ background:var(--danger-weak); border-color:#E6C9C4; }
.osl-tc-block.anchor{ background:var(--ok-weak); border-color:#C9E2D5; }
.osl-tc-block p{ margin:0; }
.osl-sec{ padding:18px 22px; }
.osl-sec.block{ display:block; }
.osl-sec-h{ margin-bottom:12px; }
.osl-sec summary{ cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:12px; }
.osl-sum-meta{ font-size:11.5px; color:var(--ink-3); }
.osl-brief{ white-space:pre-wrap; font-family:var(--font-sans); font-size:13.5px; line-height:1.65; color:var(--ink-2); background:var(--paper-sunk); border:1px solid var(--line); border-radius:var(--r-sm); padding:14px 16px; margin:12px 0 0; }
.osl-q{ border-top:1px solid var(--line-faint); padding:12px 0; }
.osl-q:first-of-type{ border-top:none; }
.osl-q summary{ cursor:pointer; display:flex; gap:10px; align-items:baseline; list-style:none; }
.osl-q summary::-webkit-details-marker{ display:none; }
.osl-q-n{ flex:none; color:var(--primary); font-size:12px; }
.osl-q-stem{ flex:1; font-weight:600; font-size:14.5px; color:var(--ink); line-height:1.4; }
.osl-q-marks{ flex:none; font-family:var(--font-mono); font-size:11.5px; color:var(--ink-3); }
.osl-q-body{ padding:10px 0 4px 30px; }
.osl-ma{ font-size:14px; line-height:1.65; color:var(--ink-2); white-space:pre-wrap; }
.osl-dist{ margin-top:10px; font-size:13px; line-height:1.6; color:var(--ink-2); background:var(--surface-2); border-left:3px solid var(--primary); padding:9px 12px; border-radius:0 var(--r-sm) var(--r-sm) 0; }
.osl-dist b{ color:var(--primary); }
.osl-mb{ margin:10px 0 0; padding-left:18px; }
.osl-mb li{ font-size:12.5px; line-height:1.5; color:var(--ink-3); }
.osl-marks{ display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; }
.osl-marks .pill{ background:var(--paper-sunk); color:var(--ink-2); border:1px solid var(--line); }
.osl-marks .pill.ok{ background:var(--ok-weak); color:var(--ok); border-color:#C9E2D5; }
.osl-cols{ display:grid; grid-template-columns:1fr 1fr; gap:18px; }
@media(max-width:680px){ .osl-cols{ grid-template-columns:1fr; } }
.osl-col-h{ font-size:12px; font-weight:700; color:var(--ink); margin-bottom:8px; }
.osl-cols ul{ margin:0; padding-left:18px; display:flex; flex-direction:column; gap:6px; }
.osl-cols li{ font-size:13px; line-height:1.5; color:var(--ink-2); }
.osl-trap{ border-left:3px solid var(--danger); background:var(--surface-2); border-radius:0 var(--r-sm) var(--r-sm) 0; padding:11px 14px; margin-bottom:10px; }
.osl-trap:last-child{ margin-bottom:0; }
.osl-trap-desc{ font-weight:600; font-size:13.5px; color:var(--ink); }
.osl-trap-probe,.osl-trap-anchor{ font-size:12.5px; line-height:1.55; color:var(--ink-2); margin-top:5px; }
.osl-trap-anchor b{ color:var(--ok); }
.osl-sources{ margin:0; padding-left:20px; display:flex; flex-direction:column; gap:9px; }
.osl-sources li{ line-height:1.5; }
.osl-src-type{ color:var(--ink-3); font-size:11px; }
`;
