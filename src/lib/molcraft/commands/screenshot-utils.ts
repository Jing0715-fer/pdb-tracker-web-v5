/**
 * Screenshot quality utilities — check if captured screenshots are valid.
 *
 * Extracted from commands.ts (R138) as part of the module split.
 */

/** Check screenshot quality by sampling pixel variance. Returns 'ok' | 'black' | 'white'. */
export async function checkScreenshotQuality(dataUri: string): Promise<'ok' | 'black' | 'white'> {
  try {
    const img = new Image();
    img.src = dataUri;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'ok';
    canvas.width = 32; canvas.height = 32;
    ctx.drawImage(img, 0, 0, 32, 32);
    const data = ctx.getImageData(0, 0, 32, 32).data;
    let minR = 255, maxR = 0, minG = 255, maxG = 0;
    for (let i = 0; i < data.length; i += 4) {
      minR = Math.min(minR, data[i]!); maxR = Math.max(maxR, data[i]!);
      minG = Math.min(minG, data[i + 1]!); maxG = Math.max(maxG, data[i + 1]!);
    }
    if (maxR < 10 && maxG < 10) return 'black';
    if (minR > 245 && minG > 245) return 'white';
    return 'ok';
  } catch (err) {
    console.warn('[checkScreenshotQuality] image decode failed, assuming ok:', err);
    return 'ok';
  }
}

/**
 * Check if a base64 PNG screenshot is all-black (or nearly so).
 * Uses a size heuristic: if the base64 data is very short (< 2KB), it's
 * likely a blank/uniform image (a real 1200x800 screenshot is 50KB+).
 */
export function checkIfBlackScreen(dataUri: string): boolean {
  try {
    if (typeof document === "undefined") return false; // SSR safety
    const base64Data = dataUri.split(",")[1] || "";
    if (base64Data.length < 2000) {
      return true; // Suspiciously small — likely blank
    }
    return false;
  } catch (err) {
    console.warn('[checkIfBlackScreen] check failed, assuming not black:', err);
    return false;
  }
}

/**
 * Wait for the next render frame. Molstar's setProps() schedules a re-render
 * via requestAnimationFrame; if we screenshot before the next frame, we
 * capture the OLD background.
 */
export function nextFrame(): Promise<number> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "undefined") {
      requestAnimationFrame((t) => resolve(t));
    } else {
      setTimeout(() => resolve(Date.now()), 16);
    }
  });
}
