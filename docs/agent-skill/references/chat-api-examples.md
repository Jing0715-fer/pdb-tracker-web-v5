# PDB-tracker Chat API — Concrete Examples

This document shows end-to-end examples for driving the structure-analysis chat via the HTTP API.

## Health + provider probe

```bash
# Check the dev server is up
curl -s http://localhost:3001/api/health

# List available providers (returns a JSON array)
curl -s http://localhost:3001/api/llm/providers | python -m json.tool

# Force a fresh provider probe (30-60s)
curl -X POST -s http://localhost:3001/api/llm/refresh
```

## Single-shot chat

```bash
curl -s -X POST http://localhost:3001/api/llm/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello, who are you?"}],
    "provider": "cli:hermes",
    "sessionId": "smoke-1"
  }' | python -m json.tool
```

Response:
```json
{
  "ok": true,
  "content": "I am Hermes, a structural-biology assistant...",
  "provider": "cli:hermes",
  "durationMs": 18432,
  "sessionId": "chat-smoke-1"
}
```

## Streaming chat (SSE)

```bash
curl -N -X POST http://localhost:3001/api/chat/stream \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Count to 5"}],
    "provider": "cli:hermes",
    "sessionId": "stream-smoke-1"
  }'
```

Output:
```
data: {"type":"start","sessionId":"chat-stream-smoke-1"}

data: {"type":"progress","chunk":"1, "}

data: {"type":"progress","chunk":"2, "}

data: {"type":"done","provider":"cli:hermes","content":"1, 2, 3, 4, 5"}
```

## Multi-turn with session reuse

The `sessionId` field is the conversation key. Same sessionId across calls = same Hermes/Codex session.

```bash
# Turn 1: ask to load 4HHB
curl -s -X POST http://localhost:3001/api/llm/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Load PDB 4HHB and set representation to cartoon"}],
    "provider": "cli:hermes",
    "sessionId": "heme-4hhb"
  }'

# Turn 2: ask for chain coloring — server keeps context
curl -s -X POST http://localhost:3001/api/llm/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Now color by chain"}],
    "provider": "cli:hermes",
    "sessionId": "heme-4hhb"
  }'

# Turn 3: ask for analysis — server keeps context (Hermes sees all 3 turns)
curl -s -X POST http://localhost:3001/api/llm/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Run all_interactions on A↔B"}],
    "provider": "cli:hermes",
    "sessionId": "heme-4hhb"
  }'
```

Inspect the session registry after each turn:
```bash
cat "%LOCALAPPDATA%\\Temp\\pdb-tracker-cache\\session-registry.json"
# Expected: { "chat-heme-4hhb": { "hermes": "20260813_xxxxxx_xxxxxx" } }
```

## Multi-provider test

Run the same prompt against different providers to compare:

```bash
PROMPT='{"messages":[{"role":"user","content":"Reply with one word: OK"}]}'

# Hermes
curl -s -X POST http://localhost:3001/api/llm/chat \
  -H "Content-Type: application/json" \
  -d "$PROMPT, \"provider\":\"cli:hermes\", \"sessionId\":\"compare-h\"}"

# Codex
curl -s -X POST http://localhost:3001/api/llm/chat \
  -H "Content-Type: application/json" \
  -d "$PROMPT, \"provider\":\"cli:codex\", \"sessionId\":\"compare-c\"}"

# Codebuddy
curl -s -X POST http://localhost:3001/api/llm/chat \
  -H "Content-Type: application/json" \
  -d "$PROMPT, \"provider\":\"cli:codebuddy\", \"sessionId\":\"compare-b\"}"
```

Each one should produce a different SESSION_REGISTRY entry with the same `chat-compare-?` logical id.

## Common errors and fixes

| Error | Cause | Fix |
|---|---|---|
| HTTP 503 + "z.ai SDK 鉴权失败" | No valid API key in `.z-ai-config` | Add real key at https://open.bigmodel.cn/usercenter/apikeys |
| HTTP 502 + "unavailable" | Provider binary missing or probe failed | Run `POST /api/llm/refresh` after installing CLI |
| HTTP 500 + "LLM call failed" | CLI crashed mid-call | Check CLI binary works standalone (e.g. `hermes chat -q "hi" -Q`) |
| HTTP 502 + "maxDuration" | LLM took longer than 60s | Split prompt into smaller chunks or increase route timeout |
| `{"ok": false, "error": "..."}` | LLM call returned error | Check `error` field; commonly 429 rate limit (retry in 60s) |
