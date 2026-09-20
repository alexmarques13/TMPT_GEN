const MONITOR_STEPS = [
  { id: "starting", label: "Start event monitor" },
  { id: "baseline", label: "Capture pre-release baseline" },
  { id: "watching", label: "Watch for early ticket loading" },
  { id: "detected", label: "Advanced Release Notice detected" },
  { id: "validated", label: "Validate inventory payload" },
  { id: "trigger", label: "Trigger TMPT generation" },
  { id: "complete", label: "Monitor complete" },
];

function emptySteps() {
  return MONITOR_STEPS.map((step) => ({ ...step, status: "pending" }));
}

class MonitorRegistry {
  constructor() {
    this.monitors = new Map();
  }

  create(record) {
    const monitor = {
      ...record,
      status: "starting",
      phase: "starting",
      flowSteps: emptySteps(),
      pollCount: 0,
      networkHits: [],
      baseline: null,
      detection: null,
      validation: null,
      releaseNotice: null,
      tmptJobId: null,
      tmptTriggered: false,
      error: null,
      startedAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      stopped: false,
    };

    this.monitors.set(monitor.id, monitor);
    return monitor;
  }

  get(id) {
    return this.monitors.get(id) ?? null;
  }

  list() {
    return [...this.monitors.values()].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  update(id, patch) {
    const monitor = this.monitors.get(id);
    if (!monitor) return null;

    Object.assign(monitor, patch, { lastUpdated: new Date().toISOString() });
    return monitor;
  }

  step(id, stepId, status, detail) {
    const monitor = this.monitors.get(id);
    if (!monitor) return;

    monitor.flowSteps = monitor.flowSteps.map((step) =>
      step.id === stepId ? { ...step, status, at: new Date().toISOString(), detail } : step
    );
    monitor.lastUpdated = new Date().toISOString();
  }

  appendNetworkHit(id, hit) {
    const monitor = this.monitors.get(id);
    if (!monitor) return;

    monitor.networkHits.unshift(hit);
    if (monitor.networkHits.length > 30) monitor.networkHits.pop();
    monitor.lastUpdated = new Date().toISOString();
  }

  stop(id, reason) {
    const monitor = this.monitors.get(id);
    if (!monitor) return null;

    monitor.stopped = true;
    monitor.status = "stopped";
    monitor.phase = "stopped";
    monitor.stopReason = reason ?? "Stopped by user";
    monitor.completedAt = new Date().toISOString();
    monitor.lastUpdated = monitor.completedAt;
    return monitor;
  }

  snapshot() {
    const active = this.list().filter((m) => !m.stopped && !["complete", "failed", "stopped"].includes(m.status));
    return {
      activeMonitors: active.length,
      monitors: this.list().slice(0, 20).map((m) => this.publicView(m)),
    };
  }

  publicView(monitor) {
    return {
      id: monitor.id,
      accountId: monitor.accountId,
      eventUrl: monitor.eventUrl,
      expectedDropAt: monitor.expectedDropAt,
      status: monitor.status,
      phase: monitor.phase,
      pollCount: monitor.pollCount,
      autoGenerate: monitor.autoGenerate,
      flowSteps: monitor.flowSteps,
      baseline: monitor.baseline,
      detection: monitor.detection,
      validation: monitor.validation,
      releaseNotice: monitor.releaseNotice,
      tmptJobId: monitor.tmptJobId,
      tmptTriggered: monitor.tmptTriggered,
      networkHits: monitor.networkHits?.slice(0, 10) ?? [],
      error: monitor.error,
      startedAt: monitor.startedAt,
      completedAt: monitor.completedAt,
      lastUpdated: monitor.lastUpdated,
      stopped: monitor.stopped,
    };
  }
}

export const monitorState = new MonitorRegistry();
