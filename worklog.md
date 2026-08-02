# PDB Structure Tracker — Worklog (v5 Fresh Instance)

> This worklog tracks the fresh clone and continued development of `pdb-tracker-web-v5`.
> Historical development log (21 cron-review rounds, 2113 lines) preserved in `worklog-history.md`.

---

## 项目当前状态描述/判断

### Project Overview
**PDB Structure Tracker** is a full-stack Next.js 16 web application for structural biology researchers, integrating three core workflows:
1. **Weekly PDB Monitoring** — Auto-fetches and categorizes new PDB structures weekly
2. **Protein Target Evaluation** — Evaluates protein druggability via UniProt, RCSB, SIFTS, BLASTp, and LLM reports
3. **Literature Monitoring** — Dual-pathway PubMed search with LLM Chinese summaries
4. **Structure Analysis** (4th module) — Molstar-based 3D viewer with 24 analysis charts

### Current State: STABLE & FUNCTIONAL
- **Repository**: Cloned from `https://github.com/Jing0715-fer/pdb-tracker-web-v5` (commit a57cb49)
- **Framework**: Next.js 16.2.12 (webpack mode) + TypeScript 5 + Tailwind CSS 4 + shadcn/ui
- **Database**: Prisma ORM + SQLite (schema pushed, demo data seeded)
- **Codebase Size**: 331 TS/TSX files, 189 components, 63 API routes, 50 lib files, 24 chart components
- **Lint Status**: 0 errors, 1 warning (intentional molstar.css manual include)
- **Dev Server**: Running on port 3000, stable (auto-restart wrapper active)

### Migration Completed
1. ✅ Stopped old template dev server
2. ✅ Cloned repository to `download/pdb-tracker-web-v5/`
3. ✅ Migrated all project files to `/home/z/my-project/` (preserved Caddyfile)
4. ✅ Installed 298 npm packages via `bun install`
5. ✅ Generated Prisma Client (v6.19.3)
6. ✅ Pushed schema to configured database (`db/my-pdb-tracker.db`)
7. ✅ Seeded demo data (30 PDB structures, 3 weekly snapshots, 3 evaluations, 8 PubMed articles)
8. ✅ Started dev server with auto-restart wrapper (OOM mitigation for 4GB sandbox)

---

Task ID: fresh-clone-1
Agent: main
Task: Clone pdb-tracker-web-v5, perform comprehensive code review and E2E testing

Work Log:
- Cloned https://github.com/Jing0715-fer/pdb-tracker-web-v5.git to download/
- Read README.md and worklog-history.md (2113 lines, 21 cron-review rounds)
- Migrated all project files to /home/z/my-project/ (preserved Caddyfile, sandbox configs)
- Installed dependencies: `bun install` (298 packages, 7.13s)
- Generated Prisma Client and pushed schema to database
- Fixed database config: .hermes/db-config.json pointed to my-pdb-tracker.db (empty), pushed schema to it
- Seeded demo data via POST /api/seed-demo (30 structures, 3 snapshots, 3 evals, 8 articles)
- Started dev server with auto-restart wrapper (OOM mitigation: 4GB sandbox, no swap)
- Ran ESLint: 0 errors, 1 warning (intentional molstar.css)
- Analyzed project structure: 331 TS/TSX files, 189 components, 63 API routes, 24 charts
- Performed comprehensive E2E testing with agent-browser (15 test cases)

