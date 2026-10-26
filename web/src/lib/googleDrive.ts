const SCOPE = "https://www.googleapis.com/auth/drive.file";
const MANIFEST_NAME = "save-songs.json";

export interface DriveSong {
   title: string;
   artist: string;
   duration: number;
   fileId: string;
   artworkUrl: string;
}

export interface DrivePlaylistFile {
   spotifyId: string;
   title: string;
   artworkUrl: string;
   tracks: DriveSong[];
}

export interface SharedPlaylist extends DrivePlaylistFile {
   folderId: string;
}

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

const SESSION_KEY = "rheoson-google-session";
const GRANTED_KEY = "rheoson-google-granted";

function restoreSession(): void {
   try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
         const parsed = JSON.parse(raw) as { token?: string; expires?: number };
         if (parsed.token && parsed.expires && Date.now() < parsed.expires - 60_000) {
            accessToken = parsed.token;
            tokenExpires = parsed.expires;
            signedIn = true;
            forgetPlaybackToken();
            return;
         }
         sessionStorage.removeItem(SESSION_KEY);
      }
   } catch { /* private mode */ }
   forgetPlaybackToken();
}

function persistSession(token: string, expires: number): void {
   accessToken = token;
   tokenExpires = expires;
   signedIn = true;
   try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token, expires }));
      localStorage.setItem(GRANTED_KEY, "1");
   } catch { /* private mode */ }
}

function alreadyGranted(): boolean {
   try { return localStorage.getItem(GRANTED_KEY) === "1"; } catch { return false; }
}

restoreSession();

export function isGoogleSignedIn(): boolean {
   return signedIn && !!accessToken && Date.now() < tokenExpires - 60_000;
}

export function googleTokenExpirySeconds(): number | null {
   if (!tokenExpires) return null;
   return Math.floor(tokenExpires / 1000);
}

/** Drop a token Drive rejected. The next request asks Google for a new one. */
export function dropGoogleAccessToken(): void {
   accessToken = "";
   tokenExpires = 0;
   signedIn = false;
   try { sessionStorage.removeItem(SESSION_KEY); } catch { /* private mode */ }
}

/** Delete only the playback token left in IndexedDB by an older build. */
function forgetPlaybackToken(): void {
   if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return;
   void indexedDB.databases().then((dbs) => {
      if (!dbs.some((db) => db.name === "rheoson-drive")) return;
      const open = indexedDB.open("rheoson-drive");
      open.onsuccess = () => {
         const db = open.result;
         if (!db.objectStoreNames.contains("session")) {
            db.close();
            return;
         }
         const tx = db.transaction("session", "readwrite");
         tx.objectStore("session").delete("google");
         tx.oncomplete = () => db.close();
         tx.onerror = () => db.close();
      };
      open.onerror = () => undefined;
   }).catch(() => undefined);
}

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
            persistSession(response.access_token, tokenExpires);
            resolve(response.access_token);
         },
      });
      client.requestAccessToken({ prompt: signedIn || alreadyGranted() ? "" : "consent" });
   });
   return accessToken;
}

async function authHeader(): Promise<Record<string, string>> {
   return { Authorization: `Bearer ${await googleAccessToken()}` };
}

export async function driveFolder(name: string, key: string): Promise<string> {
   const saved = localStorage.getItem(folderKey(key));
   if (saved && await folderStillThere(saved)) {
      await tagFolder(saved, key);
      return saved;
   }

   const existing = await findFolderBySpotifyId(key);
   if (existing) {
      localStorage.setItem(folderKey(key), existing);
      await tagFolder(existing, key);
      return existing;
   }

   const created = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      body: JSON.stringify({
         name,
         mimeType: "application/vnd.google-apps.folder",
         appProperties: { saveSongs: "playlist", spotifyId: key },
      }),
   });
   if (!created.ok) throw new Error("Could not create the Drive folder");
   const folder = await created.json() as { id?: string };
   if (!folder.id) throw new Error("Could not create the Drive folder");
   localStorage.setItem(folderKey(key), folder.id);
   return folder.id;
}

export interface DriveStoredFile {
   id: string;
   bytes: number | null;
}

function storedBytes(value: unknown): number | null {
   if (typeof value === "number" && Number.isFinite(value)) return value;
   if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
   return null;
}

