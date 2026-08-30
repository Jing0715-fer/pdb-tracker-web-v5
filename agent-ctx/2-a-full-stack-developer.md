# Task 2-a — DSH 模式后端（target-evaluation module）

## Status: DONE (verified end-to-end)

## What was built
- `src/lib/eval-dsh/section-library.ts` (363 lines): 19-section library (id/titleZh/titleEn/purpose/contentSpec/dataHints/figureHint/fixed/min-maxWords), `getSection()`, `outlineRules()` (5-9 sections; summary first; question_focus 2nd; references last-1; conclusion last).
- `src/lib/eval-dsh/collect.ts` (424 lines): `collectEvaluationData(uniprot, opts, emit)` mirroring classic collection via shared libs (fetchUniprotMeta / fetchPdbIdsForUniprot / fetchPdbEntryDetails / fetchUniprotSequence+runBlast / efetch); progress 4→56%; heuristic coverage min(100, n*5); BLAST auto-run when directPdbCount<5 || coverage<50 (forceBlast/skipBlast override); scores min(10, round(sqrt(n)*2)); literature top-N by IF desc w/ 200-char abstracts; raw-SQL upsert Evaluation + delete/insert EvaluationPdbStructure + EvaluationBlastResult (dedup by pdbId, isParalog ≥95%). Caps: PDB≤200, BLAST≤100, lit≤200.
- `src/lib/eval-dsh/figures.ts` (343 lines): `ReportFigure` interface; `collectRcsbFigures` (≤3 representative liganded+best-res, HEAD-verify CDN `..._assembly-1.jpeg`, per-figure section attachment: liganded→ligand_binding, complex-title→interactions, else structure_quality, fallback pdb_analysis); `searchWebFigures` (≤2 queries, z-ai CLI execFile 150s, ≤4 results/query, download ≤6MB image/* 20s → base64 → createVision 55s + 1 retry, strict Chinese JSON judge, cap 2 verified TOTAL, never throws).
- `src/lib/eval-dsh/agent.ts` (747 lines): `runDshEvaluation` 6 phases — A collect (→56%), B relevance JSON `{questionRestated, findings, keyInsights, dataGaps, figureQueries}` (emit `dshRelevance`), C outline JSON + local repair (drop unknown/dupes, force positions, clamp 9; emit `dshOutline {sections,total}`), D figures, E chapters (per-section filtered data context by dataHints; validate ≥150 chars + H2 title + no placeholder; normalize headings; ≤2 retries + 1 rescue; events `chapter-<id>` / `chapter_done` with chapter/chapterIndex/chapterTotal/chapterContent/chapterError/chapterDurationMs), F assemble (header + chapters + `## 附：报告配图` gallery; `db.skillEvaluationReport.create` incl. mode/outline/figures; raw-SQL UPDATE Evaluation.report).
- `src/app/api/evaluations/run-dsh/route.ts` (150 lines): POST SSE; validation (uniprot regex, question 8-1000 → 400); clamps; applySchemaCompat; runDshEvaluation; done payload {mode:'dsh', uniprot, uniprotInfo, question, relevance, outline, figures, report{...chapters}, directPdbCount, blastHitCount, coverage, scores, dbSaved, durationMs}; SkillRunRecord raw-SQL insert (module 'eval', 'DSH：…' summary, details+resultJson JSON, NDJSON log).
- Schema: schema-compat guarded ALTERs (mode TEXT NOT NULL DEFAULT 'classic', outline TEXT, figures TEXT) + prisma/schema.prisma fields + `bun run db:push` (already in sync, client regenerated).
- `/api/eval-report-file/[uniprotId]`: returns mode/outline/figures (JSON.parse'd, backward compatible — missing/legacy → 'classic'/omitted keys).

## SSE contract for frontend (Task 2-b)
- progress frames: stages init/collect/uniprot-meta/rcsb-pdbs/blast/score/pubmed/write-db/relevance (extra `dshRelevance`)/outline (extra `dshOutline {sections:[{id,title,focus}],total}`)/figure-rcsb|figure-web (extra `dshFigure {kind,url,caption,pdbId?,source?,sectionId,status,vlmReason?}`)/chapter-<id>/chapter_done (chapter/chapterIndex/chapterTotal/chapterContent/chapterError?/chapterDurationMs)/figures/assemble.
- done frame: see route payload above (report.chapters[] = {id,title,ok,content,attempts,error?}).

## Verification evidence (2026-08-29)
- Smoke: `POST /api/evaluations/run-dsh {"uniprot":"P69905","question":"该蛋白作为小分子药物靶点的成药性如何？现有结构覆盖哪些状态？","llm":{"provider":"zai"}}` → 200 in 2.7min. 54 progress + 1 done frames. 9/9 chapters (glm-4.6), 8814-char report, outline 9 sections (summary→…→conclusion), 5 verified figures (3 RCSB HEAD-verified + 2 web VLM-verified, 2 web rejected w/ scientific reasons), references format `- [PMID] 标题 — 期刊 (年)`, inline figure embeds inside structure_quality + druggability chapters.
- DB (active = db/my-pdb-tracker.db per .hermes/db-config.json): SkillEvaluationReport row {uniprotId:P69905, mode:'dsh', report 8814, outline 768 (valid JSON), figures 1364 (valid JSON, 3 rcsb + 2 web), llmProvider zai, glm-4.6}; Evaluation.report 8814; EvaluationPdbStructure 80 rows; SkillRunRecord module=eval 'DSH：Hemoglobin subunit alpha · 80 PDB · overall=7/10 · 9/9 章 · LLM ✓' log 21818 chars.
- eval-report-file/P69905 → mode 'dsh' + parsed outline/figures. 400s for invalid uniprot/question.
- lint: scoped eslint 0/0 on all task files; tsc 124 errors = pre-existing baseline (zero new, none in task files).

## Notes / deviations
- sqlite3 CLI absent in sandbox → DB verified via bun:sqlite (equivalent).
- `db:push` targets .env DATABASE_URL (custom.db); the runtime-active DB (my-pdb-tracker.db via db-config.json) gets the columns via the route's applySchemaCompat guarded ALTERs — both verified to have mode/outline/figures.
- Files partially authored in an interrupted prior session; this session completed, corrected (figure section attachment per spec, chapter_done stage naming + client `chapter` field contract, 9-col PDB table header, broader placeholder validation) and fully verified them.
- DO NOT touch: src/app/api/evaluations/run/route.ts, src/components/**, src/lib/i18n/**, src/lib/markdown-renderer.ts (frontend agent's domain).
