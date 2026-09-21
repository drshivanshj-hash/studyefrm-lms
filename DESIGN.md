# StudyEFRM — Design System

Aesthetic: **"Clinical Registry / Academic Ledger."** Calm authority of a medical journal
crossed with a precise data registry. Serif masthead · technical sans for dense data ·
mono for competency codes. **No gradients, no emoji, no toy roundness.** Status is neutral
slate, never alarmist — "in production" is calm, not red.

All values live as CSS custom properties in `src/styles/colors_and_type.css`. **Never hardcode
a colour/size — use a token.**

## Tokens (quick reference)
| Group | Tokens |
|---|---|
| Surfaces | `--paper` (app bg) · `--paper-sunk` (wells/zebra) · `--surface` (cards) · `--surface-2` (hover) |
| Text | `--ink` › `--ink-2` › `--ink-3` › `--ink-4` (primary → faint) |
| Lines | `--line` · `--line-strong` (inputs) · `--line-faint` (internal dividers) |
| Brand / trace | `--primary` pine (ATCRM/EFRM) · `--root` slate (MRCOG) · `--authority` indigo (guideline) — each has `-weak` / `-ink` |
| Status | `--ok` · `--warn` · `--danger` (+`-weak`) · `--inprod` neutral slate |
| Type | `--font-serif/sans/mono` (IBM Plex) · `--fs-display…--fs-micro` · semantic classes `.ds-h1….ds-code` |
| Space / radius | `--sp-1…--sp-20` (4px base) · `--r-xs…--r-pill` |
| Elevation / motion | `--sh-1…--sh-3` · `--sh-focus` · `--dur` · `--ease` |

## Core components

### Button — `.btn`
| Variant | Class | Use when |
|---|---|---|
| Primary | `.btn.primary` | the main action on a view |
| Secondary | `.btn.secondary` | supporting action |
| Ghost | `.btn.ghost` | low-emphasis / inline |
| Small | add `.sm` | dense rows, cards |

**States:** default · hover (darken) · **disabled** (`disabled` attr) · **focus** (ring via `--sh-focus` / outline). *Missing:* a `loading` state — add a spinner + disable for async actions.
**A11y:** real `<button>`; gets a visible focus ring (global `:focus-visible` rule in `index.css`).

### Input — `.osl-search`, `.magic input`, `.gate-input`
Single style: 1px `--line-strong` border, `--r-sm`, focuses to `--primary` + `--sh-focus`.
**States:** default · focus. *Missing:* an **error** state (red border + helper text) — add when forms validate.

### Card — `.card` (+ `.hoverable`, `.domcard`, `.cur-card`, `.reader-section`)
Container: `--surface`, 1px `--line`, `--r-md`, `--sh-1`. `.hoverable` lifts to `--sh-2` on hover.
**Clickable cards/rows** (domain cards, line rows): spread the **`clickable(onClick)`** helper from
`components/Primitives` — it adds `role="button"`, `tabIndex`, and Enter/Space activation, and the
global focus rule shows a ring. **Never** put a bare `onClick` on a `<div>` (keyboard users can't reach it).

### Pill / Badge — `.pill`, `.chip`, `.kbadge`
| Pill | Meaning |
|---|---|
| `.pill.registry` | registry complete (pine) |
| `.pill.inprod` | content in production (neutral slate — NOT a warning) |
| `.pill.ok` / `.pending` | approved / pending status |
| `.chip` | guideline anchor (indigo, mono source tag) |
| `.kbadge` | competency kind (Knowledge/Skill/Attitude/Awareness) |

### TraceBlock — the signature component (`components/Primitives`)
The brand idea: a competency's three (now four) "addresses". Renders
**MRCOG root → EBCOG·PACT → ATCRM·EFRM → Guideline**. Pass `root`, `line`, `guideline`, optional `pact`.
Unmapped layers render a calm "Mapping not yet seeded" state, never an error.
`orientation="row"` (desktop) | `"col"` (stacked/mobile).

### Reader (two patterns)
- **Module reader** (`ModuleReader`): left **step rail** + **progress bar** + main panel; steps = Overview → sections → Self-test (interactive quiz) → References.
- **OSCE case** (`StudyEFRMOsceCaseLibrary`): teaching card → candidate brief → examiner Q&A (model answer + distinction) → mark scheme → fail-traps → sources. This is the locked rich shape (`full_analysis` JSON).

## States the system standardises
| State | Pattern |
|---|---|
| Loading | `<div className="ph"><div className="ph-s">Loading…</div></div>` |
| Error | same `.ph-s` with the message |
| Empty / not-yet-produced | `.ph.prod` panel + `.pill.inprod` ("in production", neutral) |
| Gated (signed-in, pending) | `Waitlist` screen (`.gate`) |

## Accessibility rules (enforced)
- Every interactive surface is a `<button>` or carries `clickable()` (focusable + keyboard-activatable).
- Visible focus ring on `:focus-visible` (global, in `index.css`); mouse users keep the clean look.
- Muted text uses `--ink-3` (darkened to ~WCAG AA); don't go lighter than `--ink-3` for text that must be read.
- Mono `--font-mono` only for codes/IDs; never for running prose.
