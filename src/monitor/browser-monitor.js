import { chromium } from "playwright";
import { config } from "../config.js";
import { toPlaywrightCookies } from "../generator/cookies.js";
import {
  bodyLooksLikeInventory,
  detectOpenUiSignal,
  extractInventorySignals,
  isInventoryRelatedUrl,
} from "./detector.js";

export async function runMonitorPoll(options) {
  const { eventUrl, cookies, onNetworkHit } = options;
  let browser = null;
  const hits = [];

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

    if (cookies?.length) {
      await context.addCookies(toPlaywrightCookies(cookies));
    }

    const page = await context.newPage();

    page.on("response", async (response) => {
      const url = response.url();
      const status = response.status();
      const method = response.request().method();

      if (status >= 400) return;
      if (!isInventoryRelatedUrl(url) && !url.includes("/api/")) return;

      let bodyText = "";
      try {
        bodyText = await response.text();
      } catch {
        return;
      }

      if (!bodyLooksLikeInventory(bodyText) && !isInventoryRelatedUrl(url)) return;

      let parsed = null;
      let signals = { hasInventoryData: false };
      try {
        parsed = JSON.parse(bodyText);
        signals = extractInventorySignals(parsed);
      } catch {
        signals = { hasInventoryData: bodyLooksLikeInventory(bodyText) };
      }

      const hit = {
        url,
        status,
        method,
        detectedAt: new Date().toISOString(),
        signals,
        bodyPreview: bodyText.slice(0, 400),
      };

      hits.push(hit);
      onNetworkHit?.(hit);
    });

    await page.goto(eventUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

    await Promise.race([
      page
        .waitForResponse((response) => isInventoryRelatedUrl(response.url()), { timeout: 12_000 })
        .catch(() => null),
      page.waitForTimeout(config.monitor.pageSettleMs),
    ]);

    await page.waitForTimeout(Math.min(config.monitor.pageSettleMs, 4_000));

    const pageProbe = await page.evaluate(() => {
      const text = document.body?.innerText?.slice(0, 12000) ?? "";
      const buttonText = [...document.querySelectorAll("button, a[role='button'], a")]
        .map((el) => el.textContent?.trim() ?? "")
        .filter(Boolean)
        .slice(0, 40)
        .join(" ");
      const ariaLabels = [...document.querySelectorAll("[aria-label]")]
        .map((el) => el.getAttribute("aria-label") ?? "")
        .join(" ");
      return { text, buttonText, ariaLabels };
    });

    const combinedText = `${pageProbe.text}\n${pageProbe.buttonText}\n${pageProbe.ariaLabels}`;
    const openUiDetected = detectOpenUiSignal(combinedText);
    const pageText = pageProbe.text;

    if (openUiDetected) {
      hits.push({
        url: eventUrl,
        status: 200,
        method: "UI",
        detectedAt: new Date().toISOString(),
        signals: {
          hasInventoryData: true,
          ticketTypeCount: 0,
          sectionCount: 0,
          offerCount: 0,
          priceLevelCount: 0,
          availableCount: 0,
          onSale: true,
          saleStatus: "open_ui",
          sample: ["OPEN UI detected"],
        },
        bodyPreview: pageText.slice(0, 400),
        source: "page_text",
      });
    }

    return {
      hits,
      pageTextPreview: pageText.slice(0, 500),
      openUiDetected,
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
