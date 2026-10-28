// Bewaart de screenshots van get_screenshot, zodat het rapport ernaar kan linken.
// Een link opent zonder API-sleutel: de id is 24 willekeurige tekens en dus niet te raden.
// Na SCREENSHOT_DAYS dagen worden de beelden opgeruimd.

import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SCREENSHOT_ROUTE = "/screenshots/";
const ID = /^[A-Za-z0-9_-]{24}$/;
const DAY = 24 * 60 * 60 * 1000;

export class ScreenshotStore {
  constructor(
    private dir: string,
    private retentionDays: number,
  ) {}

  /** Bewaart een JPEG en geeft de id terug. */
  async save(image: Buffer): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const id = randomBytes(18).toString("base64url");
    await writeFile(join(this.dir, `${id}.jpg`), image);
    return id;
  }

  /** Het beeld bij een id, of undefined als de id ongeldig, onbekend of opgeruimd is. */
  async read(id: string): Promise<Buffer | undefined> {
    if (!ID.test(id)) return undefined;
    try {
      return await readFile(join(this.dir, `${id}.jpg`));
    } catch {
      return undefined;
    }
  }

  /** Haalt de id uit een pad als /screenshots/<id>.jpg. */
  static idFromPath(pathname: string): string | undefined {
    if (!pathname.startsWith(SCREENSHOT_ROUTE)) return undefined;
    const name = pathname.slice(SCREENSHOT_ROUTE.length);
    const match = name.match(/^([A-Za-z0-9_-]{24})\.jpg$/);
    return match?.[1];
  }

  /** Verwijdert beelden die ouder zijn dan de bewaartermijn; geeft het aantal terug. */
  async prune(now = Date.now()): Promise<number> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return 0;
    }
    let removed = 0;
    for (const name of names) {
      if (!name.endsWith(".jpg")) continue;
      const file = join(this.dir, name);
      try {
        const { mtimeMs } = await stat(file);
        if (now - mtimeMs > this.retentionDays * DAY) {
          await unlink(file);
          removed++;
        }
      } catch {
        // al weg
      }
    }
    return removed;
  }
}
