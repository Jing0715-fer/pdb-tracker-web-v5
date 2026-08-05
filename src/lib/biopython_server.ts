/**
 * Biopython PDB Parser - runs Python/Biopython in a subprocess
 * to compute real phi/psi angles from PDB coordinates
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** Minimal temp-file helper (replacement for the removed `./temp` module). */
function createTempFile(content: string, filename: string): { path: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdb-'));
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content, 'utf-8');
  return {
    path: filePath,
    cleanup: () => {
      try {
        fs.unlinkSync(filePath);
        fs.rmdirSync(dir);
      } catch {
        /* ignore */
      }
    },
  };
}

interface RamaPoint {
  resId: number;
  resName: string;
  chain: string;
  phi: number;
  psi: number;
  region: 'favored' | 'allowed' | 'outlier';
}

interface ParseResult {
  points: RamaPoint[];
  error?: string;
}

// Classify phi/psi into Ramachandran regions (same as route.ts)
function classifyRama(phi: number, psi: number): 'favored' | 'allowed' | 'outlier' {
  // Alpha-helix core
  if (-125 <= phi && phi <= -35 && -70 <= psi && psi <= 50) return 'favored';
  // Beta-sheet core
  if (-180 <= phi && phi <= -30 && 40 <= psi && psi <= 180) return 'favored';
  // Left-handed helix
  if (30 <= phi && phi <= 90 && -90 <= psi && psi <= 50) return 'favored';

  // Allowed regions
  if (-150 <= phi && phi <= -20 && -90 <= psi && psi <= 70) return 'allowed';
  if (-180 <= phi && phi <= -20 && 20 <= psi && psi <= 180) return 'allowed';
  if (20 <= phi && phi <= 110 && -120 <= psi && psi <= 70) return 'allowed';

  return 'outlier';
}

export class PDBParser {
  /**
   * Parse PDB file text and compute phi/psi angles using Biopython
   */
  static async parsePhiPsi(pdbText: string, pdbId: string): Promise<ParseResult> {
    return new Promise((resolve) => {
      // Write PDB to temp file
      const { path: tmpPath, cleanup } = createTempFile(pdbText, `${pdbId}.pdb`);

      const pythonScript = `
import sys
import math
import json
from Bio.PDB import PDBParser

def dihedral(p0, p1, p2, p3):
    """Calculate dihedral angle in degrees"""
    b1 = [p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]]
    b2 = [p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2]]
    b3 = [p3[0]-p2[0], p3[1]-p2[1], p3[2]-p2[2]]
    n1 = [b1[1]*b2[2]-b1[2]*b2[1], b1[2]*b2[0]-b1[0]*b2[2], b1[0]*b2[1]-b1[1]*b2[0]]
    n2 = [b2[1]*b3[2]-b2[2]*b3[1], b2[2]*b3[0]-b2[0]*b3[2], b2[0]*b3[1]-b2[1]*b3[0]]
    n1_m = math.sqrt(n1[0]**2+n1[1]**2+n1[2]**2)
    n2_m = math.sqrt(n2[0]**2+n2[1]**2+n2[2]**2)
    if n1_m < 0.001 or n2_m < 0.001:
        return None
    n1 = [n1[0]/n1_m, n1[1]/n1_m, n1[2]/n1_m]
    n2 = [n2[0]/n2_m, n2[1]/n2_m, n2[2]/n2_m]
    m1 = [n1[1]*b2[2]-n1[2]*b2[1], n1[2]*b2[0]-n1[0]*b2[2], n1[0]*b2[1]-n1[1]*b2[0]]
    x = n1[0]*n2[0] + n1[1]*n2[1] + n1[2]*n2[2]
    y = m1[0]*n2[0] + m1[1]*n2[1] + m1[2]*n2[2]
    angle = math.atan2(y, x)
    return math.degrees(angle)

try:
    parser = PDBParser()
    structure = parser.get_structure('${pdbId}', '${tmpPath}')
    model = structure[0]
    
    points = []
    for chain in model:
        chain_id = chain.get_id()
        residues = list(chain)
        for i, residue in enumerate(residues):
            if residue.get_id()[0] != ' ':
                continue
            try:
                N = list(residue['N'].get_coord())
                CA = list(residue['CA'].get_coord())
                C = list(residue['C'].get_coord())
                
                prev = residues[i-1] if i > 0 and residues[i-1].get_id()[0] == ' ' else None
                next_r = residues[i+1] if i < len(residues)-1 and residues[i+1].get_id()[0] == ' ' else None
                
                phi = psi = None
                if prev:
                    PN = list(prev['N'].get_coord())
                    PC = list(prev['C'].get_coord())
                    phi = dihedral(PN, N, CA, C)
                
                if next_r:
                    NN = list(next_r['N'].get_coord())
                    NC = list(next_r['C'].get_coord())
                    psi = dihedral(N, CA, C, NN)
                
                if phi is not None and psi is not None:
                    res_id = residue.get_id()[1]
                    res_name = residue.get_resname()
                    
                    # Classify
                    if -125 <= phi <= -35 and -70 <= psi <= 50:
                        region = 'favored'
                    elif -180 <= phi <= -30 and 40 <= psi <= 180:
                        region = 'favored'
                    elif 30 <= phi <= 90 and -90 <= psi <= 50:
                        region = 'favored'
                    elif -150 <= phi <= -20 and -90 <= psi <= 70:
                        region = 'allowed'
                    elif -180 <= phi <= -20 and 20 <= psi <= 180:
                        region = 'allowed'
                    elif 20 <= phi <= 110 and -120 <= psi <= 70:
                        region = 'allowed'
                    else:
                        region = 'outlier'
                    
                    points.append({
                        'resId': res_id,
                        'resName': res_name,
                        'chain': chain_id,
                        'phi': round(phi, 1),
                        'psi': round(psi, 1),
                        'region': region
                    })
            except:
                pass
    
    print(json.dumps({'points': points}))
except Exception as e:
    print(json.dumps({'error': str(e), 'points': []}))
`;

      const proc = spawn('python3', ['-c', pythonScript], {
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        cleanup();
        if (code !== 0) {
          resolve({ points: [], error: stderr || `python exited with code ${code}` });
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          resolve({ points: parsed.points || [], error: parsed.error });
        } catch {
          resolve({ points: [], error: `Failed to parse Python output: ${stdout}` });
        }
      });

      proc.on('error', (err) => {
        cleanup();
        resolve({ points: [], error: err.message });
      });

      // Timeout after 30s
      setTimeout(() => {
        proc.kill();
        cleanup();
        resolve({ points: [], error: 'Timeout after 30s' });
      }, 30000);
    });
  }
}