import { config } from "./config.js";
import { workerState } from "./worker.js";

class MetricsStore {
  constructor() {
    this.startedAt = Date.now();
    this.durations = [];
    this.qualityScores = [];
    this.totalJobs = 0;
    this.completedJobs = 0;
    this.failedJobs = 0;
    this.premiumJobs = 0;
    this.recentJobs = [];
  }

  recordJobFinished(result, job) {
    this.totalJobs += 1;
    if (result.success) this.completedJobs += 1;
    else this.failedJobs += 1;
    if (result.quality.premium) this.premiumJobs += 1;

    this.durations.push(result.durationMs);
    this.qualityScores.push(result.quality.normalizedScore);
    if (this.durations.length > 500) this.durations.shift();
    if (this.qualityScores.length > 500) this.qualityScores.shift();

    this.recentJobs.unshift(job);
    if (this.recentJobs.length > 50) this.recentJobs.pop();
  }

  snapshot(runningJobs, queuedJobs) {
    const uptimeSeconds = Math.floor((Date.now() - this.startedAt) / 1000);
    const sorted = [...this.durations].sort((a, b) => a - b);
    const avgDurationMs =
      sorted.length === 0 ? 0 : Math.round(sorted.reduce((sum, v) => sum + v, 0) / sorted.length);
    const p95DurationMs =
      sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const avgQualityScore =
      this.qualityScores.length === 0
        ? 0
        : Number((this.qualityScores.reduce((sum, v) => sum + v, 0) / this.qualityScores.length).toFixed(2));

    const hours = Math.max(uptimeSeconds / 3600, 1 / 3600);
    const finished = this.completedJobs + this.failedJobs;

    return {
      uptimeSeconds,
      totalJobs: this.totalJobs,
      completedJobs: this.completedJobs,
      failedJobs: this.failedJobs,
      queuedJobs,
      runningJobs,
      successRate: finished === 0 ? 0 : Number(((this.completedJobs / finished) * 100).toFixed(2)),
      avgDurationMs,
      p95DurationMs,
      throughputPerHour: Number((finished / hours).toFixed(2)),
      avgQualityScore,
      premiumRate: finished === 0 ? 0 : Number(((this.premiumJobs / finished) * 100).toFixed(2)),
      worker: workerState.snapshot(),
      proxy: {
        server: config.proxy.server,
        jobsOnProxy: finished,
        successOnProxy: this.completedJobs,
        avgDurationMs,
      },
      recentJobs: this.recentJobs.slice(0, 20),
    };
  }
}

export const metrics = new MetricsStore();
