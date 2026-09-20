export function validateReleaseNotice(detection, source) {
  const signals = detection?.signals ?? {};

  if (
    detection?.type === "already_on_sale" &&
    (signals.onSale ||
      signals.ticketTypeCount > 0 ||
      signals.sectionCount > 0 ||
      signals.offerCount > 0 ||
      signals.hasInventoryData)
  ) {
    return {
      validated: true,
      confidence: 0.85,
      relevant: true,
      checks: { alreadyOnSale: true, saleMarkedOpen: true },
      notes: ["Event already on sale — proceeding to TMPT generation"],
      inventory: {
        ticketTypeCount: signals.ticketTypeCount ?? 0,
        sectionCount: signals.sectionCount ?? 0,
        offerCount: signals.offerCount ?? 0,
        priceLevelCount: signals.priceLevelCount ?? 0,
        availableCount: signals.availableCount ?? 0,
        onSale: true,
        saleStatus: signals.saleStatus ?? "already_on_sale",
        sampleTicketTypes: signals.sample ?? [],
      },
      source: source
        ? { url: source.url, status: source.status, method: source.method, detectedAt: source.detectedAt }
        : null,
    };
  }
  const checks = {
    hasInventoryPayload: Boolean(signals.hasInventoryData),
    hasTicketTypes: signals.ticketTypeCount > 0,
    hasSectionsOrOffers: signals.sectionCount > 0 || signals.offerCount > 0,
    hasPriceLevels: signals.priceLevelCount > 0,
    hasAvailabilityCount: signals.availableCount > 0,
    saleMarkedOpen: Boolean(signals.onSale),
    hasSourceUrl: Boolean(source?.url),
    responseOk: source?.status ? source.status >= 200 && source.status < 400 : true,
  };

  const notes = [];
  let score = 0;

  if (checks.hasInventoryPayload) score += 25;
  else notes.push("Response did not contain inventory payload");

  if (checks.hasTicketTypes) {
    score += 25;
    notes.push(`${signals.ticketTypeCount} ticket type(s) detected`);
  }

  if (checks.hasSectionsOrOffers) {
    score += 20;
    notes.push(`${signals.sectionCount} section(s), ${signals.offerCount} offer(s)`);
  }

  if (checks.hasPriceLevels) score += 10;
  if (checks.hasAvailabilityCount) {
    score += 10;
    notes.push(`${signals.availableCount} available unit(s) reported`);
  }

  if (checks.saleMarkedOpen) {
    score += 10;
    notes.push(`Sale status: ${signals.saleStatus || "open"}`);
  }

  const relevant =
    checks.hasInventoryPayload &&
    (checks.hasTicketTypes || checks.hasSectionsOrOffers || checks.hasAvailabilityCount || checks.saleMarkedOpen);

  const confidence = Number((score / 100).toFixed(2));
  const validated = relevant && confidence >= 0.55;

  if (validated) {
    notes.unshift("Advanced Release Notice validated — ticket inventory loading confirmed");
  } else {
    notes.unshift("Release signal detected but validation incomplete");
  }

  return {
    validated,
    confidence,
    relevant,
    checks,
    notes,
    inventory: {
      ticketTypeCount: signals.ticketTypeCount,
      sectionCount: signals.sectionCount,
      offerCount: signals.offerCount,
      priceLevelCount: signals.priceLevelCount,
      availableCount: signals.availableCount,
      onSale: signals.onSale,
      saleStatus: signals.saleStatus,
      sampleTicketTypes: signals.sample ?? [],
    },
    source: source
      ? {
          url: source.url,
          status: source.status,
          method: source.method,
          detectedAt: source.detectedAt,
        }
      : null,
  };
}
