/**
 * GET /api/llm/icon?provider=<id>&bin=<absolute-bin-path>
 *
 * Streams the brand icon (.ico / .png / .svg) found next to a CLI's binary.
 * The path is resolved by the LLM helper (climbing from the binary directory)
 * — this route does NOT trust absolute paths from the client except as a hint
 * to the resolver.
 *
 * Usage: <img src={`/api/llm/icon?provider=hermes&bin=${encodeURIComponent(bin)}`} />
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import { resolveIconFor } from "@/lib/llm";

const MIME: Record<string, string> = {
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".icns": "image/x-icon",
};

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider");
  const bin = url.searchParams.get("bin");
  if (!provider || !bin) {
    return new Response("missing provider/bin query params", { status: 400 });
  }
  const id = provider.replace(/^cli:/, "");
  const iconPath = await resolveIconFor(id, bin);
  if (!iconPath) {
    return new Response("icon not found", { status: 404 });
  }
  let data: Buffer;
  try {
    data = await fs.readFile(iconPath);
  } catch (err: any) {
    return new Response("icon read failed: " + (err?.message || "unknown"), { status: 500 });
  }
  const dotIdx = iconPath.toLowerCase().lastIndexOf(".");
  const ext = dotIdx >= 0 ? iconPath.toLowerCase().slice(dotIdx) : ".ico";
  const contentType = MIME[ext] || "application/octet-stream";
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, immutable",
      "Content-Length": String(data.length),
    },
  });
}
