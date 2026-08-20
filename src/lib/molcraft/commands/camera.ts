/**
 * Camera helpers — save/restore camera state and apply canonical angles.
 *
 * Extracted from commands.ts (R138) as part of the module split.
 */

import type { MolstarPlugin } from "../types";

// R130: Save/restore camera state for capture — prevents structure from
// disappearing after capture. The key insight: DON'T call camera.reset()
// before each angle. Instead, save the current view, rotate from current
// position, capture, then restore the saved view.
let savedCameraState: { position: number[]; target: number[]; up: number[] } | null = null;

export function saveCameraState(plugin: MolstarPlugin): void {
  try {
    const canvas3d = plugin.canvas3d as any;
    const cam = canvas3d?.camera;
    if (!cam) return;
    const getArr = (v: any) => {
      if (v?.toArray) return v.toArray();
      if (Array.isArray(v)) return v;
      return [0, 0, 0];
    };
    savedCameraState = {
      position: getArr(cam.position),
      target: getArr(cam.target),
      up: getArr(cam.up),
    };
  } catch (err) { console.warn('[saveCameraState] failed to save camera state:', err); }
}

export function restoreCameraState(plugin: MolstarPlugin): void {
  if (!savedCameraState) return;
  try {
    const canvas3d = plugin.canvas3d as any;
    const cam = canvas3d?.camera;
    if (cam?.setState) {
      cam.setState({
        position: savedCameraState.position as [number, number, number],
        target: savedCameraState.target as [number, number, number],
        up: savedCameraState.up as [number, number, number],
      });
    }
    savedCameraState = null;
  } catch (err) { console.warn('[restoreCameraState] failed to restore camera state:', err); }
}

/**
 * Rotate the camera to one of four canonical angles before capturing.
 *
 * R130: Based on 3Dmol camera-test findings:
 * - DON'T call camera.reset() — it pushes structure off-screen
 * - For front: capture current view as-is (no rotation)
 * - For other angles: rotate from current position
 * - Double render + delay for WebGL buffer to populate
 */
export async function applyCameraAngle(
  plugin: MolstarPlugin,
  angle: "front" | "side" | "top" | "back"
): Promise<void> {
  if (angle === "front") {
    // Front = current view, no rotation needed
    await new Promise(r => setTimeout(r, 100));
    return;
  }

  const canvas3d = plugin.canvas3d as any;
  if (!canvas3d?.camera) return;

  try {
    // R130: Use camera.rotate — rotates around target, keeps structure centered
    if (typeof canvas3d.camera.rotate === 'function') {
      if (angle === "side") {
        canvas3d.camera.rotate([0, 1, 0], Math.PI / 2);  // 90° around Y
      } else if (angle === "back") {
        canvas3d.camera.rotate([0, 1, 0], Math.PI);       // 180° around Y
      } else if (angle === "top") {
        canvas3d.camera.rotate([1, 0, 0], -Math.PI / 2);  // 90° around X
      }
      await new Promise(r => setTimeout(r, 300));
      await new Promise(r => setTimeout(r, 200));
      return;
    }

    // Fallback: manual setState rotation
    const getArr = (v: any) => {
      if (v?.toArray) return v.toArray();
      if (Array.isArray(v)) return v;
      return [0, 0, 0];
    };
    const pos = getArr(canvas3d.camera.position);
    const tgt = getArr(canvas3d.camera.target);
    const up = getArr(canvas3d.camera.up);

    const dx = pos[0] - tgt[0];
    const dy = pos[1] - tgt[1];
    const dz = pos[2] - tgt[2];

    let newPos: [number, number, number];
    let newUp: [number, number, number] = [up[0], up[1], up[2]];

    if (angle === "side") {
      newPos = [tgt[0] - dz, pos[1], tgt[2] + dx];
    } else if (angle === "back") {
      newPos = [tgt[0] - dx, pos[1], tgt[2] - dz];
    } else { // top
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      newPos = [tgt[0], tgt[1] + dist, tgt[2]];
      const xzLen = Math.sqrt(dx*dx + dz*dz) || 1;
      newUp = [dx / xzLen, 0, dz / xzLen];
    }

    if (canvas3d.camera.setState) {
      canvas3d.camera.setState({ position: newPos, up: newUp, target: tgt });
    }

    await new Promise(r => setTimeout(r, 300));
    await new Promise(r => setTimeout(r, 200));
  } catch (err) { console.warn('[applyCameraAngle] failed:', err); }
}