export async function driveFiles(folderId: string): Promise<Map<string, DriveStoredFile>> {
   const files = new Map<string, DriveStoredFile>();
   let pageToken = "";
   const safeId = folderId.replace(/'/g, "\\'");
   do {
      const params = new URLSearchParams({
         q: `'${safeId}' in parents and trashed=false`,
         fields: "nextPageToken,files(id,name,size)",
         pageSize: "1000",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
         headers: await authHeader(),
      });
      if (!res.ok) throw new Error("Could not read the Drive folder");
      const body = await res.json() as {
         nextPageToken?: string;
         files?: { id?: string; name?: string; size?: string }[];
      };
      for (const file of body.files ?? []) {
         if (file.id && file.name) files.set(file.name, { id: file.id, bytes: storedBytes(file.size) });
      }
      pageToken = body.nextPageToken ?? "";
   } while (pageToken);
   return files;
}

export function driveFileId(files: Map<string, DriveStoredFile>, base: string): DriveStoredFile | undefined {
   for (const [name, file] of files) {
      if (name === base || name.startsWith(`${base}.`)) return file;
   }
   return undefined;
}

export async function removeDriveFile(fileId: string): Promise<void> {
   const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
      method: "DELETE",
      headers: await authHeader(),
   });
   if (!res.ok && res.status !== 404) throw new Error("Could not replace the empty Drive file");
}

async function folderStillThere(folderId: string): Promise<boolean> {
   const check = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,trashed`,
      { headers: await authHeader() },
   );
   if (!check.ok) return false;
   const body = await check.json() as { trashed?: boolean };
   return !body.trashed;
}

async function findFolderBySpotifyId(spotifyId: string): Promise<string | undefined> {
   if (!spotifyId) return undefined;
   const safe = spotifyId.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
   const params = new URLSearchParams({
      q: `mimeType = 'application/vnd.google-apps.folder' and trashed = false and appProperties has { key = 'spotifyId' and value = '${safe}' }`,
      fields: "files(id)",
      pageSize: "1",
   });
   const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: await authHeader(),
   });
   if (!res.ok) return undefined;
   const body = await res.json() as { files?: { id?: string }[] };
   return body.files?.find((file) => file.id)?.id;
}

function rememberedSpotifyIds(): Map<string, string> {
   const ids = new Map<string, string>();
   try {
      for (let i = 0; i < localStorage.length; i += 1) {
         const key = localStorage.key(i) ?? "";
         if (!key.startsWith("rheoson-drive-folder:")) continue;
         const folderId = localStorage.getItem(key);
         const spotifyId = key.slice("rheoson-drive-folder:".length);
         if (folderId && spotifyId) ids.set(folderId, spotifyId);
      }
   } catch { /* private mode */ }
   return ids;
}

export async function tagFolder(folderId: string, spotifyId: string): Promise<void> {
   const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}`, {
      method: "PATCH",
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      body: JSON.stringify({
         appProperties: { saveSongs: "playlist", ...(spotifyId ? { spotifyId } : {}) },
      }),
   });
   if (!res.ok) throw new Error("Could not mark the Drive folder");
}

export async function writePlaylistManifest(folderId: string, manifest: DrivePlaylistFile): Promise<void> {
   const files = await driveFiles(folderId);
   const existingId = files.get(MANIFEST_NAME)?.id;
   const body = JSON.stringify(manifest);
   if (existingId) {
      const res = await fetch(
         `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingId)}?uploadType=media`,
         {
            method: "PATCH",
            headers: { ...(await authHeader()), "Content-Type": "application/json" },
            body,
         },
      );
      if (!res.ok) throw new Error("Could not update the playlist marker");
      return;
   }
   await uploadToDrive(folderId, MANIFEST_NAME, new Blob([body], { type: "application/json" }));
}

async function readPlaylistManifest(folderId: string, fileId: string): Promise<DrivePlaylistFile | null> {
   const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      { headers: await authHeader() },
   );
   if (!res.ok) return null;
   const parsed = await res.json() as Partial<DrivePlaylistFile>;
   if (!parsed || !Array.isArray(parsed.tracks)) return null;
   return {
      spotifyId: parsed.spotifyId || "",
      title: parsed.title || "Playlist",
      artworkUrl: parsed.artworkUrl || "",
      tracks: parsed.tracks.filter((song) => song?.fileId && song.title).map((song) => ({
         title: song.title,
         artist: song.artist || "Unknown",
         duration: song.duration || 0,
         fileId: song.fileId,
         artworkUrl: song.artworkUrl || "",
      })),
   };
}

