const TRACKED = ["tmpt", "eps-sid", "reese84", "id-token", "SOTC", "SID"];

function findValue(cookies, name) {
  return cookies.find((c) => c.name === name)?.value ?? null;
}

export function fromPlaywrightCookies(cookies) {
  return cookies.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expirationDate: cookie.expires > 0 ? cookie.expires : undefined,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite?.toLowerCase() ?? null,
    session: cookie.expires <= 0,
  }));
}

export function pickGeneratedCookies(all) {
  return {
    tmpt: findValue(all, "tmpt"),
    epsSid: findValue(all, "eps-sid"),
    reese84: findValue(all, "reese84"),
    idToken: findValue(all, "id-token"),
    all: all.filter((c) => TRACKED.includes(c.name)),
  };
}

export function accountSessionFromInput(cookies) {
  const hasIdToken = Boolean(findValue(cookies, "id-token"));
  const hasSession = cookies.some((c) => c.name === "SID" || c.name === "SOTC");
  return {
    loggedIn: hasIdToken && hasSession,
    idTokenPresent: hasIdToken,
    sessionCookiesPresent: hasSession,
  };
}

export function assessQuality(cookies, gecEndpoint, accountLoggedIn) {
  const tmpt = cookies.tmpt ?? "";
  const checks = {
    hasTmpt: Boolean(tmpt),
    tmptFormat: tmpt.startsWith("1:CAES"),
    tmptLength: tmpt.length >= 80,
    hasIdToken: Boolean(cookies.idToken),
    hasSessionCookies: cookies.all.some((c) => c.name === "SID" || c.name === "SOTC"),
    gecEndpointHit: Boolean(gecEndpoint),
  };

  const notes = [];
  let score = 0;

  if (checks.hasTmpt) score += 40;
  else notes.push("Missing tmpt cookie");
  if (checks.tmptFormat) score += 25;
  else if (checks.hasTmpt) notes.push("tmpt format unexpected");
  if (checks.tmptLength) score += 10;
  else if (checks.hasTmpt) notes.push("tmpt shorter than expected");
  if (checks.gecEndpointHit) score += 15;
  else notes.push("GEC Event endpoint not confirmed");
  if (checks.hasIdToken || accountLoggedIn) {
    score += 5;
    notes.push("Logged-in account session preserved");
  }
  if (checks.hasSessionCookies) score += 5;

  const normalizedScore = Number((score / 100).toFixed(2));
  const valid = checks.hasTmpt && checks.tmptFormat && checks.tmptLength;
  const premium = valid && normalizedScore >= 0.9;

  if (premium) notes.unshift("Premium quality TMPT cookie (score >= 0.9)");
  else if (valid) notes.unshift("Valid TMPT cookie");
  else notes.unshift("TMPT generation incomplete");

  return { score, normalizedScore, premium, valid, checks, notes };
}

export function toPlaywrightCookies(cookies) {
  return cookies.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path || "/",
    expires: cookie.expirationDate ?? -1,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite:
      cookie.sameSite === "strict" ? "Strict" :
      cookie.sameSite === "lax" ? "Lax" :
      cookie.sameSite === "none" ? "None" : undefined,
  }));
}

export function mergeAccountCookies(generated, account) {
  const merged = new Map();
  for (const cookie of generated.all) merged.set(cookie.name, cookie);
  for (const cookie of account.cookies) {
    if (["id-token", "SOTC", "SID", "SORTC", "BID", "tmpt"].includes(cookie.name)) {
      merged.set(cookie.name, cookie);
    }
  }
  if (generated.tmpt) {
    merged.set("tmpt", {
      name: "tmpt",
      value: generated.tmpt,
      domain: ".ticketmaster.com",
      path: "/",
      httpOnly: false,
      secure: true,
      sameSite: null,
    });
  }
  const all = [...merged.values()];
  return {
    tmpt: generated.tmpt,
    epsSid: generated.epsSid,
    reese84: generated.reese84,
    idToken: all.find((c) => c.name === "id-token")?.value ?? generated.idToken,
    all,
  };
}

export function isKasadaEndpoint(url) {
  return url.includes("/149e9513-") && (url.includes("/tl") || /\/r(\?|$)/.test(url));
}