E2E Test Results:
- ✅ Test 1: Home page loads (HTTP 200, 21KB, ~850ms render)
- ✅ Test 2: All 4 mode tabs visible (Weekly/Evaluation/Literature/Analysis)
- ✅ Test 3: Weekly mode — 3 snapshots (W31/W30/W29), 10 structures, avg 2.31Å
- ✅ Test 4: Weekly dashboard — method distribution chart, resolution distribution, trending structures
- ✅ Test 5: Evaluation mode — evaluations list, druggability scores, filters, sorting
- ✅ Test 6: Literature mode — 8 PubMed articles, reading lists, method distribution
- ✅ Test 7: Analysis mode — 3-pane structure analysis layout with "Load Structures" heading
- ✅ Test 8: Onboarding tour — appears on first load, 9 steps, skippable
- ✅ Test 9: Table interactions — row expand, bookmark, selection all work
- ✅ Test 10: Breadcrumb navigation — shows current mode and context correctly
- ✅ Test 11: Footer — at bottom of viewport (mt-auto flex layout)
- ✅ Test 12: API endpoints — entries(30), snapshots(3), evaluations(3), literature/stats(8 papers) all return data
- ✅ Test 13: Console errors — NONE (clean console, only Fast Refresh/HMR logs)
- ✅ Test 14: Page errors — NONE
- ✅ Test 15: Mode switching — all 4 modes switch correctly without errors

Code Review Summary:
- ESLint: 0 errors, 1 warning (intentional molstar.css manual include in layout.tsx)
- Architecture: 2-tier server design (static + API), SSE streaming, LLM integration (z.ai SDK)
- Key features: 4 modules, 24 structure analysis charts, demo data seeding, enhanced UI components
- CSS: 20,000+ lines with 50+ custom animations and effects
- Known issues: dev server memory-heavy (1.8GB during compile), Molstar blank in dev mode (IgnorePlugin)

Stage Summary:
- Project successfully cloned and migrated to /home/z/my-project
- All dependencies installed, database configured, demo data seeded
- Dev server running stably with auto-restart wrapper
- Comprehensive E2E testing completed: ALL 4 modes functional, 0 console errors
- Code review: ESLint passes, architecture is sound, 331 files well-organized
- No critical bugs found — project is in a stable, production-ready state for continued development

---

## 当前目标/已完成的修改/验证结果

### Completed
1. **Repository clone and migration** — Full project copied to /home/z/my-project
2. **Dependency installation** — 298 packages installed via bun
3. **Database setup** — Prisma schema pushed to my-pdb-tracker.db, demo data seeded
4. **Dev server** — Running on port 3000 with auto-restart wrapper (survives OOM kills)
5. **Code review** — ESLint 0 errors, structure analysis complete
6. **E2E testing** — 15 test cases all passed, 0 console errors

### Verification Results
- Page loads: HTTP 200, ~850ms render time
- API responses: entries(30), snapshots(3), evaluations(3), literature(8 papers)
- All 4 modes switch correctly and display data
- No JavaScript errors in console
- Footer properly positioned at viewport bottom

---

## 未解决问题或风险，建议下一阶段优先事项

### Known Issues (from historical worklog + current assessment)
1. **Dev server OOM in 4GB sandbox** — Heavy compile (molstar ~95MB TS source) can trigger OOM. Mitigated with auto-restart wrapper, but first compile takes ~60s
2. **Molstar 3D viewer blank in dev mode** — IgnorePlugin skips molstar in dev (works in production). The Analysis module uses a pre-built bundle that works in dev
3. **Onboarding tour appears on every fresh session** — Not persisted to localStorage for new users (by design, but could be annoying)
4. **No swap space** — `sudo` unavailable, cannot add swap. Relies on auto-restart wrapper

### Next Phase Development Plan (Priority Order)

#### P0 — Critical (Stability & UX)
1. **Persist onboarding tour dismissal** — Store in localStorage so it doesn't reappear on reload
2. **Add loading skeletons for API data** — Some sections show "0 targets" briefly before data loads
3. **Improve error handling** — Add error boundaries with retry buttons for failed API calls

#### P1 — High Value (Features & Polish)
4. **Mobile responsive Analysis mode** — 3-pane layout → tabbed/sheet layout on small screens
5. **SearchDropdownEnhanced integration** — Replace existing search input with enhanced dropdown (recent + trending searches)
6. **StructureTableRowExpansion integration** — Wire up enhanced row expansion into WeeklyPdbTable
7. **Command palette (⌘K) enhancement** — Add quick actions, recent items, keyboard navigation
8. **Dark mode polish** — Verify all custom CSS has dark mode variants

