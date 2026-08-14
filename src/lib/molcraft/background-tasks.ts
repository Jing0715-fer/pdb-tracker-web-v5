/**
 * Background Task Manager — Maps run-center modules to background tasks.
 *
 * The run-center has 3 modules (literature, eval, weekly) that run as
 * long-running SSE streams. This module wraps them as background tasks
 * that can be:
 * - Enqueued by the agent (via tool calls)
 * - Monitored for progress
 * - Cancelled
 * - Collected when complete
 *
 * This enables the agent to say "I'll run the literature search in the
 * background" and continue the conversation while the task runs.
 */

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type TaskModule = "literature" | "eval" | "weekly" | "analysis" | "custom";

export interface BackgroundTask {
  id: string;
  module: TaskModule;
  title: string;
  status: TaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  progress: number; // 0-100
  result?: unknown;
  error?: string;
  /** SSE event log for replay */
  events: Array<{ type: string; message: string; timestamp: number; progress?: number }>;
}

export interface TaskEnqueueOptions {
  module: TaskModule;
  title: string;
  /** The function to execute (receives progress callback) */
  execute: (task: BackgroundTask, onProgress: (progress: number, message: string) => void) => Promise<unknown>;
  /** Priority (lower = higher priority) */
  priority?: number;
}

class BackgroundTaskManager {
  private tasks = new Map<string, BackgroundTask>();
  private executors = new Map<string, (task: BackgroundTask, onProgress: (progress: number, message: string) => void) => Promise<unknown>>();
  private queue: string[] = [];
  private running = new Set<string>();
  private maxConcurrent = 1; // Run one task at a time to avoid overloading

  /** Enqueue a background task */
  enqueue(options: TaskEnqueueOptions): string {
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const task: BackgroundTask = {
      id,
      module: options.module,
      title: options.title,
      status: "pending",
      createdAt: Date.now(),
      progress: 0,
      events: [],
    };
    this.tasks.set(id, task);
    this.executors.set(id, options.execute);
    this.queue.push(id);
    this.processQueue();
    return id;
  }

  /** Process the queue */
  private async processQueue(): Promise<void> {
    if (this.running.size >= this.maxConcurrent) return;
    const taskId = this.queue.shift();
    if (!taskId) return;

    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = "running";
    task.startedAt = Date.now();
    this.running.add(taskId);

    // Notify UI
    this.notify(taskId, "started", `Task started: ${task.title}`);

    try {
      const executor = this.executors.get(taskId);
      if (!executor) throw new Error("No executor for task " + taskId);
      const result = await executor(task, (progress, message) => {
        task.progress = progress;
        this.notify(taskId, "progress", message, progress);
      });
      task.status = "completed";
      task.progress = 100;
      task.completedAt = Date.now();
      task.result = result;
      this.notify(taskId, "completed", `Task completed: ${task.title}`, 100);
    } catch (err: any) {
      task.status = "failed";
      task.error = err?.message || String(err);
      task.completedAt = Date.now();
      this.notify(taskId, "failed", `Task failed: ${task.error}`);
    } finally {
      this.running.delete(taskId);
      this.executors.delete(taskId);
      this.processQueue(); // Process next task
    }
  }

  /** Get task status */
  get(taskId: string): BackgroundTask | undefined {
    return this.tasks.get(taskId);
  }

  /** List all tasks */
  list(): BackgroundTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  /** List tasks by module */
  listByModule(module: TaskModule): BackgroundTask[] {
    return this.list().filter((t) => t.module === module);
  }

  /** Cancel a running task */
  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    if (task.status === "running" || task.status === "pending") {
      task.status = "cancelled";
      task.completedAt = Date.now();
      this.running.delete(taskId);
      this.queue = this.queue.filter((id) => id !== taskId);
      this.notify(taskId, "cancelled", `Task cancelled: ${task.title}`);
      return true;
    }
    return false;
  }

  /** Clear completed/failed tasks */
  cleanup(): void {
    for (const [id, task] of this.tasks) {
      if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
        this.tasks.delete(id);
      }
    }
  }

  /** Notify listeners of task updates */
  private notify(taskId: string, type: string, message: string, progress?: number): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.events.push({ type, message, timestamp: Date.now(), progress });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("background-task-update", {
        detail: { taskId, type, message, progress, task },
      }));
    }
  }
}

export const backgroundTaskManager = new BackgroundTaskManager();
