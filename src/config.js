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
  defaultEventUrl:
    "https://www.ticketmaster.com/event/Z7r9jZ1A7QFqg?refArtist=K8vZ9171ok7&f_simplified_filter=true&f_enable_merch_slot=true",
  maxConcurrentJobs: 1,
  maxWorkers: 3,
  accountsDir: resolve(process.cwd(), "accounts"),
  apiKey: "",
  gecTimeoutMs: 120_000,
  cookiePollMs: 30_000,
  productVersion: "1.0.0-mvp",
};