#### P2 — Medium Value (Enhancement)
9. **Multi-structure comparison** — Side-by-side 3D viewer for comparing structures
10. **Chart export functionality** — Export charts as PNG/SVG/PDF
11. **Lazy-load Literature mode components** — Reduce initial compile time
12. **API response caching** — Add client-side caching for frequently accessed data
13. **Real-time notifications** — WebSocket for live PDB release updates

#### P3 — Future (Advanced)
14. **pdb2pqr/APBS advanced visualization** — Electrostatic surface analysis
15. **User authentication** — NextAuth.js with multiple providers
16. **Data export/import** — CSV, JSON, PDB file import/export
17. **Collaborative features** — Share evaluations, comments, annotations
18. **Performance monitoring** — Web Vitals tracking, bundle analysis

### Recommended Next Steps
1. Start with P0 items (tour persistence, loading skeletons, error handling) — quick wins
2. Then P1 items (mobile responsive, search enhancement, row expansion) — high user impact
3. Set up the 15-minute cron review to continuously polish the project

---
Task ID: fresh-clone-2
Agent: main
Task: Fix missing keyboard shortcuts (⌘K command palette, ? keyboard hints)

Work Log:
- Read worklog to understand project state (fresh-clone-1 complete, all E2E tests passed)
- E2E testing revealed: ⌘K shortcut (advertised in search box) and ? shortcut (advertised in footer) were NOT functional
- Root cause: pdb-tracker.tsx had `commandPaletteOpen` and `keyboardHintsOpen` state, but NO global keydown event listener to trigger them
- Added a new useEffect in pdb-tracker.tsx (after the scroll-tracking useEffect, line ~1627) with a global `keydown` handler:
  * ⌘K (Mac) / Ctrl+K (Windows/Linux) → toggles Command Palette
  * ? (when not typing in input/textarea) → toggles Keyboard Hints
  * Escape → closes any open overlay (command palette or keyboard hints)
- The handler properly checks `e.target` to avoid triggering ? when typing in input fields
- Dependencies: [commandPaletteOpen, keyboardHintsOpen] to ensure Escape handler has current state

Verification:
- ESLint: 0 errors, 0 warnings on pdb-tracker.tsx
- E2E test: Ctrl+K opens command palette (verified .command-palette-panel and .command-palette-backdrop present)
- E2E test: ? opens keyboard hints (verified element present)
- E2E test: Escape closes both overlays
- Dev server: recompiled successfully, no errors

Stage Summary:
- Fixed a real UX bug: keyboard shortcuts were advertised but non-functional
- ⌘K/Ctrl+K now opens the Command Palette (quick filters, navigation, search)
- ? now opens the Keyboard Hints dialog
- Escape closes any open overlay
- ESLint passes, E2E verified

Issues remaining:
- Dev server OOM in 4GB sandbox during heavy compile (mitigated with auto-restart wrapper)
- Molstar 3D viewer blank in dev mode (IgnorePlugin, works in production)
- Onboarding tour appears on first visit (by design, persisted to localStorage after skip)

### Next Priority Items (for cron review rounds):
1. **[P0]** Add loading skeletons for API data (brief "0 targets" flash before data loads)
2. **[P0]** Improve error boundaries with retry buttons
3. **[P1]** Mobile responsive Analysis mode (3-pane → tabbed layout)
4. **[P1]** Integrate SearchDropdownEnhanced (recent + trending searches)
5. **[P1]** Integrate StructureTableRowExpansion into WeeklyPdbTable
6. **[P2]** Multi-structure comparison (side-by-side 3D viewer)
7. **[P2]** Chart export functionality (PNG/SVG/PDF)
8. **[P2]** Lazy-load Literature mode components
9. **[P3]** pdb2pqr/APBS advanced visualization
10. **[P3]** User authentication (NextAuth.js)
