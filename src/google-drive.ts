import { randomBytes } from "node:crypto";
import type { Config } from "./config.js";

// Een rapport als Google Doc in de Drive zetten van wie toestemming gaf (scope drive.file). Drive zet de HTML om
// naar een Google Doc: koppen, tabellen, links en inline stijlen blijven behouden.

const GOOGLE_DOC = "application/vnd.google-apps.document";

export class DriveError extends Error {}

/** Uploadt HTML als Google Doc en geeft de link om het te openen. */
export async function createGoogleDoc(accessToken: string, title: string, html: string, config: Config): Promise<string> {
  const boundary = `skrol-${randomBytes(12).toString("hex")}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n`),
    Buffer.from(JSON.stringify({ name: title, mimeType: GOOGLE_DOC })),
    Buffer.from(`\r\n--${boundary}\r\ncontent-type: text/html; charset=UTF-8\r\n\r\n`),
    Buffer.from(html, "utf8"),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const url = new URL(config.googleDriveUploadUrl);
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("fields", "id,webViewLink");

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": `multipart/related; boundary=${boundary}` },
      body,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new DriveError("Google Drive antwoordde niet. Probeer opnieuw.");
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string; webViewLink?: string; error?: { message?: string } };
  if (!res.ok || !data.id) {
    const message = data.error?.message ?? "";
    // De meest voorkomende fout bij het instellen: de Drive API staat niet aan in het Google Cloud-project.
    if (/has not been used|is disabled|accessNotConfigured/i.test(message)) {
      throw new DriveError("De Google Drive API staat niet aan in het Google Cloud-project van de tool. Zet ze aan (APIs & Services > Library > Google Drive API) en probeer opnieuw.");
    }
    throw new DriveError(`Google Drive weigerde het rapport (HTTP ${res.status}${message ? `: ${message}` : ""}).`);
  }
  return data.webViewLink ?? `https://docs.google.com/document/d/${encodeURIComponent(data.id)}/edit`;
}
