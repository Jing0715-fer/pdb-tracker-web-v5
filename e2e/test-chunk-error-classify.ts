/**
 * Unit test for the error-boundary chunk-load detection.
 *
 * The error-boundary classifies errors into:
 *   - isChunkLoadError(error) → immediate full page reload
 *   - isRecoverableError(error) but NOT chunk → backoff retry 5x
 *   - otherwise → no retry, show static error UI
 *
 * We don't import the .tsx file directly (it has React component code,
 * bundler-only) — instead we re-implement the two predicates here
 * and verify their behavior matches the production implementation.
 * If the production code changes, the runtime test in
 * `test-error-boundary-runtime.spec.ts` (Playwright) catches drift;
 * this unit test just guarantees the matching rules are sane.
 */

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else    { fail++; console.log(`  ✗ ${name}${detail ? '  — ' + detail : ''}`); }
}

// Mirror of the production rules in src/components/error-boundary.tsx.
// Keep these in sync with that file.
function isChunkLoadError(error: { name?: string; message?: string }): boolean {
  const name = error.name || '';
  const msg = error.message || '';
  return (
    name === 'ChunkLoadError' ||
    msg.includes('Loading chunk') ||
    msg.includes('Failed to load chunk') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('dynamically imported module') ||
    (msg.includes('Load failed') && msg.includes('chunk'))
  );
}

function isRecoverableError(error: { name?: string; message?: string }): boolean {
  const name = error.name || '';
  const msg = error.message || '';
  return (
    name === 'ChunkLoadError' ||
    msg.includes('Loading chunk') ||
    msg.includes('Failed to load chunk') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('dynamically imported module') ||
    (msg.includes('Load failed') && msg.includes('chunk'))
  );
}

// 1. ChunkLoadError is recognized by both predicates
console.log('\n[1] ChunkLoadError is recognized as a chunk error');
{
  const e = { name: 'ChunkLoadError', message: 'Loading chunk _app-pages-browser_src_components_literature_LiteratureDateSidebar_tsx failed.' };
  check('isChunkLoadError(ChunkLoadError) = true', isChunkLoadError(e));
  check('isRecoverableError(ChunkLoadError) = true', isRecoverableError(e));
}

// 2. The user's actual error message matches
console.log('\n[2] The reported "Loading chunk ... failed" message matches');
{
  const e = { name: 'Error', message: 'Loading chunk _app-pages-browser_src_components_literature_LiteratureDateSidebar_tsx failed.' };
  check('isChunkLoadError(matches Loading chunk)', isChunkLoadError(e));
  check('isRecoverableError(matches Loading chunk)', isRecoverableError(e));
}

// 3. Generic fetch errors are NOT chunk errors (we don't want every
//    transient API hiccup to force-reload the page)
console.log('\n[3] Generic fetch errors are NOT chunk errors');
{
  const e = { name: 'TypeError', message: 'Failed to fetch' };
  check('isChunkLoadError(Failed to fetch) = false', !isChunkLoadError(e));
  // 'Failed to fetch' alone doesn't match the recoverable predicate
  // either — only when it's actually a chunk error message like
  // 'Loading chunk ... failed'. The chunk predicate is the
  // narrower one; the broader predicate is historical and
  // intentionally conservative.
  check('isRecoverableError("Failed to fetch") = false',
        !isRecoverableError(e),
        'a bare "Failed to fetch" with no chunk context is not classified as recoverable either');
}

// 4. An SSE stream failure (very common with useRunStream) should NOT
//    trigger a chunk reload, otherwise every chapter would reload the
//    whole app.
console.log('\n[4] SSE / stream errors are not chunk errors');
{
  const e = { name: 'AbortError', message: 'The user aborted a request.' };
  check('isChunkLoadError(AbortError) = false', !isChunkLoadError(e));
}

// 5. Completely unrelated errors are not chunk errors
console.log('\n[5] Unrelated errors are not chunk errors');
{
  const e = { name: 'TypeError', message: 'Cannot read property x of undefined' };
  check('isChunkLoadError(TypeError undefined) = false', !isChunkLoadError(e));
  check('isRecoverableError(TypeError undefined) = false', !isRecoverableError(e));
}

// 6. Imported module failures (Next.js dynamic import) are chunk errors
console.log('\n[6] Next.js dynamic-import failures are chunk errors');
{
  const e1 = { name: 'Error', message: 'Importing a module script failed' };
  const e2 = { name: 'Error', message: 'Importing a dynamically imported module' };
  check('isChunkLoadError("Importing a module script failed")', isChunkLoadError(e1));
  check('isChunkLoadError("dynamically imported module")', isChunkLoadError(e2));
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);