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

/** R144: Camera state type — the full view parameters needed to restore a view. */
export interface CameraViewState {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
}

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
  restoreCameraStateImpl(plugin, false);
}

/**
 * R143: Restore camera state WITHOUT clearing it, so it can be called
 * multiple times in a loop (e.g., before each angle in capture_multi_angle).
 */
export function restoreCameraStateKeep(plugin: MolstarPlugin): void {
  restoreCameraStateImpl(plugin, true);
}

function restoreCameraStateImpl(plugin: MolstarPlugin, keep: boolean): void {
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
      // R144: Request a redraw so the orbit controls sync with the new camera
      // state. Without this, the trackball controls may keep their internal
      // stale state and the user can't freely rotate after a capture.
      if (typeof canvas3d.requestDraw === 'function') {
        canvas3d.requestDraw();
      }
    }
    if (!keep) {
      savedCameraState = null;
    }
  } catch (err) { console.warn('[restoreCameraState] failed to restore camera state:', err); }
}

/**
 * R144: Get the current camera view state.
 * Used to save per-screenshot camera states so the user can restore
 * a specific screenshot's view later.
 */
export function getCurrentCameraState(plugin: MolstarPlugin): CameraViewState | null {
  try {
    const canvas3d = plugin.canvas3d as any;
    const cam = canvas3d?.camera;
    if (!cam) return null;
    const getArr = (v: any): [number, number, number] => {
      if (v?.toArray) {
        const arr = v.toArray();
        return [arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0];
      }
      if (Array.isArray(v)) return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
      return [0, 0, 0];
    };
    return {
      position: getArr(cam.position),
      target: getArr(cam.target),
      up: getArr(cam.up),
    };
  } catch (err) {
    console.warn('[getCurrentCameraState] failed:', err);
    return null;
  }
}

/**
 * R144: Restore a specific camera view state.
 * Used by the "恢复视角" button in the screenshot carousel to restore
 * the view that was active when a specific screenshot was captured.
 */
export function restoreCameraViewState(plugin: MolstarPlugin, state: CameraViewState): void {
  try {
    const canvas3d = plugin.canvas3d as any;
    const cam = canvas3d?.camera;
    if (cam?.setState) {
      cam.setState({
        position: state.position,
        target: state.target,
        up: state.up,
      });
      // R144: Request a redraw so the orbit controls sync with the new camera state
      if (typeof canvas3d.requestDraw === 'function') {
        canvas3d.requestDraw();
      }
    }
  } catch (err) { console.warn('[restoreCameraViewState] failed:', err); }
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
