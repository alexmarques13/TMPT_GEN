import { randomUUID } from "crypto";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { join, extname } from "path";
import { AccountStore } from "./accounts.js";
import { config } from "./config.js";
import { requireEventUrl } from "./event-url.js";
import { generateTmptCookies } from "./generator/index.js";
import { metrics } from "./metrics.js";
import { EventMonitorService } from "./monitor/index.js";
import { JobQueue } from "./queue.js";
import { workerState } from "./worker.js";

const accounts = new AccountStore();
const queue = new JobQueue(accounts);
const monitorService = new EventMonitorService(accounts, queue);

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(body, null, 2));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function authorize(req) {
  if (!config.apiKey) return true;
  return req.headers["x-api-key"] === config.apiKey;
}

function staticFile(path) {
  if (!existsSync(path)) return null;
  const ext = extname(path);
  const type = ext === ".html" ? "text/html; charset=utf-8" : "application/octet-stream";
  return { content: readFileSync(path), type };
}

export function startServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const method = req.method || "GET";

    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,X-API-Key",
      });
      res.end();
      return;
    }

    // Static pages
    if (url.pathname === "/" || url.pathname === "/dashboard") {
      const file = staticFile(join(process.cwd(), "public", "dashboard.html"));
      if (file) {
        res.writeHead(200, { "Content-Type": file.type });
        res.end(file.content);
        return;
      }
    }

    if (url.pathname.startsWith("/api/") && !authorize(req)) {
      json(res, 401, { error: "Unauthorized" });
      return;
    }

    const counts = queue.counts();

    // Health & monitoring
    if (method === "GET" && url.pathname === "/api/v1/health") {
      json(res, 200, {
        ok: true,
        version: config.productVersion,
        engine: "playwright-chromium",
        maxWorkers: config.maxWorkers,
        uptimeSeconds: metrics.snapshot(0, 0).uptimeSeconds,
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/v1/worker/status") {
      json(res, 200, {
        ...workerState.snapshot(),
        queuedJobs: counts.queued,
        runningJobs: counts.running,
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/v1/stats") {
      json(res, 200, {
        ...metrics.snapshot(counts.running, counts.queued),
        monitor: monitorService.snapshot(),
      });
      return;
    }

    if (method === "GET" && url.pathname === "/api/v1/monitor/active") {
      json(res, 200, monitorService.snapshot());
      return;
    }

    if (method === "POST" && url.pathname === "/api/v1/monitor/start") {
      try {
        const body = JSON.parse(await readBody(req));
        if (!body.accountId) {
          json(res, 400, { error: "accountId is required" });
          return;
        }
        const profile = accounts.require(body.accountId);
        const hasId = profile.cookies.some((c) => c.name === "id-token");
        const hasSid = profile.cookies.some((c) => c.name === "SID" || c.name === "SOTC");
        if (!hasId || !hasSid) {
          json(res, 400, { error: "Logged-in session cookies required. Add id-token and SID/SOTC via Account." });
          return;
        }
        const monitor = monitorService.start(body);
        json(res, 202, {
          accepted: true,
          monitor,
          pollUrl: `/api/v1/monitor/${monitor.id}`,
        });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (method === "POST" && url.pathname.startsWith("/api/v1/monitor/stop/")) {
      const monitorId = url.pathname.split("/").pop() || "";
      const monitor = monitorService.stop(monitorId);
      if (!monitor) {
        json(res, 404, { error: "Monitor not found" });
        return;
      }
      json(res, 200, { stopped: true, monitor });
      return;
    }

    if (method === "GET" && url.pathname.startsWith("/api/v1/monitor/")) {
      const monitorId = url.pathname.split("/").pop() || "";
      const monitor = monitorService.get(monitorId);
      if (!monitor) {
        json(res, 404, { error: "Monitor not found" });
        return;
      }
      json(res, 200, monitor);
      return;
    }

    if (url.pathname.startsWith("/api/v1/accounts/")) {
      const accountId = decodeURIComponent(url.pathname.split("/").pop() || "");

      if (method === "GET") {
        accounts.reload();
        const profile = accounts.get(accountId);
        if (!profile) {
          json(res, 404, { error: "Account not found" });
          return;
        }
        const hasId = profile.cookies.some((c) => c.name === "id-token");
        const hasSid = profile.cookies.some((c) => c.name === "SID" || c.name === "SOTC");
        json(res, 200, {
          id: profile.id,
          label: profile.label,
          cookies: profile.cookies,
          cookieCount: profile.cookies.length,
          loggedIn: hasId && hasSid,
          idTokenPresent: hasId,
        });
        return;
      }

      if (method === "PUT" || method === "POST") {
        try {
          const body = JSON.parse(await readBody(req));
          const saved = accounts.save(accountId, body);
          const hasId = saved.cookies.some((c) => c.name === "id-token");
          const hasSid = saved.cookies.some((c) => c.name === "SID" || c.name === "SOTC");
          json(res, 200, {
            id: saved.id,
            label: saved.label,
            cookies: saved.cookies,
            cookieCount: saved.cookies.length,
            loggedIn: hasId && hasSid,
          });
        } catch (error) {
          json(res, 400, { error: error instanceof Error ? error.message : String(error) });
        }
        return;
      }
    }

    if (method === "GET" && url.pathname === "/api/v1/accounts") {
      accounts.reload();
      const list = accounts.list().map((account) => {
        const profile = accounts.get(account.id);
        const hasId = profile.cookies.some((c) => c.name === "id-token");
        const hasSid = profile.cookies.some((c) => c.name === "SID" || c.name === "SOTC");
        return { ...account, loggedIn: hasId && hasSid, idTokenPresent: hasId };
      });
      json(res, 200, { accounts: list });
      return;
    }

    // Batch generate (multi-worker)
    if (method === "POST" && url.pathname === "/api/v1/generate/batch") {
      try {
        const body = JSON.parse(await readBody(req));
        if (!body.accountId) {
          json(res, 400, { error: "accountId is required" });
          return;
        }
        accounts.require(body.accountId);
        const batch = queue.enqueueBatch(body);
        json(res, 202, {
          accepted: true,
          batchId: batch.batchId,
          workerCount: batch.workerCount,
          jobs: batch.jobs.map((j) => ({
            jobId: j.id,
            workerIndex: j.workerIndex,
            status: j.status,
          })),
          pollUrl: `/api/v1/batch/${batch.batchId}`,
        });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (method === "GET" && url.pathname.startsWith("/api/v1/batch/")) {
      const batchId = url.pathname.split("/").pop() || "";
      const batch = queue.getBatch(batchId);
      if (!batch) {
        json(res, 404, { error: "Batch not found" });
        return;
      }

      const completed = batch.jobs.filter((j) => j.status === "completed").length;
      const failed = batch.jobs.filter((j) => j.status === "failed").length;
      const running = batch.jobs.filter((j) => j.status === "running").length;
      const queued = batch.jobs.filter((j) => j.status === "queued").length;
      const allDone = completed + failed === batch.jobs.length;

      json(res, allDone ? 200 : 202, {
        batchId: batch.id,
        workerCount: batch.workerCount,
        completed,
        failed,
        running,
        queued,
        done: allDone,
        jobs: batch.jobs.map((j) => ({
          jobId: j.id,
          workerIndex: j.workerIndex,
          status: j.status,
          result: j.result ?? null,
          error: j.error ?? null,
        })),
        worker: workerState.snapshot(),
      });
      return;
    }

    // Sync generate (single worker)
    if (method === "POST" && url.pathname === "/api/v1/generate") {
      try {
        const body = JSON.parse(await readBody(req));
        if (!body.accountId) {
          json(res, 400, { error: "accountId is required" });
          return;
        }

        const eventUrl = requireEventUrl(body.eventUrl ?? body.targetUrl);
        const account = accounts.require(body.accountId);
        const result = await generateTmptCookies({
          account,
          eventUrl,
          jobId: randomUUID(),
          workerIndex: 1,
          requestId: body.requestId || randomUUID(),
        });

        metrics.recordJobFinished(result, {
          id: result.jobId,
          requestId: result.requestId,
          accountId: result.accountId,
          status: result.success ? "completed" : "failed",
          createdAt: result.startedAt,
          startedAt: result.startedAt,
          completedAt: result.completedAt,
          result,
          error: result.error,
        });

        json(res, 200, result);
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    // Async Pub/Sub-style
    if (method === "POST" && url.pathname === "/api/v1/pubsub/request") {
      try {
        const body = JSON.parse(await readBody(req));
        if (!body.accountId) {
          json(res, 400, { error: "accountId is required" });
          return;
        }
        requireEventUrl(body.eventUrl ?? body.targetUrl);
        accounts.require(body.accountId);
        const job = queue.enqueue(body);
        json(res, 202, {
          accepted: true,
          jobId: job.id,
          requestId: job.requestId,
          accountId: job.accountId,
          status: job.status,
          pollUrl: `/api/v1/pubsub/output/${job.id}`,
          outputTopic: "tmpt.generate.result",
        });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    if (method === "GET" && url.pathname.startsWith("/api/v1/pubsub/output/")) {
      const jobId = url.pathname.split("/").pop() || "";
      const job = queue.get(jobId);
      if (!job) {
        json(res, 404, { error: "Job not found" });
        return;
      }

      if (job.status === "completed" || job.status === "failed") {
        json(res, 200, {
          jobId: job.id,
          requestId: job.requestId,
          accountId: job.accountId,
          status: job.status,
          delivered: job.status === "completed",
          result: job.result ?? null,
          error: job.error ?? null,
        });
        return;
      }

      json(res, 202, {
        jobId: job.id,
        requestId: job.requestId,
        status: job.status,
        worker: workerState.snapshot(),
      });
      return;
    }

    json(res, 404, { error: "Not found" });
  });

  server.listen(config.port, config.host, () => {
    console.log(`TMPT Cookie Generator running at http://${config.host}:${config.port}`);
    console.log(`Dashboard: http://localhost:${config.port}/`);
    console.log(`Loaded accounts: ${accounts.list().map((a) => a.id).join(", ") || "(none)"}`);
  });
}
