import { readFileSync, readdirSync, existsSync } from "fs";
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
}
