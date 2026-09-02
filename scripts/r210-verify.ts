// R210 功能验证（bun 直跑，真实网络仅 T4 内联测试走本地 dev server 代理）。
import { computeDruggabilityScores, parseDruggabilityFromScores } from '../src/lib/druggability.ts';
import { extractMarkdownImageUrls, fetchableImageUrl, arrayBufferToDataUri, decodeProxyUrlsInMarkdown, hasInlineableImages, inlineReportImages } from '../src/lib/report-export-images.ts';
import { buildPriorChaptersDigest, buildPriorContextBlock } from '../src/lib/eval-dsh/agent.ts';

let pass = 0;
let fail = 0;
function t(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`); }
}

// ── T1: computeDruggabilityScores ─────────────────────────────────────
console.log('T1 computeDruggabilityScores');
{
  // P69905 真实形态（run B）：cov 100 / pdb 80 / blast 0 / lit 20 / bestRes 1.3 / ligandRich 80 / methods 3 / overall 7
  const d = computeDruggabilityScores({ coverage: 100, pdbCount: 80, blastCount: 0, literatureCount: 20, bestResolution: 1.3, ligandRichCount: 80, methodDiversity: 3, overallMethodScore: 7 });
  t('P69905 形态：structure=100', d.structure === 100, JSON.stringify(d));
  t('P69905 形态：topology=100', d.topology === 100);
  t('P69905 形态：feasibility=85（50+30+5? 检验：7×5=35 + 30 + 20 = 85）', d.feasibility === 85);
  t('P69905 形态：function=75（文献 40 + 配体 35 + blast 0）', d.function === 75);
  t('P69905 形态：overall=90（100×.3+75×.3+100×.2+85×.2=90）', d.overall === 90);
  t('四维全部 0-100 且整数', [d.structure, d.function, d.topology, d.feasibility, d.overall].every(v => Number.isInteger(v) && v >= 0 && v <= 100));
}
{
  // 零数据形态：无结构无文献
  const d = computeDruggabilityScores({ coverage: 0, pdbCount: 0, blastCount: 0, literatureCount: 0, bestResolution: null, ligandRichCount: 0, methodDiversity: 1, overallMethodScore: 1 });
  t('零数据：全 0（overallMethod 1 → feasibility 5）', d.structure === 0 && d.topology === 10 && d.feasibility === 5 && d.function === 0, JSON.stringify(d));
  // methodDiversity=1 → topology 10（单方法基线）
}
{
  // 边界钳制：超大输入不越界
  const d = computeDruggabilityScores({ coverage: 500, pdbCount: 9999, blastCount: 9999, literatureCount: 9999, bestResolution: 0.5, ligandRichCount: 9999, methodDiversity: 9, overallMethodScore: 99 });
  t('超大输入：全部钳在 0-100', [d.structure, d.function, d.topology, d.feasibility, d.overall].every(v => v <= 100));
}
{
  // 分辨率分档（pdbCount=1 → 数量分项 = round(sqrt(1/20)*30) = 7）
  const mk = (r: number | null) => computeDruggabilityScores({ coverage: 0, pdbCount: 1, blastCount: 0, literatureCount: 0, bestResolution: r, ligandRichCount: 0, methodDiversity: 1, overallMethodScore: 1 });
  t('res 1.3 → 结构 37（0+7+30）', mk(1.3).structure === 37);
  t('res 2.2 → 结构 29（0+7+22）', mk(2.2).structure === 29);
  t('res 4.0 → 结构 14（0+7+7）', mk(4.0).structure === 14);
  t('res 6.0 → 结构 7（分辨率 0 分）', mk(6.0).structure === 7);
  t('res null → 分辨率 0 分（结构 7 = 数量分项）', mk(null).structure === 7);
}

// ── T2: parseDruggabilityFromScores ───────────────────────────────────
console.log('T2 parseDruggabilityFromScores');
{
  const v2 = JSON.stringify({ 'X-ray': { score: 10, max: 10 }, 'Overall': { score: 7, max: 10 }, druggability: { structure: 100, function: 75, topology: 100, feasibility: 85, overall: 90 } });
  const p = parseDruggabilityFromScores(v2);
  t('v2 嵌套形态：四维+总分读取', p?.overall === 90 && p?.structure === 100 && p?.function === 75);
  const legacy = JSON.stringify({ structure: 78, function: 65, topology: 82, feasibility: 71, overall: 74 });
  const p2 = parseDruggabilityFromScores(legacy);
  t('legacy 顶层五键形态：读取', p2?.overall === 74 && p2?.feasibility === 71);
  const methodOnly = JSON.stringify({ 'X-ray': { score: 10, max: 10 }, 'Overall': { score: 7, max: 10 } });
  t('纯方法学键（旧行回填前）→ null', parseDruggabilityFromScores(methodOnly) === null);
  t('null/坏 JSON → null', parseDruggabilityFromScores(null) === null && parseDruggabilityFromScores('not json') === null);
  t('v2 带小数/越界 → 钳整数', parseDruggabilityFromScores(JSON.stringify({ druggability: { structure: 120.4, function: -5, topology: 66.6, feasibility: 50, overall: 60 } }))?.structure === 100);
}

// ── T3: buildPriorChaptersDigest / buildPriorContextBlock ────────────
console.log('T3 前文章节去重上下文');
{
  const chapters = [
    { id: 'summary', title: '执行摘要', ok: true, content: '## 执行摘要\n\n血红蛋白 α 亚基（HBA）结构覆盖完整，共 80 个 PDB 结构，最佳分辨率 1.30Å（7DY4）。\n\n### §1.1 数据总览\n内容...\n\n### §1.2 评分\n内容2...' },
    { id: 'references', title: '参考文献', ok: true, content: '## 参考文献\n\n1. PMID 12345\n2. PMID 67890' },
    { id: 'pathway', title: '通路机制', ok: true, content: '## 通路机制\n\n氧结合诱导 T→R 态转换，涉及铁原子配位变化。\n\n### §3.1 别构机制\nxxx' },
    { id: 'failed-chapter', title: '失败章', ok: false, content: '' },
  ];
  const digest = buildPriorChaptersDigest(chapters);
  t('摘要含第 1 章核心句', digest.includes('第 1 章「执行摘要」') && digest.includes('80 个 PDB 结构'));
  t('references 章不列条目', !digest.includes('PMID 12345') && !digest.includes('第 2 章「参考文献」核心'));
  t('章序号含 references（pathway 为第 3 章）', digest.includes('第 3 章「通路机制」'));
  t('ok=false 章不列', !digest.includes('失败章'));
  t('小节题收录（§1.1 数据总览）', digest.includes('§1.1 数据总览'));
  t('图片行不作开篇小结', buildPriorChaptersDigest([{ id: 'x', title: 'T', ok: true, content: '## T\n\n![图](http://x)\n\n正文首段在这里。' }]).includes('正文首段在这里'));
  const block = buildPriorContextBlock(chapters);
  t('块含标题与去重要求', block.includes('前文章节概览') && block.includes('去重要求') && block.includes('详见第 N 章'));
  t('空 chapters → 空块', buildPriorContextBlock([]) === '');
  t('全部失败/引用 → 空块', buildPriorContextBlock([{ id: 'references', title: '参考文献', ok: true, content: '## 参考文献' }]) === '');
  // 超长截断：20 章 × 长内容
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, title: `章${i}`, ok: true, content: `## 章${i}\n\n${'很长的开篇内容。'.repeat(40)}\n\n### 小节\n内容` }));
  const capped = buildPriorChaptersDigest(many);
  t('超长摘要截断（≤2600 chars 含截断标记）', capped.length <= 2600 && capped.includes('其余前文章节从略'));
}

