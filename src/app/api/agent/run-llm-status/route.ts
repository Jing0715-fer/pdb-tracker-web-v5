/**
 * GET /api/agent/run-llm-status — ultra-light status endpoint (R181).
 *
 * Returns ONLY what the Run Center's SharedLlmButton pill label needs on
 * mount: the effective provider/model for Run Center modules and where it
 * comes from. This route deliberately imports leaf modules only (no agent
 * manager, no LLM subsystem) so that compiling it is cheap — the heavy
 * `/api/agent/providers` route (full catalog + CLI-agent scan + manager)
 * now compiles only when the LLM settings popover is actually opened,
 * which cuts the peak compile memory of merely OPENING Run Center.
 */

import { resolveSharedLlmSettings } from '@/lib/agent/eval-llm';
import { getRunProviderOverride } from '@/lib/agent/run-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const shared = resolveSharedLlmSettings();
  const override = getRunProviderOverride();
  if (override) {
    // The label for a CLI agent override: e.g. "CLI · hermes".
    const agentLabel = override.provider.replace(/^cli:/, '');
    return Response.json({
      effective: {
        provider: override.provider,
        model: override.model || '',
        displayName: `CLI · ${agentLabel}`,
        source: 'run-override',
      },
      shared,
      runDefault: override,
    });
  }
  return Response.json({
    effective: {
      provider: shared.provider,
      model: shared.model,
      displayName: shared.displayName,
      source: 'shared',
    },
    shared,
    runDefault: null,
  });
}
