const FLOW_STEPS = [
  { id: "load-account", label: "Load account cookies into session" },
  { id: "launch-browser", label: "Launch Playwright + Chromium worker" },
  { id: "navigate", label: "Navigate Ticketmaster event page" },
  { id: "kasada", label: "Complete Kasada anti-bot challenge" },
  { id: "gec", label: "POST GEC Event endpoint" },
  { id: "tmpt", label: "Capture TMPT cookie" },
  { id: "deliver", label: "Return cookie output to caller" },
];

function emptySteps() {
  return FLOW_STEPS.map((s) => ({ ...s, status: "pending" }));
}

class WorkerRegistry {
  constructor() {
    this.workers = new Map();
    this.maxWorkers = 1;
  }

  setMaxWorkers(n) {
    this.maxWorkers = Math.max(1, n);
  }

  startJob(jobId, workerIndex, accountId, requestId) {
    this.workers.set(jobId, {
      jobId,
      workerIndex,
      accountId,
      requestId,
      status: "running",
      flowSteps: emptySteps(),
      startedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    });
  }

  step(jobId, stepId, status, detail) {
    const worker = this.workers.get(jobId);
    if (!worker) return;

    worker.flowSteps = worker.flowSteps.map((step) =>
      step.id === stepId ? { ...step, status, at: new Date().toISOString(), detail } : step
    );
    worker.lastUpdated = new Date().toISOString();
  }

  finish(jobId, finalStatus = "done") {
    const worker = this.workers.get(jobId);
    if (!worker) return [];

    worker.status = finalStatus;
    worker.lastUpdated = new Date().toISOString();
    const steps = [...worker.flowSteps];

    setTimeout(() => this.workers.delete(jobId), 30_000);
    return steps;
  }

  remove(jobId) {
    this.workers.delete(jobId);
  }

  snapshot() {
    const list = [...this.workers.values()].sort((a, b) => a.workerIndex - b.workerIndex);
    const activeWorkers = list.filter((w) => w.status === "running").length;

    return {
      engine: "playwright-chromium",
      status: activeWorkers > 0 ? "running" : "idle",
      activeWorkers,
      maxWorkers: this.maxWorkers,
      workers: list.map((w) => ({
        jobId: w.jobId,
        workerIndex: w.workerIndex,
        accountId: w.accountId,
        requestId: w.requestId,
        status: w.status,
        flowSteps: [...w.flowSteps],
        startedAt: w.startedAt,
        lastUpdated: w.lastUpdated,
      })),
      lastUpdated: new Date().toISOString(),
    };
  }
}

export const workerState = new WorkerRegistry();