// ── T4: report-export-images（纯函数 + 真实代理内联）──────────────────
console.log('T4 report-export-images');
{
  const md = '# 报告\n\n![图1](/api/figure-proxy?url=https%3A%2F%2Fcdn.rcsb.org%2Fimages%2Fstructures%2F9bcj_assembly-1.jpeg)\n\n正文。\n\n![图2](https://cdn.rcsb.org/images/structures/7dy4_assembly-1.jpeg "标题")\n\n![data 图](data:image/png;base64,AAAA)\n';
  const urls = extractMarkdownImageUrls(md);
  t('提取 3 个唯一 URL', urls.length === 3, JSON.stringify(urls));
  t('代理形原样可 fetch', fetchableImageUrl('/api/figure-proxy?url=https%3A%2F%2Fx.png') === '/api/figure-proxy?url=https%3A%2F%2Fx.png');
  t('https 绝对地址 → 走代理', fetchableImageUrl('https://a.com/b.png') === '/api/figure-proxy?url=' + encodeURIComponent('https://a.com/b.png'));
  t('data: 不入内联流', fetchableImageUrl('data:image/png;base64,AA') === null);
  t('http: 不入内联流', fetchableImageUrl('http://a.com/b.png') === null);
  const decoded = decodeProxyUrlsInMarkdown(md);
  t('md 反代理化：代理形还原为原始 https', decoded.includes('](https://cdn.rcsb.org/images/structures/9bcj_assembly-1.jpeg)') && !decoded.includes('/api/figure-proxy'));
  t('hasInlineableImages true', hasInlineableImages(md) === true);
  t('无图 md false', hasInlineableImages('纯文本报告') === false);
  const buf = new TextEncoder().encode('hello').buffer;
  const uri = arrayBufferToDataUri(buf, 'image/png');
  t('arrayBuffer → data URI 基本正确', uri.startsWith('data:image/png;base64,') && atob(uri.split(',')[1]) === 'hello');
}

