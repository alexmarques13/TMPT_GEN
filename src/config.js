import { resolve } from "path";

export const config = {
  port: 3847,
  host: "0.0.0.0",
  headless: true,
  proxy: {
    server: "http://163.245.243.2:46280",
    username: "50F247",
    password: "18E9DA47",
  },
  maxConcurrentJobs: 1,
  maxWorkers: 3,
  accountsDir: resolve(process.cwd(), "accounts"),
  apiKey: "",
  gecTimeoutMs: 120_000,
  cookiePollMs: 30_000,
  productVersion: "1.0.0-mvp",
  monitor: {
    pollIntervalMs: 5_000,
    preDropLeadMs: 120_000,
    pageSettleMs: 6_000,
    maxMonitorDurationMs: 3_600_000,
  },
};
