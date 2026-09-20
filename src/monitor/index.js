import { randomUUID } from "crypto";
import { config } from "../config.js";
import { requireEventUrl } from "../event-url.js";
import { detectAlreadyOnSale, detectEarlyRelease, extractInventorySignals } from "./detector.js";
import { runMonitorPoll } from "./browser-monitor.js";
import { monitorState } from "./state.js";
import { validateReleaseNotice } from "./validator.js";

async function sleep(ms, monitorId) {
  const step = 400;
  let elapsed = 0;
  while (elapsed < ms) {
    if (monitorState.get(monitorId)?.stopped) return;
    const wait = Math.min(step, ms - elapsed);
    await new Promise((resolve) => setTimeout(resolve, wait));
    elapsed += wait;
  }
}

function mergeSignals(hits) {
  const merged = {
    hasInventoryData: false,
    ticketTypeCount: 0,
    sectionCount: 0,
    offerCount: 0,
    priceLevelCount: 0,
    availableCount: 0,
    onSale: false,
    saleStatus: null,
    sample: [],
  };

  for (const hit of hits) {
    const s = hit.signals ?? {};
    merged.hasInventoryData = merged.hasInventoryData || Boolean(s.hasInventoryData);
    merged.ticketTypeCount = Math.max(merged.ticketTypeCount, s.ticketTypeCount ?? 0);
    merged.sectionCount = Math.max(merged.sectionCount, s.sectionCount ?? 0);
    merged.offerCount = Math.max(merged.offerCount, s.offerCount ?? 0);
    merged.priceLevelCount = Math.max(merged.priceLevelCount, s.priceLevelCount ?? 0);
    merged.availableCount = Math.max(merged.availableCount, s.availableCount ?? 0);
    merged.onSale = merged.onSale || Boolean(s.onSale);
    if (s.saleStatus) merged.saleStatus = s.saleStatus;
    if (s.sample?.length) merged.sample.push(...s.sample);
  }

  merged.sample = [...new Set(merged.sample)].slice(0, 5);
  return merged;
}

function pickBestHit(hits) {
  return (
    hits.find((h) => h.signals?.ticketTypeCount > 0) ||
    hits.find((h) => h.signals?.sectionCount > 0 || h.signals?.offerCount > 0) ||
    hits.find((h) => h.signals?.hasInventoryData) ||
    hits[0] ||
    null
  );
}

function finishAlreadyOnSale(queue, monitorId, account, current, baseline, poll, merged) {
  const detection = detectAlreadyOnSale(baseline, merged, poll.openUiDetected, poll.pageTextPreview);
  if (!detection) return false;

  const bestHit =
    pickBestHit(poll.hits) ??
    ({
      url: current.eventUrl,
      status: 200,
      method: poll.openUiDetected ? "UI" : "POLL",
      detectedAt: new Date().toISOString(),
      signals: detection.signals,
    });

  return processReleaseDetection(queue, monitorId, account, current, detection, bestHit);
}

async function processReleaseDetection(queue, monitorId, account, current, detection, bestHit) {
  monitorState.update(monitorId, {
    phase: "detected",
    status: "release_detected",
    detection,
  });
  monitorState.step(monitorId, "watching", "done", detection.type);
  monitorState.step(monitorId, "detected", "done", formatLead(detection));

  const validation = validateReleaseNotice(detection, bestHit);
  monitorState.update(monitorId, {
    phase: validation.validated ? "validated" : "validation_failed",
    status: validation.validated ? "validated" : "validation_failed",
    validation,
  });
  monitorState.step(
    monitorId,
    "validated",
    validation.validated ? "done" : "failed",
    `confidence ${validation.confidence}`
  );

  const releaseNotice = {
    id: randomUUID(),
    monitorId,
    accountId: current.accountId,
    eventUrl: current.eventUrl,
    detectedAt: bestHit?.detectedAt ?? new Date().toISOString(),
    expectedDropAt: current.expectedDropAt,
    earlyRelease: detection.earlyRelease,
    leadSecondsBeforeDrop: detection.leadSecondsBeforeDrop,
    detectionType: detection.type,
    validation,
    inventory: validation.inventory,
  };

  monitorState.update(monitorId, { releaseNotice });

  if (!validation.validated) {
    monitorState.update(monitorId, {
      status: "failed",
      phase: "validation_failed",
      error: "Release signal detected but inventory validation failed",
      completedAt: new Date().toISOString(),
    });
    monitorState.step(monitorId, "complete", "failed");
    return false;
  }

  if (current.autoGenerate) {
    monitorState.step(monitorId, "trigger", "running", "Queueing TMPT session");
    const job = queue.enqueue({
      accountId: current.accountId,
      eventUrl: current.eventUrl,
      requestId: `arn-${monitorId.slice(0, 8)}`,
    });

    monitorState.update(monitorId, {
      tmptTriggered: true,
      tmptJobId: job.id,
      phase: "generating_tmpt",
      status: "generating_tmpt",
    });
    monitorState.step(monitorId, "trigger", "done", `job ${job.id.slice(0, 8)}`);
  } else {
    monitorState.step(monitorId, "trigger", "done", "Skipped — autoGenerate disabled");
  }

  monitorState.update(monitorId, {
    status: "complete",
    phase: "complete",
    completedAt: new Date().toISOString(),
  });
  monitorState.step(monitorId, "complete", "done");
  return true;
}

export class EventMonitorService {
  constructor(accounts, queue) {
    this.accounts = accounts;
    this.queue = queue;
    this.runners = new Map();
  }

