const SCOPE = "https://www.googleapis.com/auth/drive.file";
const MANIFEST_NAME = "save-songs.json";
const DRIVE_MEDIA = "/drive-media/";

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

export function isGoogleSignedIn(): boolean {
   return signedIn && !!accessToken && Date.now() < tokenExpires - 60_000;
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

export async function driveFiles(folderId: string): Promise<Map<string, string>> {
   const files = new Map<string, string>();
   let pageToken = "";
   const safeId = folderId.replace(/'/g, "\\'");
   do {
      const params = new URLSearchParams({
         q: `'${safeId}' in parents and trashed=false`,
         fields: "nextPageToken,files(id,name)",
         pageSize: "1000",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
         headers: await authHeader(),
      });
      if (!res.ok) throw new Error("Could not read the Drive folder");
      const body = await res.json() as { nextPageToken?: string; files?: { id?: string; name?: string }[] };
      for (const file of body.files ?? []) {
         if (file.id && file.name) files.set(file.name, file.id);
      }
      pageToken = body.nextPageToken ?? "";
   } while (pageToken);
   return files;
}

export function driveFileId(files: Map<string, string>, base: string): string | undefined {
   for (const [name, id] of files) {
      if (name === base || name.startsWith(`${base}.`)) return id;
   }
   return undefined;
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
   const existingId = files.get(MANIFEST_NAME);
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
      const markerId = files.get(MANIFEST_NAME);
      let manifest = markerId ? await readPlaylistManifest(folder.id, markerId) : null;
      if (!manifest) {
         const tracks: DriveSong[] = [];
         for (const [name, id] of files) {
            const song = songFromFilename(name, id);
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

/** Tell the service worker the current token, then return a same-origin URL it can stream. */
export async function prepareDrivePlayback(fileId: string): Promise<string> {
   const token = await googleAccessToken();
   if (!("serviceWorker" in navigator)) {
      throw new Error("This browser cannot stream Drive audio");
   }
   const worker = await controllingWorker();
   await new Promise<void>((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = window.setTimeout(() => reject(new Error("Drive playback did not start")), 4000);
      channel.port1.onmessage = () => {
         window.clearTimeout(timer);
         resolve();
      };
      worker.postMessage({ type: "DRIVE_TOKEN", token }, [channel.port2]);
   });
   return `${DRIVE_MEDIA}${encodeURIComponent(fileId)}`;
}

function controllingWorker(): Promise<ServiceWorker> {
   return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Reload the page, then play the song again")), 8000);
      const finish = () => {
         const worker = navigator.serviceWorker.controller;
         if (!worker) return;
         window.clearTimeout(timer);
         resolve(worker);
      };
      finish();
      navigator.serviceWorker.ready.then(finish).catch(() => undefined);
      navigator.serviceWorker.addEventListener("controllerchange", finish, { once: true });
   });
}

export async function uploadToDrive(folderId: string, name: string, blob: Blob): Promise<string> {
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
   const created = await put.json() as { id?: string };
   if (!created.id) throw new Error("Drive upload failed");
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
