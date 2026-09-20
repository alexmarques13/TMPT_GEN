import { config } from "./config.js";

export function isTicketmasterEventUrl(url) {
  return /ticketmaster\.com/i.test(url) && /\/event\/[^/?#]+/i.test(url);
}

export function requireEventUrl(url) {
  const value = url?.trim();
  if (!value) throw new Error("eventUrl is required");
  if (!isTicketmasterEventUrl(value)) {
    throw new Error("eventUrl must be a Ticketmaster event link (must contain /event/...)");
  }
  return value;
}

export function isEventGecEndpoint(url) {
  return url.includes("/epsf/gec/v3/Event");
}
