import { db } from './src/lib/db.ts';
const r = await db.$queryRaw`SELECT report FROM SkillEvaluationReport WHERE uniprotId='P69905' ORDER BY createdAt DESC LIMIT 1`;
const report = (r as any)[0].report as string;
const lines = report.split('\n').filter(l => l.trim().startsWith('!['));
for (const l of lines) {
  const m = l.match(/\]\(([^)]+)\)/);
  if (m) {
    const proxied = m[1];
    const raw = decodeURIComponent(proxied.replace('/api/figure-proxy?url=', ''));
    console.log('RAW:', raw);
  }
}
await db.$disconnect();
