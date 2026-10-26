import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "./config.js";
import { runCheckup, type CheckupResult } from "./runner.js";
import type { Finding, Job } from "./types.js";
import type { UrlGuard } from "./url-guard.js";

/** Check-ups als achtergrondtaken, met de resultaten op schijf zodat ze een herstart overleven. */
export class JobStore {
  private jobs = new Map<string, Job>();
  private results = new Map<string, CheckupResult>();
  private waiting: string[] = [];
  private running = 0;

  constructor(
    private config: Config,
    private guard: UrlGuard,
  ) {}

  private dir(id: string): string {
    return join(this.config.dataDir, "jobs", id);
  }

  private async save(job: Job): Promise<void> {
    await mkdir(this.dir(job.id), { recursive: true });
    const tmp = join(this.dir(job.id), "job.json.tmp");
    await writeFile(tmp, JSON.stringify(job, null, 2));
    await rename(tmp, join(this.dir(job.id), "job.json"));
  }

  /** Laadt bestaande jobs. Jobs die liepen tijdens een herstart worden als mislukt gemarkeerd. */
  async load(): Promise<void> {
    const root = join(this.config.dataDir, "jobs");
    await mkdir(root, { recursive: true });
    for (const id of await readdir(root)) {
      try {
        const job = JSON.parse(await readFile(join(root, id, "job.json"), "utf8")) as Job;
        if (job.status === "queued" || job.status === "running") {
          job.status = "failed";
          job.error = "De server is herstart tijdens deze check-up. Start ze opnieuw.";
          job.finishedAt = new Date().toISOString();
          await this.save(job);
        }
        this.jobs.set(job.id, job);
      } catch {
        // onvolledige map overslaan
      }
    }
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  async start(url: string, options: { liveDomain?: string } = {}): Promise<Job> {
    const id = `job_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}_${randomBytes(4).toString("hex")}`;
    const job: Job = {
      id,
      url,
      ...(options.liveDomain ? { liveDomain: options.liveDomain } : {}),
      status: "queued",
      createdAt: new Date().toISOString(),
      progress: { pagesDone: 0, pagesFound: 0, phase: "in de wachtrij" },
    };
    this.jobs.set(id, job);
    await this.save(job);
    this.waiting.push(id);
    this.pump();
    return job;
  }

  private pump(): void {
    while (this.running < this.config.jobConcurrency && this.waiting.length > 0) {
      const id = this.waiting.shift()!;
      this.running++;
      this.execute(id).finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  private async execute(id: string): Promise<void> {
    const job = this.jobs.get(id)!;
    job.status = "running";
    job.startedAt = new Date().toISOString();
    await this.save(job);
    let lastSave = 0;
    try {
      const result = await runCheckup(job.url, this.config, this.guard, (progress) => {
        job.progress = progress;
        if (Date.now() - lastSave > 2_000) {
          lastSave = Date.now();
          void this.save(job);
        }
      }, { liveDomain: job.liveDomain });
      await writeFile(join(this.dir(id), "result.json"), JSON.stringify(result, null, 2));
      this.results.set(id, result);
      job.status = "done";
      job.summary = result.summary;
    } catch (error) {
      job.status = "failed";
      job.error = (error as Error).message;
    }
    job.finishedAt = new Date().toISOString();
    await this.save(job);
  }

  async result(id: string): Promise<CheckupResult | undefined> {
    const cached = this.results.get(id);
    if (cached) return cached;
    try {
      const result = JSON.parse(await readFile(join(this.dir(id), "result.json"), "utf8")) as CheckupResult;
      this.results.set(id, result);
      return result;
    } catch {
      return undefined;
    }
  }

  async findings(
    id: string,
    filter: { check?: string; page?: string; hint?: string; offset?: number; limit?: number },
  ): Promise<{ total: number; offset: number; nextOffset: number | null; findings: Finding[] } | undefined> {
    const result = await this.result(id);
    if (!result) return undefined;
    let list = result.findings;
    if (filter.check) list = list.filter((f) => f.check === filter.check);
    if (filter.hint) list = list.filter((f) => f.hint === filter.hint);
    if (filter.page) list = list.filter((f) => f.pages.includes(filter.page!));
    const offset = Math.max(0, filter.offset ?? 0);
    const limit = Math.min(100, Math.max(1, filter.limit ?? 50));
    const page = list.slice(offset, offset + limit);
    return { total: list.length, offset, nextOffset: offset + limit < list.length ? offset + limit : null, findings: page };
  }
}
