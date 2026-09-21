# StudyEFRM — web app

StudyEFRM is an exam-preparation platform for the European Fellowship in Reproductive Medicine
(EFRM) and the ATCRM subspecialty curriculum. Each syllabus line is a self-contained study module,
traced back through the curriculum layers it belongs to and anchored to the guidelines that govern it.

This repository contains the **web application only**. The educational content — manuscripts,
question banks, OSCE stations and evidence summaries — is authored in a separate private
pipeline and served from the database; none of it lives here.

## What the app does

- **Gated access.** Magic-link sign-in, then owner approval before any content is visible.
  Access is enforced in the database with row-level security, not only in the UI.
- **Curriculum browser.** Domains → syllabus lines, each showing its knowledge trace
  (MRCOG root → EBCOG PACT → ATCRM/EFRM line → guideline anchor).
- **Line modules.** Theory as a watermarked PDF manuscript reader, an evidence tab that sets
  guideline recommendations side by side (convergence and divergence), and linked
  cross-references to other lines where topics overlap.
- **Assessment in exam format.**
  - Single best answer, multiple true/false, and extended matching questions.
  - EMQs follow the exam software: one theme per page — lead-in and option list shown once,
    then each scenario answered from a dropdown; each scenario is marked separately.
  - Timed exam mode (auto-submits at zero) or untimed practice mode, flag-for-review and
    bookmarks, and a question overview for navigation.
  - Results with pacing, pass mark, the candidate's own history, and an aggregate cohort
    comparison (no other candidate is ever identified).
- **OSCE library.** Structured stations with candidate brief, examiner questions, model
  answers and a marking rubric.
- **Owner console.** Approval queue and content status.

## Stack

React 18 + Vite 5 · React Router 6 · Supabase (Postgres, Auth, Storage, row-level security) ·
pdf.js · hosted on Netlify.

## Run locally

```bash
npm install
cp .env.example .env.local   # then fill in the Supabase URL and anon (public) key
npm run dev
```

Build with `npm run build` (output in `dist/`).

Only the public anon key is used in the browser. Service-role keys are never used by this
app and must never be committed.

## Deployment

Netlify builds from this repository (`netlify.toml`): pushes to `main` publish the site, and
pull requests get a preview deploy for review before merging. `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` are set in the Netlify site's environment variables.

## Design

See [DESIGN.md](DESIGN.md) for the design system: tokens, type and component rules.

## Rights

© StudyEFRM. All rights reserved. The source is published for reference and portfolio
purposes; no licence to reuse it is granted.
