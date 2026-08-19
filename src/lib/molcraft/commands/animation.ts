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
      props.trackball.animate = { name, params };
    } else {
      // The "off" animation name doesn't exist in Molstar's registry
      // (only "spin", "rock", "oscillate"). Setting `animate = undefined`
      // is the documented way to stop the trackball animation.
      props.trackball.animate = undefined;
    }
  });
}
