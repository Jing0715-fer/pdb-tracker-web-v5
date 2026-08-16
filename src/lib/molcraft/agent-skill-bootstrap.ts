/**
 * Round 102: Auto-register the pdb-tracker-agent-skill with Hermes on
 * first call to the agent route.
 *
 * The skill lives in the project at docs/agent-skill/SKILL.md and is
 * committed to git. On first agent round call, we copy it to the user's
 * local Hermes skills dir (~/.hermes/skills/) and refresh the bundled
 * manifest so Hermes picks it up automatically.
 */

import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const SKILL_NAME = 'pdb-tracker-agent-skill';

function resolveProjectRoot(): string {
  return process.cwd();
}

function bundledSkillsDir(): string {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'hermes', 'skills');
  }
  return path.join(home, '.hermes', 'skills');
}

async function resolveSourceSkillPath(): Promise<string | null> {
  const candidates = [
    path.join(resolveProjectRoot(), 'docs', 'agent-skill', 'SKILL.md'),
    path.join(resolveProjectRoot(), 'SKILL.md'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function fileMD5(p: string): Promise<string> {
  const buf = await fs.readFile(p);
  return crypto.createHash('md5').update(buf).digest('hex');
}

async function updateBundledManifest(skillsDir: string, name: string, hash: string): Promise<void> {
  const manifest = path.join(skillsDir, '.bundled_manifest');
  let content = '';
  try {
    content = await fs.readFile(manifest, 'utf-8');
  } catch {
    content = '';
  }
  const lines = content.split('\n').filter((l) => l.trim() && !l.startsWith(name + ':'));
  lines.push(`${name}:${hash}`);
  await fs.writeFile(manifest, lines.join('\n') + '\n', 'utf-8');
}

/**
 * Best-effort auto-registration. Returns a brief report describing what
 * was done (or not) so the caller can log it for debugging.
 */
export async function ensureAgentSkillRegistered(): Promise<{
  status: 'installed' | 'updated' | 'unchanged' | 'skipped';
  reason?: string;
  skillName: string;
  hash?: string;
}> {
  const src = await resolveSourceSkillPath();
  if (!src) {
    return { status: 'skipped', reason: 'source SKILL.md not found in project', skillName: SKILL_NAME };
  }
  const skillsDir = bundledSkillsDir();
  if (!existsSync(skillsDir)) {
    return { status: 'skipped', reason: `hermes skills dir missing: ${skillsDir}`, skillName: SKILL_NAME };
  }
  const dest = path.join(skillsDir, SKILL_NAME);
  const hash = await fileMD5(src);

  const destSkill = path.join(dest, 'SKILL.md');
  let action: 'installed' | 'updated' | 'unchanged' = 'installed';
  if (existsSync(destSkill)) {
    const existingHash = await fileMD5(destSkill);
    if (existingHash === hash) {
      action = 'unchanged';
    } else {
      action = 'updated';
    }
  }
  if (action === 'unchanged') {
    return { status: 'unchanged', skillName: SKILL_NAME, hash };
  }

  await fs.mkdir(dest, { recursive: true });
  await fs.copyFile(src, destSkill);
  const srcRef = path.join(path.dirname(src), 'references');
  const destRef = path.join(dest, 'references');
  if (existsSync(srcRef)) {
    await fs.mkdir(destRef, { recursive: true });
    for (const entry of await fs.readdir(srcRef)) {
      const from = path.join(srcRef, entry);
      const to = path.join(destRef, entry);
      await fs.copyFile(from, to);
    }
  }
  await updateBundledManifest(skillsDir, SKILL_NAME, hash);
  return { status: action, skillName: SKILL_NAME, hash };
}
