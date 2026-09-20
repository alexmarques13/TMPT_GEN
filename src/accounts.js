import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { config } from "./config.js";

function loadAccountFile(filePath) {
  const raw = JSON.parse(readFileSync(filePath, "utf-8"));

  if (Array.isArray(raw)) {
    const id = filePath.split(/[/\\]/).pop()?.replace(/\.json$/i, "") ?? "unknown";
    return { id, label: id, cookies: raw };
  }

  return raw;
}

export class AccountStore {
  constructor(dir = config.accountsDir) {
    this.dir = dir;
    this.accounts = new Map();
    this.reload();
  }

  reload() {
    this.accounts.clear();
    if (!existsSync(this.dir)) return;

    for (const file of readdirSync(this.dir)) {
      if (!file.endsWith(".json")) continue;
      const profile = loadAccountFile(join(this.dir, file));
      this.accounts.set(profile.id, profile);
    }
  }

  list() {
    return [...this.accounts.values()].map((account) => ({
      id: account.id,
      label: account.label,
      cookieCount: account.cookies.length,
    }));
  }

  get(accountId) {
    return this.accounts.get(accountId);
  }

  require(accountId) {
    const account = this.get(accountId);
    if (!account) throw new Error(`Unknown accountId: ${accountId}`);
    return account;
  }

  save(accountId, body) {
    let cookies = body.cookies;
    if (!cookies && Array.isArray(body)) cookies = body;

    if (!Array.isArray(cookies)) {
      throw new Error("cookies must be a JSON array");
    }

    for (const cookie of cookies) {
      if (!cookie?.name || cookie.value === undefined) {
        throw new Error("Each cookie must have name and value");
      }
    }

    const existing = this.get(accountId);
    const profile = {
      id: accountId,
      label: body.label?.trim() || existing?.label || accountId,
      cookies,
    };

    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${accountId}.json`), JSON.stringify(profile, null, 2), "utf-8");
    this.accounts.set(accountId, profile);
    return profile;
  }
}
