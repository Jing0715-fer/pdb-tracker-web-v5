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
    if (!cam) return;

    // R153: Use setState with durationMs=0 for instant restoration.
    //
    // The R147 approach (direct array mutation cam.position[0] = x) modifies
    // the internal state array but does NOT trigger stateChanged.next(),
    // so orbit controls and other listeners don't sync.
    //
    // setState(snapshot, 0) calls transition.apply(snapshot, 0) which:
    //   1. Copies snapshot to camera.state (via Camera.copySnapshot)
    //   2. Calls transition.finish() for instant apply (no animation)
    //   3. Calls stateChanged.next(snapshot) to notify all listeners
    //
    // This is the Molstar-sanctioned way to instantly set camera state.
    if (typeof cam.setState === 'function') {
      cam.setState({
        position: savedCameraState.position as [number, number, number],
        target: savedCameraState.target as [number, number, number],
        up: savedCameraState.up as [number, number, number],
      }, 0); // 0ms = instant, no transition animation
    }

    // Request a redraw so the orbit controls sync with the new camera state
    if (typeof canvas3d.requestDraw === 'function') {
      canvas3d.requestDraw();
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
 *
 * R147: Uses direct property setters + update() instead of setState()
 * to avoid transition animation and ensure instant view restoration.
 */
export function restoreCameraViewState(plugin: MolstarPlugin, state: CameraViewState): void {
  try {
    const canvas3d = plugin.canvas3d as any;
    const cam = canvas3d?.camera;
    if (!cam) return;

    // R153: Use setState with durationMs=0 for instant restoration
    if (typeof cam.setState === 'function') {
      cam.setState({
        position: state.position,
        target: state.target,
        up: state.up,
      }, 0); // 0ms = instant
    }

    if (typeof canvas3d.requestDraw === 'function') {
      canvas3d.requestDraw();
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
 *
 * R146: Added support for interface-aware angles:
 * - "interface_front" = 0° (current view, same as front)
 * - "interface_side" = 90° rotation around the Y axis (same as side)
 * - "interface_tilted" = 45° rotation around the Y axis (halfway between)
 * These are mapped to the existing rotate() calls because the R143 fix
 * (restoreCameraStateKeep before each angle) already ensures orthogonal
 * rotations from the focused interface view.
 */
export async function applyCameraAngle(
  plugin: MolstarPlugin,
  angle: "front" | "side" | "top" | "back" | "interface_front" | "interface_side" | "interface_tilted"
): Promise<void> {
  // R146: Map interface-aware angles to canonical rotations
  if (angle === "front" || angle === "interface_front") {
    // Front = current view, no rotation needed
    await new Promise(r => setTimeout(r, 100));
    return;
  }

  const canvas3d = plugin.canvas3d as any;
  if (!canvas3d?.camera) return;
  const cam = canvas3d.camera;

  try {
    // R147: Use DIRECT property setters instead of camera.rotate().
    //
    // camera.rotate() triggers an animation/transition and may not complete
    // before the screenshot is taken. It also interacts with the orbit
    // controls' internal state in unpredictable ways.
    //
    // Instead, we:
    //   1. Read the current camera position/target/up
    //   2. Compute the NEW position/up for the requested angle
    //   3. Set them directly via property setters
    //   4. Call cam.update() to sync matrices
    //
    // This gives us ABSOLUTE camera positioning with no animation,
    // ensuring each screenshot is taken from a distinct, correct angle.
    const getArr = (v: any): number[] => {
      if (v?.toArray) return v.toArray();
      if (Array.isArray(v)) return v;
      return [0, 0, 0];
    };

    const pos = getArr(cam.position);
    const tgt = getArr(cam.target);
    const up = getArr(cam.up);

    // Direction from target to camera position
    const dx = pos[0] - tgt[0];
    const dy = pos[1] - tgt[1];
    const dz = pos[2] - tgt[2];
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

    let newPos: [number, number, number];
    let newUp: [number, number, number] = [up[0] ?? 0, up[1] ?? 0, up[2] ?? 0];

    if (angle === "side" || angle === "interface_side") {
      // 90° rotation around Y axis: swap X and Z components
      // Camera moves from (dx, dy, dz) to (-dz, dy, dx) relative to target
      newPos = [tgt[0] - dz, tgt[1] + dy, tgt[2] + dx];
    } else if (angle === "back") {
      // 180° rotation around Y axis: negate X and Z
      newPos = [tgt[0] - dx, tgt[1] + dy, tgt[2] - dz];
    } else if (angle === "interface_tilted") {
      // R146: 45° rotation around Y axis
      const cos45 = Math.cos(Math.PI / 4);
      const sin45 = Math.sin(Math.PI / 4);
      newPos = [
        tgt[0] - dz * sin45 + dx * cos45,
        tgt[1] + dy,
        tgt[2] + dx * sin45 + dz * cos45,
      ];
    } else { // top
      // 90° rotation around X axis: camera looks down from above
      newPos = [tgt[0], tgt[1] + dist, tgt[2]];
      // Up vector points from camera toward the original front direction
      const xzLen = Math.sqrt(dx*dx + dz*dz) || 1;
      newUp = [-dx / xzLen, 0, -dz / xzLen];
    }

    // R153: Use setState with durationMs=0 for instant camera positioning.
    // This properly notifies all listeners (orbit controls, render loop)
    // via stateChanged.next(), unlike direct array mutation.
    if (typeof cam.setState === 'function') {
      cam.setState({ position: newPos, up: newUp, target: tgt }, 0);
    }

    // Wait for render to settle
    await new Promise(r => setTimeout(r, 300));
    await new Promise(r => setTimeout(r, 200));
  } catch (err) { console.warn('[applyCameraAngle] failed:', err); }
}
