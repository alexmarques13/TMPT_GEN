import { config } from "./config.js";

export function requireEventUrl(url) {
  const value = url?.trim();
  if (!value) throw new Error("eventUrl is required");
  if (!/ticketmaster\.com\/event\//i.test(value)) {
    throw new Error("eventUrl must be a Ticketmaster event link (https://www.ticketmaster.com/event/...)");
  }
  return value;
}

export function isEventGecEndpoint(url) {
  return url.includes("/epsf/gec/v3/Event");
}
