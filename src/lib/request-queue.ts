/**
 * Sequential request queue with timeout to prevent stuck requests from
 * blocking the entire queue. A single hung fetch (e.g. server compiling
 * a route) would otherwise block ALL subsequent API calls, causing
 weekly/literature pages to get stuck loading.
 */

const FETCH_TIMEOUT_MS = 40_000; // 40s — enough for dev-mode route compilation (15-25s in 4GB sandbox)

type QueueItem = {
  url: string;
  options?: RequestInit;
  resolve: (value: Response) => void;
  reject: (reason: any) => void;
};

let queue: QueueItem[] = [];
let isProcessing = false;

async function processQueue() {
  if (isProcessing || queue.length === 0) return;
  isProcessing = true;

  while (queue.length > 0) {
    const item = queue.shift()!;
    try {
      // Race the fetch against a timeout so a stuck request (server
      // compiling, network hiccup) doesn't block the queue forever.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      // Merge any caller-provided signal with our timeout signal.
      const mergedOptions: RequestInit = {
        ...item.options,
        signal: controller.signal,
      };
      try {
        const response = await fetch(item.url, mergedOptions);
        clearTimeout(timeoutId);
        item.resolve(response);
      } catch (err: any) {
        clearTimeout(timeoutId);
        throw err;
      }
    } catch (error) {
      item.reject(error);
    }
    // Small delay between requests to prevent server overload
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  isProcessing = false;
}

/**
 * Queue a fetch request to be executed sequentially with a timeout.
 */
export function queuedFetch(url: string, options?: RequestInit): Promise<Response> {
  return new Promise((resolve, reject) => {
    queue.push({ url, options, resolve, reject });
    processQueue();
  });
}

/**
 * Fetch with automatic retry and queuing.
 * Combines sequential request processing with retry logic and timeout.
 * 3 retries with backoff (500ms, 750ms, 1125ms) so a stuck queue clears
 * in <3s. The longer timeout (40s) + 3 retries ensures the first compile
 * of each API route succeeds even in the 4GB sandbox.
 */
export async function queuedFetchWithRetry(
  url: string,
  options?: RequestInit,
  retries: number = 3,
  baseDelay: number = 500
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await queuedFetch(url, options);
      if (response.ok || attempt === retries) return response;
    } catch (error) {
      if (attempt === retries) throw error;
    }
    if (attempt < retries) {
      await new Promise(resolve => setTimeout(resolve, baseDelay * Math.pow(1.5, attempt)));
    }
  }
  throw new Error(`Failed after ${retries} retries: ${url}`);
}
