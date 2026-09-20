const INVENTORY_URL_HINTS = [
  "/inventory",
  "/availability",
  "/offers",
  "/tickettypes",
  "/ticket-types",
  "/facets",
  "/pricelevels",
  "/price-levels",
  "/sections",
  "/seatmap",
  "/quickpicks",
  "/quick-picks",
  "/manifest",
  "/event/",
  "/gec/",
  "offeradapter",
  "services.ticketmaster",
  "apps.ticketmaster",
  "discovery/v2",
  "unifiedconfig",
  "quickpick",
  "availability",
];

const INVENTORY_BODY_KEYS = [
  "ticketTypes",
  "tickettypes",
  "offers",
  "sections",
  "priceLevels",
  "pricelevels",
  "availability",
  "inventory",
  "facets",
  "quickPicks",
  "quickpicks",
  "manifest",
  "seatMap",
  "seatmap",
  "onSale",
  "onsale",
  "saleStatus",
  "eventStatus",
  "totalTickets",
  "available",
  "places",
  "products",
];

const OPEN_UI_PATTERNS = [
  /\bopen\b/i,
  /\bon sale\b/i,
  /\bbuy tickets\b/i,
  /\bget tickets\b/i,
  /\bfind tickets\b/i,
  /\bsee tickets\b/i,
  /\bbuy now\b/i,
  /\bselect tickets\b/i,
  /\bselect seats\b/i,
  /\bchoose seats\b/i,
  /\bfrom \$\d+/i,
  /\btickets available\b/i,
  /\bofficial tickets\b/i,
];

export function isActiveSale(signals) {
  if (!signals) return false;
  if (signals.onSale) return true;
  if (signals.ticketTypeCount > 0 || signals.sectionCount > 0 || signals.offerCount > 0) return true;
  if (signals.availableCount > 0 || signals.priceLevelCount > 0) return true;
  if (signals.saleStatus === "open_ui" || signals.saleStatus === "on_sale") return true;
  return Boolean(signals.hasInventoryData && signals.saleStatus);
}

export function detectLiveEventPage(pageText) {
  if (!pageText || pageText.length < 80) return null;
  if (/\bsold out\b/i.test(pageText) && !OPEN_UI_PATTERNS.some((pattern) => pattern.test(pageText))) {
    return null;
  }
  if (!/ticketmaster/i.test(pageText)) return null;

  const looksLive =
    OPEN_UI_PATTERNS.some((pattern) => pattern.test(pageText)) ||
    /\b(seat map|venue|event details|doors open|parking)\b/i.test(pageText);

  if (!looksLive) return null;

  return {
    hasInventoryData: true,
    onSale: true,
    saleStatus: "live_event_page",
    ticketTypeCount: 0,
    sectionCount: 0,
    offerCount: 0,
    priceLevelCount: 0,
    availableCount: 0,
    sample: ["Live event page"],
  };
}

export function detectAlreadyOnSale(baseline, current, openUiDetected, pageText) {
  const livePage = detectLiveEventPage(pageText);
  const signals = livePage ? { ...current, ...livePage } : current;
  const active = openUiDetected || isActiveSale(signals);
  if (!active) return null;

  return {
    type: "already_on_sale",
    earlyRelease: false,
    leadSecondsBeforeDrop: null,
    signals: {
      ...signals,
      hasInventoryData: true,
      onSale: signals.onSale || openUiDetected,
      saleStatus: signals.saleStatus ?? (openUiDetected ? "open_ui" : "on_sale"),
    },
    baseline: baseline ?? null,
  };
}

export function isInventoryRelatedUrl(url) {
  const lower = url.toLowerCase();
  if (!lower.includes("ticketmaster.com")) return false;
  return INVENTORY_URL_HINTS.some((hint) => lower.includes(hint));
}

