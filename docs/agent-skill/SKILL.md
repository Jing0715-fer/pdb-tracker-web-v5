---
name: pdb-tracker-agent-skill
description: "Drive the PDB-tracker Structure Analysis chat from any CLI agent (hermes / codex / codebuddy / claude). The chat is exposed as an HTTP API on localhost:3001 with /api/llm/chat and /api/llm/chat/stream. Use when user asks to 'do structure analysis', 'load PDB and analyze chains', 'run a recipe', or to script multi-step chat workflows against a running PDB-tracker dev server. Covers session reuse, the auto-capture screenshot pipeline, and the agent-mode route /api/llm/agent/round."
---

# PDB-tracker Structure Analysis — Agent Skill

PDB-tracker is a Next.js dev server on **localhost:3001** that hosts a Molstar 3D viewer plus a chat panel with tool-calling agent loop. You (this CLI agent) can drive the same chat programmatically via HTTP — no need to use a browser or the agent-mode UI in /api/llm/agent/round (which is hardcoded to use the z.ai SDK and ignores CLI providers).

Two chat endpoints are available:

| Endpoint | Use for |
|---|---|
| `POST /api/llm/chat` | Single-shot, returns full JSON response. No streaming. |
| `POST /api/llm/chat/stream` | SSE stream of progress + final response. Use when the user wants to see incremental progress. |

Both routes route through `generateText` in `src/lib/llm.ts`, which honors the `provider` field (`cli:hermes`, `cli:codex`, `cli:codebuddy`, or any other registered provider). Hermes CLI supports `--resume <id>` so multi-turn chat shares session context across calls.

## When to use this skill

- User asks to load a PDB structure and analyze it
- User wants to drive structure-analysis chat from a script / cron / external tool
- User wants to test or evaluate the chat pipeline
- You want to do multi-step analysis (load → set representation → analyze → screenshot) without going through the agent-mode UI

## When NOT to use this skill

- The user is asking *about* the structure-analysis code (read the `pdb-tracker-analysis` skill instead)
- The user wants to set up or debug the dev server itself (read `pdb-tracker-dev`)
- Single chat message with no follow-up (use the simple non-streaming endpoint)

## Prerequisites

- PDB-tracker dev server running on **localhost:3001** (start with `NODE_OPTIONS="--max-old-space-size=3072" npx next dev --webpack -p 3001` from `D:\\AI-web-app\\PDB-tracker`)
- At least one LLM CLI provider probed (`POST /api/llm/refresh` triggers a 30-60s re-probe if needed; cache file at `%LOCALAPPDATA%\\Temp\\pdb-tracker-cache\\llm-providers-cache.json`)

## The chat protocol

### 1. Single-shot call

```bash
curl -X POST http://localhost:3001/api/llm/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Load PDB 4HHB"}
    ],
    "provider": "cli:hermes",
    "sessionId": "my-analysis-001"
  }'
```

Response shape:
```json
{
  "ok": true,
  "content": "<LLM reply text>",
  "provider": "cli:hermes",
  "durationMs": 18234,
  "sessionId": "chat-my-analysis-001"
}
```

### 2. Streaming call (SSE)

```bash
curl -N -X POST http://localhost:3001/api/llm/chat/stream \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Load 4HHB"}],
    "provider": "cli:hermes",
    "sessionId": "my-analysis-001"
  }'
```

Stream events (one JSON object per `data:` line):
```
{type: "start", sessionId: "..."}
{type: "progress", chunk: "..."}      # incremental content
{type: "done", provider: "cli:hermes", content: "..."}
```

### 3. Multi-turn with session reuse

Pass the same `sessionId` across calls. The route prefixes it with `chat-` and stores it in the SESSION_REGISTRY (`%LOCALAPPDATA%\\Temp\\pdb-tracker-cache\\session-registry.json`). For Hermes CLI the actual `codex/hermes chat --resume <id>` is invoked automatically — your session continues across calls without re-sending the conversation history.