// T4b: 真实网络 —— 走本地 dev server（3000）的 figure-proxy 取一张真实 RCSB 图内联。
console.log('T4b inlineReportImages 真实代理（dev server :3000）');
{
  const md = '![RCSB 图](/api/figure-proxy?url=https%3A%2F%2Fcdn.rcsb.org%2Fimages%2Fstructures%2F9bcj_assembly-1.jpeg)';
  try {
    const res = await inlineReportImages(md, undefined, { baseUrl: 'http://localhost:3000' });
    t('真实图内联成功且产出 data URI', res.inlined === 1 && res.markdown.startsWith('![RCSB 图](data:image/'), `inlined=${res.inlined} failed=${res.failed} head=${res.markdown.slice(0, 40)}`);
    t('data URI 体量合理（>1KB）', res.markdown.length > 1000);
  } catch (e) {
    t('真实图内联成功且产出 data URI', false, String(e));
  }
}

// ── T5: repairFigureUrls 代理形突变修复（R207 回归 + R210 修复）─────────
console.log('T5 repairFigureUrls（代理形 URL 自愈）');
{
  const { repairFigureUrls } = await import('../src/lib/eval-dsh/figures.ts');
  const { proxyFigureUrl } = await import('../src/lib/figure-view.ts');
  const good = [
    'https://cdn.rcsb.org/images/structures/9szw_assembly-1.jpeg',
    'https://cdn.rcsb.org/images/structures/28od_assembly-1.jpeg',
    'https://cdn.rcsb.org/images/structures/9tqd_assembly-1.jpeg',
  ];
  const allowed = good.map(u => proxyFigureUrl(u));
  // 真实 E2E 实证形态：LLM 把 structures%2F9szw 抄丢 2F → structures%9szw。
  const mutated = '/api/figure-proxy?url=https%3A%2F%2Fcdn.rcsb.org%2Fimages%2Fstructures%9szw_assembly-1.jpeg';
  const content = [
    `## 成药性评估`,
    `![PDB 28OD — ok](/api/figure-proxy?url=https%3A%2F%2Fcdn.rcsb.org%2Fimages%2Fstructures%2F28od_assembly-1.jpeg)`,
    `![PDB 9SZW — mutated](${mutated})`,
    `![幻觉](/api/figure-proxy?url=https%3A%2F%2Fevil.example.com%2Ffake.png)`,
    `正文段落。`,
  ].join('\n');
  const rep = repairFigureUrls(content, allowed);
  t('突变代理 URL 被纠正（fixed=1）', rep.fixed === 1, `fixed=${rep.fixed} removed=${rep.removed}`);
  t('纠正后含正确代理 URL（可渲染）', rep.content.includes(allowed[0]));
  t('幻觉代理 URL 被整图剔除（removed=1）', rep.removed === 1 && !rep.content.includes('evil.example.com'));
  t('正确 URL 原样保留', rep.content.includes(allowed[1]));
  t('修复后 includes 判定命中 → 不再触发章末补挂重复', rep.content.includes(proxyFigureUrl(good[0])) && !rep.content.includes(mutated));
  // 裸 https 形向后兼容（旧报告/外部内容）
  const rawContent = `![raw ok](https://cdn.rcsb.org/images/structures/28od_assembly-1.jpeg)\n![raw mut](https://cdn.rcsb.org/images/structures/28od_assembly-2.jpeg)`;
  const rep2 = repairFigureUrls(rawContent, good);
  t('裸 https 形照常工作（fixed=1）', rep2.fixed === 1 && rep2.content.includes(good[1]) && !rep2.content.includes('_assembly-2'));
}

console.log(`\n结果：${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
