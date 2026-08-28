/**
 * Animation helpers — control trackball spin/rock animations.
 *
 * Extracted from commands.ts (R138) as part of the module split.
 */

import type { MolstarPlugin } from "../types";

/** Set or stop the trackball animation (spin, rock, oscillate). */
export function setTrackballAnimate(
  plugin: MolstarPlugin,
  name: string | undefined,
  params: { speed?: number }
) {
  const canvas3d = plugin.canvas3d as
    | {
        setProps?: (fn: (p: unknown) => void) => void;
        props?: { trackball: { animate?: unknown } };
      }
    | undefined;
  if (!canvas3d?.setProps) return;
  canvas3d.setProps((p: unknown) => {
    const props = p as {
      trackball: {
        animate?: { name: string; params: Record<string, unknown> };
      };
    };
    props.trackball = props.trackball ?? {};
    if (name) {
      // R175: COMPLETE params are mandatory — the bundle's rock/spin ticks
      // read `animate.params.axis[0]` / `animate.params.angle` on EVERY
      // frame, and the previous `{ speed }`-only payload left them undefined
      // → "TypeError: Cannot read properties of undefined (reading '0')"
      // thrown on every render tick while the animation ran (seen live when
      // the agent called toggle_rock). Defaults mirror the bundle's own
      // trackball schema: speed 0.3, rock angle 10°, axis (0,-1,0) camera-space.
      const speed = params.speed ?? 0.3;
      if (name === "rock") {
        props.trackball.animate = { name, params: { speed, angle: 10, axis: [0, -1, 0] } };
      } else if (name === "spin") {
        props.trackball.animate = { name, params: { speed, axis: [0, -1, 0] } };
      } else {
        // Unknown/custom animation names: pass through what we have.
        props.trackball.animate = { name, params: { speed } };
      }
    } else {
      // The "off" animation name doesn't exist in Molstar's registry
      // (only "spin", "rock", "oscillate"). Setting `animate = undefined`
      // is the documented way to stop the trackball animation.
      props.trackball.animate = undefined;
    }
  });
}