```bash
# Call 1: start session
curl ... /api/llm/chat -d '{ "messages": [...], "sessionId": "heme-1" }'

# Call 2: follow-up — server reuses session id, no need to re-send history
curl ... /api/llm/chat -d '{
  "messages": [{"role": "user", "content": "Now run all_interactions A↔B"}],
  "sessionId": "heme-1"
}'
```

The `messages` array in call 2 should be just the new turn, NOT the whole conversation. The server keeps context.

## Providers

| Value | Behavior |
|---|---|
| `cli:hermes` | Hermes CLI (`hermes chat -q -Q --resume <id>`). Requires the `hermes` binary on PATH. |
| `cli:codex` | Codex CLI (`codex exec resume <id>`). Requires the `codex` binary on PATH. |
| `cli:codebuddy` | Codebuddy CLI (`--session-id`). |
| `zai` (default) | z.ai SDK (`z-ai-web-dev-sdk`). Falls back here if no `provider` is passed. Requires valid API key in `.z-ai-config` at project root or `~/.z-ai-config`. |

If the user's preferred provider fails (probe error, CLI missing, etc.) the route falls back through providers automatically — check the response `provider` field to see which one actually handled the call.

## Common task: load + analyze + screenshot

The auto-capture pipeline runs after every `analyze_run` recipe. When the chat emits a recipe command (e.g. `pdb_load 4HHB`, `set_representation cartoon`, `set_color_theme chain-id`, `analyze_run all_interactions A↔B`), the chat-tab handler executes it locally in the user's browser via Molstar and auto-captures multi-angle screenshots if a viewer is loaded.

**Note**: This auto-capture pipeline only runs in the user's browser. When you call the chat API directly (as in this skill), you are NOT triggering any browser-side capture — the chat responds in plain text without screenshots. Screenshots are only generated when a real user interacts with the chat-tab UI.

For screenshots and tool execution in a headless context, use the `/api/llm/agent/round` route instead — but be aware that route is currently hardcoded to z.ai SDK and will return 401 unless a valid `.z-ai-config` is present.

## Verify a session worked

After each call, check:

```bash
# What provider actually handled the call
cat %LOCALAPPDATA%\\Temp\\pdb-tracker-cache\\session-registry.json
# Should show entries like { "chat-<your-id>": { "<provider>": "<session-id>" } }
```

If `session-registry.json` is empty after a call, the LLM never actually executed — likely the provider was missing or failed.

## Pitfalls

- **Don't include the whole conversation in `messages` for multi-turn.** Each turn's `messages` is just the new user message + assistant placeholder; the server keeps context via SESSION_REGISTRY.
- **Hermes session reuse requires the same `--resume <id>` to work.** If you call `/api/llm/chat` with `provider=cli:hermes` and a `sessionId` that doesn't yet exist in the registry, it creates a fresh session. Subsequent calls with the same sessionId will resume.
- **The 60s `maxDuration` on the route may clip slow CLIs.** Hermes/codex/codebuddy calls over 60s will return a `maxDuration` error. If you need long replies, increase `maxDuration` in the route or split the prompt.
- **Codex first call may take 5-10s for setup**, then ~13s per reply. Plan timeouts accordingly.
- **`codex --output-last-message <file>` writes to a temp file** — the route cleans it up; you don't need to manage it.
- **`agent-mode` UI hardcoded to z.ai SDK.** Don't confuse /api/llm/agent/round (which is the in-browser agent-mode UI's backend) with /api/llm/chat (which is what this skill uses). They are separate routes with separate behaviors.

## Verifying on this host

```bash
# Health check
curl http://localhost:3001/api/health

# Providers probed and ready
curl http://localhost:3001/api/llm/providers | jq .

# Force re-probe if a provider was installed after last cache write
curl -X POST http://localhost:3001/api/llm/refresh
```

If a provider shows `available: false`, run `POST /api/llm/refresh` and wait ~30s. The cache TTL is 6 days; re-probing after a CLI install is required.
