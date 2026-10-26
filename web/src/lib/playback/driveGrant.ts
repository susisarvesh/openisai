/**
 * Ask the API for a playback URL. The Google token goes in a header and is
 * not placed on the audio URL.
 */

import { API_BASE } from "@/lib/constants";
import { dropGoogleAccessToken, googleAccessToken, googleTokenExpirySeconds } from "@/lib/googleDrive";

async function failure(response: Response): Promise<Error> {
   try {
      const body = await response.clone().json() as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail.trim()) return new Error(body.detail.trim());
   } catch { /* the status is the only signal */ }
   if (response.status === 401) return new Error("Sign in again to play this song");
   if (response.status === 403) return new Error("Drive refused access to that song");
   if (response.status === 404) return new Error("That song is no longer in Drive");
   return new Error("Could not play that song from Drive");
}

function absolutePlaybackUrl(path: string): string {
   if (path.startsWith("http://") || path.startsWith("https://")) return path;
   if (path.startsWith("/api/") && API_BASE.endsWith("/api")) {
      return `${API_BASE.slice(0, -"/api".length)}${path}`;
   }
   return path;
}

function withAppToken(url: string): string {
   const appToken = import.meta.env.VITE_APP_TOKEN;
   if (!appToken || /(?:\?|&)app_token=/.test(url)) return url;
   const join = url.includes("?") ? "&" : "?";
   return `${url}${join}app_token=${encodeURIComponent(appToken)}`;
}

async function requestGrant(fileId: string, signal: AbortSignal | undefined, allowRetry: boolean): Promise<string> {
   const token = await googleAccessToken();
   const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Drive-Token": token,
   };
   const appToken = import.meta.env.VITE_APP_TOKEN;
   if (appToken) headers["X-App-Token"] = appToken;
   const expiresAt = googleTokenExpirySeconds();
   const response = await fetch(`${API_BASE}/drive-audio/grant`, {
      method: "POST",
      headers,
      body: JSON.stringify({ fileId, expiresAt }),
      signal,
   });
   if (response.status === 401 && allowRetry) {
      dropGoogleAccessToken();
      return requestGrant(fileId, signal, false);
   }
   if (!response.ok) throw await failure(response);
   const body = await response.json() as { url?: string };
   const granted = body.url ?? "";
   if (!granted || granted.includes(token)) throw new Error("Could not play that song from Drive");
   const url = withAppToken(absolutePlaybackUrl(granted));
   const probe = await fetch(url, { method: "HEAD", signal });
   if (probe.status === 401 && allowRetry) {
      dropGoogleAccessToken();
      return requestGrant(fileId, signal, false);
   }
   if (!probe.ok) throw await failure(probe);
   return url;
}

export function drivePlaybackUrl(fileId: string, signal?: AbortSignal): Promise<string> {
   return requestGrant(fileId, signal, true);
}
