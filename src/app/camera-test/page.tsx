'use client';

/**
 * Camera Test Page — Lightweight Molstar viewer for testing camera rotation
 * and screenshot capture without the full app overhead.
 *
 * Tests:
 * 1. Load a PDB structure
 * 2. Set representation to cartoon + chain coloring
 * 3. Rotate camera to front/side/top/back
 * 4. Capture screenshots at each angle
 * 5. Display screenshots side by side for comparison
 */

import { useEffect, useRef, useState, useCallback } from 'react';
// Note: MolstarViewer publishes to Zustand store automatically, no onReady prop
import { MolstarViewer } from '@/components/molcraft-molstar/molstar-viewer';
import { useAppStore } from '@/lib/molcraft/store';
import { executeCommand } from '@/lib/molcraft/commands';
import { Camera, RotateCw, Box, Image as ImageIcon, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function CameraTestPage() {
  const viewer = useAppStore((s) => s.viewer);
  const setViewer = useAppStore((s) => s.setViewer);
  const [pdbId, setPdbId] = useState('1CBS');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [screenshots, setScreenshots] = useState<Array<{ dataUri: string; angle: string }>>([]);
  const [log, setLog] = useState<string[]>([]);
  const addLog = (msg: string) => {
    setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  // Detect when Molstar viewer is ready (published to Zustand store)
  useEffect(() => {
    if (viewer) {
      addLog('Molstar viewer ready');
    }
  }, [viewer]);

  const handleLoad = useCallback(async () => {
    if (!viewer || !pdbId.trim()) return;
    setLoading(true);
    setStatus('Loading...');
    addLog(`Loading PDB ${pdbId}...`);
    try {
      const result = await executeCommand(viewer, { type: 'load_pdb', id: pdbId.trim() });
      addLog(`Load result: ${result.ok ? 'OK' : 'FAILED'} — ${result.detail}`);
      setStatus(result.ok ? 'Loaded' : 'Load failed');
      if (result.ok) {
        // Wait for render
        await new Promise(r => setTimeout(r, 2000));
        // Set cartoon representation
        addLog('Setting representation to polymer-cartoon...');
        const reprResult = await executeCommand(viewer, { type: 'set_representation', preset: 'polymer-cartoon' });
        addLog(`Representation: ${reprResult.ok ? 'OK' : 'FAILED'} — ${reprResult.detail}`);
        await new Promise(r => setTimeout(r, 500));
        // Set chain-id color
        addLog('Setting color theme to chain-id...');
        const colorResult = await executeCommand(viewer, { type: 'set_color_theme', theme: 'chain-id' });
        addLog(`Color: ${colorResult.ok ? 'OK' : 'FAILED'} — ${colorResult.detail}`);
      }
    } catch (err) {
      addLog(`Error: ${err}`);
      setStatus('Error');
    } finally {
      setLoading(false);
    }
  }, [viewer, pdbId]);

  const captureAngle = useCallback(async (angle: 'front' | 'side' | 'top' | 'back') => {
    if (!viewer) return;
    setLoading(true);
    setStatus(`Capturing ${angle}...`);
    addLog(`--- Capturing ${angle} ---`);

    try {
      const plugin = (viewer as any).plugin;
      if (!plugin) {
        addLog('No plugin available');
        return;
      }

      // Step 1: Reset camera
      addLog('Step 1: camera.reset()');
      plugin.managers.camera.reset();
      await new Promise(r => setTimeout(r, 150));
      await new Promise(r => requestAnimationFrame(() => {}));

      if (angle !== 'front') {
        // Step 2: Read camera state after reset
        const canvas3d = plugin.canvas3d as any;
        const cam = canvas3d?.camera;
        if (cam) {
          const getArr = (v: any) => {
            if (v?.toArray) return v.toArray();
            if (Array.isArray(v)) return v;
            return [0, 0, 0];
          };
          const pos = getArr(cam.position);
          const tgt = getArr(cam.target);
          const up = getArr(cam.up);
          addLog(`Camera after reset: pos=[${pos.map((n:number)=>n.toFixed(1)).join(',')}] tgt=[${tgt.map((n:number)=>n.toFixed(1)).join(',')}] up=[${up.map((n:number)=>n.toFixed(1)).join(',')}]`);

          const dx = pos[0] - tgt[0];
          const dy = pos[1] - tgt[1];
          const dz = pos[2] - tgt[2];
          const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
          addLog(`Distance: ${dist.toFixed(1)}, dx=${dx.toFixed(1)} dy=${dy.toFixed(1)} dz=${dz.toFixed(1)}`);

          let newPos: [number, number, number];
          let newUp: [number, number, number] = [up[0], up[1], up[2]];

          if (angle === 'side') {
            // Rotate 90° around Y: (dx, dz) -> (-dz, dx)
            newPos = [tgt[0] - dz, tgt[1] + dy, tgt[2] + dx];
          } else if (angle === 'back') {
            // Rotate 180° around Y: (dx, dz) -> (-dx, -dz)
            newPos = [tgt[0] - dx, tgt[1] + dy, tgt[2] - dz];
          } else { // top
            // Camera above target
            newPos = [tgt[0], tgt[1] + dist, tgt[2]];
            const xzLen = Math.sqrt(dx*dx + dz*dz) || 1;
            newUp = [dx / xzLen, 0, dz / xzLen];
          }

          addLog(`New position: [${newPos.map(n=>n.toFixed(1)).join(',')}]`);

          if (typeof cam.setState === 'function') {
            cam.setState({ position: newPos, up: newUp, target: tgt });
            addLog('Camera state updated via setState');
          } else {
            addLog('WARNING: cam.setState not available');
          }

          await new Promise(r => setTimeout(r, 100));
          await new Promise(r => requestAnimationFrame(() => {}));
        }
      }

      // Step 3: Capture screenshot
      addLog('Step 3: Capturing screenshot...');
      const dataUri = await plugin.helpers?.viewportScreenshot?.getImageDataUri({
        width: 800,
        height: 600,
        transparency: false,
        axes: true,
      });

      if (dataUri) {
        addLog(`Screenshot captured: ${dataUri.length} chars`);
        setScreenshots((prev) => [...prev, { dataUri, angle }]);
      } else {
        addLog('Screenshot FAILED — no dataUri returned');
      }
    } catch (err) {
      addLog(`Error: ${err}`);
    } finally {
      setLoading(false);
      setStatus('Ready');
    }
  }, [viewer]);

  const captureAll = useCallback(async () => {
    setScreenshots([]);
    for (const angle of ['front', 'side', 'top', 'back'] as const) {
      await captureAngle(angle);
    }
    addLog('=== All angles captured ===');
  }, [captureAngle]);

  const resetCamera = useCallback(() => {
    if (!viewer) return;
    try {
      (viewer as any).plugin.managers.camera.reset();
      addLog('Camera reset');
    } catch (err) {
      addLog(`Reset error: ${err}`);
    }
  }, [viewer]);

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4">
      <h1 className="text-xl font-bold mb-4">Camera Test — Molstar Rotation & Screenshot</h1>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="text"
          value={pdbId}
          onChange={(e) => setPdbId(e.target.value)}
          placeholder="PDB ID"
          className="px-2 py-1 text-sm bg-slate-800 border border-slate-600 rounded text-white w-24"
        />
        <Button onClick={handleLoad} disabled={loading || !viewer} size="sm">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Box className="h-4 w-4 mr-1" />}
          Load
        </Button>
        <Button onClick={resetCamera} disabled={loading || !viewer} size="sm" variant="outline">
          <RotateCw className="h-4 w-4 mr-1" />
          Reset
        </Button>
        <Button onClick={() => captureAngle('front')} disabled={loading || !viewer} size="sm" variant="outline">
          <Camera className="h-4 w-4 mr-1" /> Front
        </Button>
        <Button onClick={() => captureAngle('side')} disabled={loading || !viewer} size="sm" variant="outline">
          <Camera className="h-4 w-4 mr-1" /> Side
        </Button>
        <Button onClick={() => captureAngle('top')} disabled={loading || !viewer} size="sm" variant="outline">
          <Camera className="h-4 w-4 mr-1" /> Top
        </Button>
        <Button onClick={() => captureAngle('back')} disabled={loading || !viewer} size="sm" variant="outline">
          <Camera className="h-4 w-4 mr-1" /> Back
        </Button>
        <Button onClick={captureAll} disabled={loading || !viewer} size="sm">
          <ImageIcon className="h-4 w-4 mr-1" />
          Capture All
        </Button>
        <span className="text-xs text-slate-400 ml-2">{status}</span>
      </div>

      {/* Main content: viewer + screenshots */}
      <div className="flex gap-4 flex-wrap">
        {/* Molstar viewer */}
        <div className="flex-1 min-w-[400px]">
          <div className="relative w-full h-[500px] bg-slate-800 rounded-lg overflow-hidden border border-slate-600">
            <MolstarViewer className="absolute inset-0" />
          </div>
        </div>

        {/* Screenshots */}
        <div className="flex-1 min-w-[400px]">
          <h2 className="text-sm font-semibold mb-2">Screenshots ({screenshots.length})</h2>
          <div className="grid grid-cols-2 gap-2">
            {screenshots.map((s, i) => (
              <div key={i} className="relative">
                <img
                  src={s.dataUri}
                  alt={s.angle}
                  className="w-full h-auto rounded border border-slate-600"
                />
                <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-black/70 text-white text-xs rounded">
                  {s.angle}
                </div>
              </div>
            ))}
          </div>
          {screenshots.length === 0 && (
            <div className="text-sm text-slate-500 italic">No screenshots yet. Click "Capture All" to test.</div>
          )}
        </div>
      </div>

      {/* Log */}
      <div className="mt-4">
        <h2 className="text-sm font-semibold mb-2">Log</h2>
        <div className="bg-slate-950 rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-xs text-green-400">
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          {log.length === 0 && <span className="text-slate-600">No logs yet.</span>}
        </div>
      </div>
    </div>
  );
}
