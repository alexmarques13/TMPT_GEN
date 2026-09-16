import { randomUUID } from "crypto";
import { config } from "./config.js";
import { requireEventUrl } from "./event-url.js";
import { generateTmptCookies } from "./generator/index.js";
import { metrics } from "./metrics.js";
import { workerState } from "./worker.js";

export class JobQueue {
  constructor(accounts) {
    this.accounts = accounts;
    this.jobs = new Map();
    this.batches = new Map();
    this.pending = [];
    this.active = 0;
    this.maxConcurrent = config.maxConcurrentJobs;
  }

  get(jobId) {
    return this.jobs.get(jobId);
  }

  getBatch(batchId) {
    const batch = this.batches.get(batchId);
    if (!batch) return null;
    const jobs = batch.jobIds.map((id) => this.jobs.get(id)).filter(Boolean);
    return { ...batch, jobs };
  }

  counts() {
    return { queued: this.pending.length, running: this.active };
  }

  setConcurrency(n) {
    this.maxConcurrent = Math.min(Math.max(1, n), config.maxWorkers);
    workerState.setMaxWorkers(this.maxConcurrent);
    void this.pump();
  }

  enqueue(body, workerIndex = 1, batchId = null) {
    const eventUrl = requireEventUrl(body.eventUrl ?? body.targetUrl);
    const job = {
      id: randomUUID(),
      requestId: body.requestId || randomUUID(),
      accountId: body.accountId,
      eventUrl,
      workerIndex,
      batchId,
      status: "queued",
      createdAt: new Date().toISOString(),
    };

    this.jobs.set(job.id, job);
    this.pending.push(job.id);
    void this.pump();
    return job;
  }

  enqueueBatch(body) {
    const workerCount = Math.min(
      Math.max(1, Number.parseInt(body.workerCount, 10) || 1),
      config.maxWorkers
    );
    const batchId = randomUUID();
    const eventUrl = requireEventUrl(body.eventUrl ?? body.targetUrl);

    this.setConcurrency(workerCount);

    const jobs = [];
    for (let i = 1; i <= workerCount; i += 1) {
      jobs.push(
        this.enqueue(
          {
            accountId: body.accountId,
            eventUrl,
            requestId: body.requestId ? `${body.requestId}-w${i}` : undefined,
          },
          i,
          batchId
        )
      );
    }

    this.batches.set(batchId, {
      id: batchId,
      workerCount,
      accountId: body.accountId,
      eventUrl,
      jobIds: jobs.map((j) => j.id),
      createdAt: new Date().toISOString(),
    });

    return { batchId, workerCount, jobs };
  }

  async pump() {
    while (this.active < this.maxConcurrent && this.pending.length > 0) {
      const jobId = this.pending.shift();
      if (!jobId) return;

      const job = this.jobs.get(jobId);
      if (!job) continue;

      this.active += 1;
      job.status = "running";
      job.startedAt = new Date().toISOString();

      try {
        const account = this.accounts.require(job.accountId);
        const result = await generateTmptCookies({
          account,
          eventUrl: job.eventUrl,
          jobId: job.id,
          workerIndex: job.workerIndex,
          requestId: job.requestId,
        });

        job.status = result.success ? "completed" : "failed";
        job.completedAt = result.completedAt;
        job.result = result;
        job.error = result.error;
        metrics.recordJobFinished(result, job);
      } catch (error) {
        job.status = "failed";
        job.completedAt = new Date().toISOString();
        job.error = error instanceof Error ? error.message : String(error);
        workerState.finish(job.id, "failed");
      } finally {
        this.active -= 1;
        void this.pump();
      }
    }
  }
}