  start(body) {
    const eventUrl = requireEventUrl(body.eventUrl ?? body.targetUrl);
    const account = this.accounts.require(body.accountId);
    const monitorId = randomUUID();

    const monitor = monitorState.create({
      id: monitorId,
      accountId: account.id,
      eventUrl,
      expectedDropAt: body.expectedDropAt ?? null,
      autoGenerate: body.autoGenerate !== false,
      pollIntervalMs: Number.parseInt(body.pollIntervalMs, 10) || config.monitor.pollIntervalMs,
      preDropLeadMs: Number.parseInt(body.preDropLeadMs, 10) || config.monitor.preDropLeadMs,
    });

    monitorState.step(monitorId, "starting", "running", "Launching monitor worker");
    const runner = this.runLoop(monitorId, account);
    this.runners.set(monitorId, runner);

    return monitorState.publicView(monitor);
  }

  stop(monitorId) {
    const monitor = monitorState.get(monitorId);
    if (!monitor) return null;
    monitorState.stop(monitorId, "Stopped by API request");
    this.runners.delete(monitorId);
    return monitorState.publicView(monitorState.get(monitorId));
  }

  get(monitorId) {
    const monitor = monitorState.get(monitorId);
    return monitor ? monitorState.publicView(monitor) : null;
  }

  snapshot() {
    return monitorState.snapshot();
  }

  async runLoop(monitorId, account) {
    const monitor = monitorState.get(monitorId);
    if (!monitor) return;

    try {
      monitorState.update(monitorId, { status: "monitoring", phase: "baseline" });
      monitorState.step(monitorId, "starting", "done");
      monitorState.step(monitorId, "baseline", "running", "Capturing pre-release signals");

      let baseline = null;

      while (!monitorState.get(monitorId)?.stopped) {
        const current = monitorState.get(monitorId);
        if (!current || current.stopped) break;

        if (current.expectedDropAt) {
          const dropMs = new Date(current.expectedDropAt).getTime();
          const now = Date.now();
          const waitUntil = dropMs - current.preDropLeadMs;

          if (!Number.isNaN(dropMs) && now < waitUntil) {
            monitorState.update(monitorId, {
              phase: "waiting",
              status: "waiting_for_drop",
              nextPollAt: new Date(waitUntil).toISOString(),
            });
            await sleep(Math.min(waitUntil - now, 5_000), monitorId);
            continue;
          }
        }

        monitorState.update(monitorId, {
          phase: baseline ? "watching" : "baseline",
          status: "monitoring",
          pollCount: current.pollCount + 1,
        });

        if (baseline) {
          monitorState.step(monitorId, "baseline", "done");
          monitorState.step(monitorId, "watching", "running", `Poll #${current.pollCount + 1}`);
        }

        if (monitorState.get(monitorId)?.stopped) break;

        const poll = await runMonitorPoll({
          eventUrl: current.eventUrl,
          cookies: account.cookies,
          onNetworkHit: (hit) => monitorState.appendNetworkHit(monitorId, hit),
        });

        if (monitorState.get(monitorId)?.stopped) break;

        const merged = mergeSignals(poll.hits);
        if (poll.openUiDetected) {
          merged.onSale = true;
          merged.hasInventoryData = true;
          merged.saleStatus = merged.saleStatus ?? "open_ui";
        }

        if (!baseline) {
          baseline = merged;
          monitorState.update(monitorId, { baseline });
          monitorState.step(monitorId, "baseline", "done", summarizeSignals(baseline));

          monitorState.step(monitorId, "watching", "running", "Checking on-sale state");
          if (await finishAlreadyOnSale(this.queue, monitorId, account, current, baseline, poll, merged)) {
            break;
          }

          await sleep(current.pollIntervalMs, monitorId);
          continue;
        }

        const bestHit = pickBestHit(poll.hits);
        const alreadyOnSale = detectAlreadyOnSale(
          baseline,
          merged,
          poll.openUiDetected,
          poll.pageTextPreview
        );
        if (alreadyOnSale) {
          await processReleaseDetection(this.queue, monitorId, account, current, alreadyOnSale, bestHit);
          break;
        }

        const detection = detectEarlyRelease({
          baseline,
          current: merged,
          detectedAt: new Date().toISOString(),
          expectedDropAt: current.expectedDropAt,
        });

        if (!detection) {
          await sleep(current.pollIntervalMs, monitorId);
          continue;
        }

        await processReleaseDetection(this.queue, monitorId, account, current, detection, bestHit);
        break;
      }

      if (monitorState.get(monitorId)?.stopped) {
        monitorState.update(monitorId, {
          status: "stopped",
          phase: "stopped",
          completedAt: new Date().toISOString(),
        });
        monitorState.step(monitorId, "watching", "done", "Stopped");
        monitorState.step(monitorId, "complete", "done", "Stopped by user");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      monitorState.update(monitorId, {
        status: "failed",
        phase: "failed",
        error: message,
        completedAt: new Date().toISOString(),
      });
      monitorState.step(monitorId, "complete", "failed", message);
    } finally {
      this.runners.delete(monitorId);
    }
  }
}

function summarizeSignals(signals) {
  return `types=${signals.ticketTypeCount} sections=${signals.sectionCount} offers=${signals.offerCount}`;
}

function formatLead(detection) {
  if (detection.leadSecondsBeforeDrop === null) return detection.type;
  if (detection.leadSecondsBeforeDrop > 0) {
    return `${detection.type} · ${detection.leadSecondsBeforeDrop}s before expected drop`;
  }
  return `${detection.type} · ${Math.abs(detection.leadSecondsBeforeDrop)}s after expected drop`;
}

export { extractInventorySignals };