export function extractInventorySignals(body) {
  if (!body || typeof body !== "object") {
    return {
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
  }

  const ticketTypes = findArray(body, ["ticketTypes", "tickettypes", "products"]);
  const sections = findArray(body, ["sections", "places", "facets"]);
  const offers = findArray(body, ["offers", "quickPicks", "quickpicks"]);
  const priceLevels = findArray(body, ["priceLevels", "pricelevels"]);

  const onSale = findBoolean(body, ["onSale", "onsale"]) || findSaleOpen(body);
  const saleStatus = findString(body, ["saleStatus", "eventStatus", "status"]);
  const availableCount = countAvailable(body);

  const sample = [];
  for (const item of ticketTypes.slice(0, 3)) {
    const name = item?.name || item?.description || item?.type || item?.id;
    if (name) sample.push(String(name));
  }

  const hasInventoryData =
    ticketTypes.length > 0 ||
    sections.length > 0 ||
    offers.length > 0 ||
    priceLevels.length > 0 ||
    availableCount > 0 ||
    onSale;

  return {
    hasInventoryData,
    ticketTypeCount: ticketTypes.length,
    sectionCount: sections.length,
    offerCount: offers.length,
    priceLevelCount: priceLevels.length,
    availableCount,
    onSale,
    saleStatus,
    sample,
  };
}

export function detectEarlyRelease({ baseline, current, detectedAt, expectedDropAt }) {
  if (!current?.hasInventoryData) return null;

  const baselineHadInventory =
    baseline?.hasInventoryData &&
    (baseline.ticketTypeCount > 0 || baseline.sectionCount > 0 || baseline.offerCount > 0);

  const inventoryAppeared =
    !baselineHadInventory &&
    (current.ticketTypeCount > 0 ||
      current.sectionCount > 0 ||
      current.offerCount > 0 ||
      current.priceLevelCount > 0 ||
      current.availableCount > 0);

  const inventoryIncreased =
    baselineHadInventory &&
    (current.ticketTypeCount > baseline.ticketTypeCount ||
      current.sectionCount > baseline.sectionCount ||
      current.offerCount > baseline.offerCount ||
      current.availableCount > baseline.availableCount);

  const saleOpened = !baseline?.onSale && current.onSale;

  if (!inventoryAppeared && !inventoryIncreased && !saleOpened) return null;

  let leadSeconds = null;
  if (expectedDropAt) {
    const dropMs = new Date(expectedDropAt).getTime();
    if (!Number.isNaN(dropMs)) {
      leadSeconds = Math.round((dropMs - new Date(detectedAt).getTime()) / 1000);
    }
  }

  return {
    type: inventoryAppeared ? "inventory_appeared" : saleOpened ? "sale_opened" : "inventory_increased",
    leadSecondsBeforeDrop: leadSeconds,
    earlyRelease: leadSeconds === null ? null : leadSeconds > 0,
    signals: current,
    baseline: baseline ?? null,
  };
}

export function detectOpenUiSignal(pageText) {
  if (!pageText) return false;
  return OPEN_UI_PATTERNS.some((pattern) => pattern.test(pageText));
}

function findArray(obj, keys, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 4) return [];

  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value) && value.length > 0) return value;
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const nested = findArray(value, keys, depth + 1);
      if (nested.length > 0) return nested;
    }
  }

  return [];
}

function findBoolean(obj, keys, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 4) return false;

  for (const key of keys) {
    if (typeof obj[key] === "boolean") return obj[key];
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const nested = findBoolean(value, keys, depth + 1);
      if (nested) return true;
    }
  }

  return false;
}

function findString(obj, keys, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 4) return null;

  for (const key of keys) {
    if (typeof obj[key] === "string" && obj[key].trim()) return obj[key];
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const nested = findString(value, keys, depth + 1);
      if (nested) return nested;
    }
  }

  return null;
}

function findSaleOpen(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 4) return false;

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      const lower = value.toLowerCase();
      if (
        (key.toLowerCase().includes("status") || key.toLowerCase().includes("sale")) &&
        (lower.includes("open") || lower.includes("onsale") || lower.includes("on sale"))
      ) {
        return true;
      }
    }
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      if (findSaleOpen(value, depth + 1)) return true;
    }
  }

  return false;
}

function countAvailable(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 4) return 0;

  let total = 0;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "number" && /available|remaining|count|quantity/i.test(key)) {
      total += value;
    }
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      total += countAvailable(value, depth + 1);
    }
  }

  return total;
}

export function bodyLooksLikeInventory(rawText) {
  if (!rawText || rawText.length < 2) return false;
  try {
    const parsed = JSON.parse(rawText);
    return extractInventorySignals(parsed).hasInventoryData;
  } catch {
    return INVENTORY_BODY_KEYS.some((key) => rawText.toLowerCase().includes(`"${key.toLowerCase()}"`));
  }
}
