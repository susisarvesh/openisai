const SCOPE = "https://www.googleapis.com/auth/drive.file";

interface TokenResponse {
   access_token?: string;
   expires_in?: number;
   error?: string;
   error_description?: string;
}

interface TokenClient {
   requestAccessToken: (override?: { prompt?: string }) => void;
}

declare global {
   interface Window {
      google?: {
         accounts: {
            oauth2: {
               initTokenClient: (config: {
                  client_id: string;
                  scope: string;
                  callback: (response: TokenResponse) => void;
               }) => TokenClient;
            };
         };
      };
   }
}

export function googleClientId(): string {
   return import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
}

function folderKey(id: string): string {
   return `rheoson-drive-folder:${id}`;
}

function loadGis(): Promise<void> {
   if (window.google?.accounts?.oauth2) return Promise.resolve();
   return new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>("script[data-gis]");
      if (existing) {
         existing.addEventListener("load", () => resolve(), { once: true });
         existing.addEventListener("error", () => reject(new Error("Google sign-in did not load")), { once: true });
         return;
      }
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.dataset.gis = "1";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Google sign-in did not load"));
      document.head.appendChild(script);
   });
}

let accessToken = "";
let tokenExpires = 0;
let signedIn = false;

export async function googleAccessToken(): Promise<string> {
   if (!googleClientId()) {
      throw new Error("Add VITE_GOOGLE_CLIENT_ID before exporting to Drive.");
   }
   if (accessToken && Date.now() < tokenExpires - 60_000) return accessToken;
   await loadGis();
   const oauth = window.google?.accounts?.oauth2;
   if (!oauth) throw new Error("Google sign-in did not load");

   accessToken = await new Promise((resolve, reject) => {
      const client = oauth.initTokenClient({
         client_id: googleClientId(),
         scope: SCOPE,
         callback: (response) => {
            if (response.error || !response.access_token) {
               reject(new Error(response.error_description || "Google sign-in was cancelled"));
               return;
            }
            tokenExpires = Date.now() + (response.expires_in ?? 3600) * 1000;
            signedIn = true;
            resolve(response.access_token);
         },
      });
      client.requestAccessToken({ prompt: signedIn ? "" : "consent" });
   });
   return accessToken;
}

async function authHeader(): Promise<Record<string, string>> {
   return { Authorization: `Bearer ${await googleAccessToken()}` };
}

export async function driveFolder(name: string, key: string): Promise<string> {
   const saved = localStorage.getItem(folderKey(key));
   if (saved) {
      const check = await fetch(
         `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(saved)}?fields=id,trashed`,
         { headers: await authHeader() },
      );
      if (check.ok) {
         const body = await check.json() as { trashed?: boolean };
         if (!body.trashed) return saved;
      }
   }

   const created = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      body: JSON.stringify({
         name,
         mimeType: "application/vnd.google-apps.folder",
      }),
   });
   if (!created.ok) throw new Error("Could not create the Drive folder");
   const folder = await created.json() as { id?: string };
   if (!folder.id) throw new Error("Could not create the Drive folder");
   localStorage.setItem(folderKey(key), folder.id);
   return folder.id;
}

export async function driveFileNames(folderId: string): Promise<Set<string>> {
   const names = new Set<string>();
   let pageToken = "";
   const safeId = folderId.replace(/'/g, "\\'");
   do {
      const params = new URLSearchParams({
         q: `'${safeId}' in parents and trashed=false`,
         fields: "nextPageToken,files(name)",
         pageSize: "1000",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
         headers: await authHeader(),
      });
      if (!res.ok) throw new Error("Could not read the Drive folder");
      const body = await res.json() as { nextPageToken?: string; files?: { name?: string }[] };
      for (const file of body.files ?? []) {
         if (file.name) names.add(file.name);
      }
      pageToken = body.nextPageToken ?? "";
   } while (pageToken);
   return names;
}

export function alreadyInDrive(names: Set<string>, base: string): boolean {
   for (const name of names) {
      if (name === base || name.startsWith(`${base}.`)) return true;
   }
   return false;
}

export async function uploadToDrive(folderId: string, name: string, blob: Blob): Promise<void> {
   const type = blob.type || "application/octet-stream";
   const start = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", {
      method: "POST",
      headers: {
         ...(await authHeader()),
         "Content-Type": "application/json; charset=UTF-8",
         "X-Upload-Content-Type": type,
         "X-Upload-Content-Length": String(blob.size),
      },
      body: JSON.stringify({ name, parents: [folderId] }),
   });
   const location = start.headers.get("Location");
   if (!start.ok || !location) throw new Error("Drive did not accept the file");
   const put = await fetch(location, {
      method: "PUT",
      headers: { "Content-Type": type },
      body: blob,
   });
   if (!put.ok) throw new Error("Drive upload failed");
}

export function fileBase(artist: string, title: string): string {
   const clean = (value: string) => value.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
   return `${clean(artist) || "Unknown"} - ${clean(title) || "Untitled"}`.slice(0, 180);
}

export function extensionFor(type: string): string {
   if (type.includes("webm")) return ".webm";
   if (type.includes("ogg") || type.includes("opus")) return ".opus";
   if (type.includes("mpeg")) return ".mp3";
   if (type.includes("flac")) return ".flac";
   if (type.includes("wav")) return ".wav";
   return ".m4a";
}
