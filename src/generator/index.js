import { config } from "../config.js";
import { requireEventUrl } from "../event-url.js";
import { workerState } from "../worker.js";
import { runBrowserPass } from "./browser.js";
import {
  accountSessionFromInput,
  assessQuality,
  mergeAccountCookies,
  pickGeneratedCookies,
} from "./cookies.js";

export async function generateTmptCookies(options) {
  const startedAt = new Date();
  const eventUrl = requireEventUrl(options.eventUrl);
  const accountSession = accountSessionFromInput(options.account.cookies);
  const jobId = options.jobId;
  const workerIndex = options.workerIndex ?? 1;

  workerState.startJob(jobId, workerIndex, options.account.id, options.requestId);
  workerState.step(
    jobId,
    "load-account",
    "done",
    `account ${options.account.id}: ${options.account.cookies.length} session cookies ready for output`
  );

  let gecEndpoint = null;
  let generated = pickGeneratedCookies([]);
  const passOptions = { eventUrl, jobId };

  try {
    let outcome = await runBrowserPass(passOptions, [], "Playwright + Chromium event flow");
    generated = mergeAccountCookies(outcome.generated, options.account);
    gecEndpoint = outcome.gecEndpoint;

    if (!generated.tmpt) {
      outcome = await runBrowserPass(passOptions, options.account.cookies, "account-seeded retry");
      generated = mergeAccountCookies(outcome.generated, options.account);
      gecEndpoint = outcome.gecEndpoint ?? gecEndpoint;
    }

    const quality = assessQuality(generated, gecEndpoint, accountSession.loggedIn);

    if (quality.valid) {
      workerState.step(jobId, "tmpt", "done", `${generated.tmpt?.length ?? 0} chars`);
      workerState.step(jobId, "deliver", "done", `score ${quality.normalizedScore} + account cookies`);
    } else {
      workerState.step(jobId, "tmpt", "failed", quality.notes.join("; "));
      workerState.step(jobId, "deliver", "failed");
    }

    const flowSteps = workerState.finish(jobId, quality.valid ? "done" : "failed");
    const completedAt = new Date();

    return {
      jobId,
      workerIndex,
      requestId: options.requestId,
      accountId: options.account.id,
      success: quality.valid,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      eventUrl,
      gecEndpoint,
      flowSteps,
      accountSession,
      cookies: generated,
      quality,
      error: quality.valid ? undefined : quality.notes.join("; "),
    };
  } catch (error) {
    workerState.step(jobId, "tmpt", "failed");
    workerState.step(jobId, "deliver", "failed");
    const flowSteps = workerState.finish(jobId, "failed");
    const completedAt = new Date();
    const message = error instanceof Error ? error.message : String(error);

    return {
      jobId,
      workerIndex,
      requestId: options.requestId,
      accountId: options.account.id,
      success: false,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      eventUrl,
      gecEndpoint,
      flowSteps,
      accountSession,
      cookies: generated,
      quality: assessQuality(generated, gecEndpoint, accountSession.loggedIn),
      error: message,
    };
  }
}
