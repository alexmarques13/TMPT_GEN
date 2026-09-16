import { chromium } from "playwright";
import { config } from "../config.js";
import { isEventGecEndpoint } from "../event-url.js";
import { workerState } from "../worker.js";
import {
  fromPlaywrightCookies,
  isKasadaEndpoint,
  pickGeneratedCookies,
  toPlaywrightCookies,
} from "./cookies.js";

async function waitForTmpt(context, page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const cookies = await context.cookies("https://www.ticketmaster.com");
    const tmpt = cookies.find((c) => c.name === "tmpt");
    if (tmpt?.value) return tmpt.value;

    const fromPage = await page
      .evaluate(() => {
        const match = document.cookie.match(/(?:^|;\s*)tmpt=([^;]+)/);
        return match ? decodeURIComponent(match[1]) : null;
      })
      .catch(() => null);

    if (fromPage) return fromPage;
    await page.waitForTimeout(500);
  }

  return null;
}

export async function runBrowserPass(options, seedCookies, passLabel) {
  let gecEndpoint = null;
  let browser = null;
  const { eventUrl, jobId } = options;

  workerState.step(jobId, "launch-browser", "running", `${passLabel} · ${config.headless ? "headless" : "headed"}`);

  try {
    browser = await chromium.launch({
      headless: config.headless,
      proxy: config.proxy,
      args: ["--disable-blink-features=AutomationControlled"],
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    if (seedCookies.length > 0) {
      await context.addCookies(toPlaywrightCookies(seedCookies));
    }

    workerState.step(jobId, "launch-browser", "done", passLabel);

    const page = await context.newPage();

    page.on("response", (response) => {
      const url = response.url();
      if (isKasadaEndpoint(url) && response.request().method() === "POST" && response.status() === 200) {
        workerState.step(jobId, "kasada", "done", "Kasada challenge passed");
      }
      if (isEventGecEndpoint(url) && response.request().method() === "POST" && response.status() === 200) {
        gecEndpoint = url;
        workerState.step(jobId, "gec", "done", url.split("ticketmaster.com")[1] ?? url);
      }
    });

    workerState.step(jobId, "navigate", "running", eventUrl);
    workerState.step(jobId, "kasada", "running");
    await page.goto(eventUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    workerState.step(jobId, "navigate", "done");

    await page
      .waitForResponse(
        (response) =>
          isEventGecEndpoint(response.url()) &&
          response.request().method() === "POST" &&
          response.status() === 200,
        { timeout: config.gecTimeoutMs }
      )
      .catch(() => undefined);

    workerState.step(jobId, "tmpt", "running");
    const tmpt = await waitForTmpt(context, page, config.cookiePollMs);

    const playwrightCookies = await context.cookies("https://www.ticketmaster.com");
    const stored = fromPlaywrightCookies(playwrightCookies);
    const generated = pickGeneratedCookies(stored);

    if (!generated.tmpt && tmpt) {
      generated.tmpt = tmpt;
      generated.all.push({
        name: "tmpt",
        value: tmpt,
        domain: ".ticketmaster.com",
        path: "/",
        httpOnly: false,
        secure: true,
        sameSite: null,
      });
    }

    return { gecEndpoint, generated };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
