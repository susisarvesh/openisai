/**
 * A full copy of a saved Drive song, kept in this browser so it can play
 * with no network. The cache key is the file path with no grant and no token.
 */

export const DRIVE_AUDIO_CACHE = "rheoson-drive-audio-v1";

const PREFIX = "/api/drive-audio/";

export function driveAudioPath(fileId: string): string {
   return `${PREFIX}${encodeURIComponent(fileId)}`;
}

export function driveFileIdFromPath(pathname: string): string | null {
   if (!pathname.startsWith(PREFIX)) return null;
   const rest = pathname.slice(PREFIX.length);
   if (!rest || rest.includes("/") || rest === "grant") return null;
   try {
      const id = decodeURIComponent(rest);
      return id && !id.includes("/") ? id : null;
   } catch {
      return null;
   }
}

export function byteRange(
   header: string | null,
   total: number,
): { start: number; end: number } | null {
   if (total < 1) return null;
   if (!header || !header.trim()) return { start: 0, end: total - 1 };
   const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim().split(",")[0].trim());
   if (!match) return null;
   const startS = match[1];
   const endS = match[2];
   if (startS === "" && endS === "") return null;
   if (startS === "") {
      const suffix = Number(endS);
      if (!Number.isFinite(suffix) || suffix <= 0) return null;
      return { start: Math.max(0, total - suffix), end: total - 1 };
   }
   const start = Number(startS);
   if (!Number.isFinite(start) || start >= total) return null;
   const end = endS === "" ? total - 1 : Math.min(Number(endS), total - 1);
   if (!Number.isFinite(end) || end < start) return null;
   return { start, end };
}

export function isWholeFile(status: number, contentRange: string | null, size: number): boolean {
   if (size < 1) return false;
   if (status === 200 && !contentRange) return true;
   if (status !== 200 && status !== 206) return false;
   if (!contentRange) return false;
   const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange.trim());
   if (!match) return false;
   const start = Number(match[1]);
   const end = Number(match[2]);
   const total = Number(match[3]);
   return start === 0 && end === total - 1 && total === size;
}

export async function rangedAudioResponse(cached: Response, request: Request): Promise<Response> {
   const type = cached.headers.get("content-type") || "audio/mp4";
   const bytes = new Uint8Array(await cached.arrayBuffer());
   const total = bytes.byteLength;
   const range = byteRange(request.headers.get("range"), total);
   if (!range) {
      return new Response(null, {
         status: 416,
         headers: { "Content-Range": `bytes */${total}` },
      });
   }
   const length = range.end - range.start + 1;
   const headers: Record<string, string> = {
      "Accept-Ranges": "bytes",
      "Content-Type": type,
      "Content-Length": String(length),
      "Content-Range": `bytes ${range.start}-${range.end}/${total}`,
      "Cache-Control": "no-store",
   };
   if (request.method === "HEAD") return new Response(null, { status: 206, headers });
   return new Response(bytes.slice(range.start, range.end + 1), { status: 206, headers });
}

export async function rememberDriveAudio(fileId: string, blob: Blob): Promise<void> {
   if (typeof caches === "undefined" || blob.size < 32) return;
   const cache = await caches.open(DRIVE_AUDIO_CACHE);
   const type = blob.type || "audio/mp4";
   await cache.put(
      driveAudioPath(fileId),
      new Response(blob, {
         status: 200,
         headers: {
            "Accept-Ranges": "bytes",
            "Content-Type": type,
            "Content-Length": String(blob.size),
         },
      }),
   );
}

export async function offlineDriveUrl(fileId: string): Promise<string | null> {
   if (typeof caches === "undefined") return null;
   const cache = await caches.open(DRIVE_AUDIO_CACHE);
   const hit = await cache.match(driveAudioPath(fileId));
   if (!hit) return null;
   return `${driveAudioPath(fileId)}?offline=1`;
}

export async function keepGrantCopy(fileId: string, playbackUrl: string): Promise<void> {
   if (await offlineDriveUrl(fileId)) return;
   const response = await fetch(playbackUrl);
   if (response.status !== 200 && response.status !== 206) return;
   const blob = await response.blob();
   const range = response.headers.get("content-range");
   if (range) {
      if (!isWholeFile(response.status, range, blob.size)) return;
   } else if (blob.size < 32) {
      return;
   }
   await rememberDriveAudio(fileId, blob);
}