function songFromFilename(name: string, fileId: string): DriveSong | null {
   if (name === MANIFEST_NAME) return null;
   const base = name.replace(/\.[^.]+$/, "");
   const split = base.indexOf(" - ");
   const artist = split === -1 ? "Unknown" : base.slice(0, split).trim() || "Unknown";
   const title = split === -1 ? base : base.slice(split + 3).trim() || "Untitled";
   return { title, artist, duration: 0, fileId, artworkUrl: "" };
}

interface AppFolder {
   id: string;
   name: string;
   spotifyId: string;
   tagged: boolean;
}

async function listAppFolders(): Promise<AppFolder[]> {
   const folders: AppFolder[] = [];
   let pageToken = "";
   do {
      const params = new URLSearchParams({
         q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
         fields: "nextPageToken,files(id,name,appProperties)",
         pageSize: "100",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
         headers: await authHeader(),
      });
      if (!res.ok) throw new Error("Could not read your Drive library");
      const body = await res.json() as {
         nextPageToken?: string;
         files?: { id?: string; name?: string; appProperties?: Record<string, string> }[];
      };
      for (const file of body.files ?? []) {
         if (!file.id) continue;
         const props = file.appProperties ?? {};
         folders.push({
            id: file.id,
            name: file.name || "Playlist",
            spotifyId: props.spotifyId || "",
            tagged: props.saveSongs === "playlist",
         });
      }
      pageToken = body.nextPageToken ?? "";
   } while (pageToken);
   return folders;
}

/** Read tagged playlist folders, and write the tag plus save-songs.json for folders saved before tagging existed. */
export async function loadSharedLibrary(): Promise<SharedPlaylist[]> {
   const remembered = rememberedSpotifyIds();
   const folders = await listAppFolders();
   const playlists: SharedPlaylist[] = [];
   for (const folder of folders) {
      const files = await driveFiles(folder.id);
      const markerId = files.get(MANIFEST_NAME)?.id;
      let manifest = markerId ? await readPlaylistManifest(folder.id, markerId) : null;
      if (!manifest) {
         const tracks: DriveSong[] = [];
         for (const [name, file] of files) {
            const song = songFromFilename(name, file.id);
            if (song) tracks.push(song);
         }
         if (tracks.length === 0) continue;
         manifest = {
            spotifyId: folder.spotifyId || remembered.get(folder.id) || "",
            title: folder.name,
            artworkUrl: "",
            tracks,
         };
      }
      const spotifyId = manifest.spotifyId || folder.spotifyId || remembered.get(folder.id) || "";
      const jsonMissingId = manifest.spotifyId !== spotifyId;
      manifest = { ...manifest, spotifyId };
      const spotifyMissing = !!spotifyId && folder.spotifyId !== spotifyId;
      if (!folder.tagged || !markerId || spotifyMissing || jsonMissingId) {
         await tagFolder(folder.id, spotifyId);
         await writePlaylistManifest(folder.id, manifest);
      }
      if (manifest.spotifyId) {
         try { localStorage.setItem(folderKey(manifest.spotifyId), folder.id); } catch { /* private mode */ }
      }
      playlists.push({ ...manifest, folderId: folder.id });
   }
   return playlists;
}

function putDriveBytes(location: string, blob: Blob, type: string): Promise<{ id?: string }> {
   const last = blob.size - 1;
   return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", location);
      xhr.setRequestHeader("Content-Type", type);
      xhr.setRequestHeader("Content-Range", `bytes 0-${last}/${blob.size}`);
      xhr.onload = () => {
         if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error("Drive upload failed"));
            return;
         }
         try {
            resolve(JSON.parse(xhr.responseText) as { id?: string });
         } catch {
            reject(new Error("Drive upload failed"));
         }
      };
      xhr.onerror = () => reject(new Error("Drive upload failed"));
      xhr.send(blob);
   });
}

export async function uploadToDrive(folderId: string, name: string, blob: Blob): Promise<string> {
   if (blob.size < 1) throw new Error("The download was empty");
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
   const created = await putDriveBytes(location, blob, type);
   if (!created.id) throw new Error("Drive upload failed");
   const meta = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(created.id)}?fields=size`,
      { headers: await authHeader() },
   );
   if (meta.ok) {
      const body = await meta.json() as { size?: string };
      const bytes = storedBytes(body.size);
      if (bytes === null || bytes < 1) {
         await removeDriveFile(created.id).catch(() => undefined);
         throw new Error("Drive stored an empty file");
      }
   }
   return created.id;
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
