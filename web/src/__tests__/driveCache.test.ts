import { describe, expect, it } from "vitest";
import { byteRange, driveFileIdFromPath, isWholeFile, rangedAudioResponse } from "@/lib/playback/driveCache";

function audio(bytes: number[]): Response {
   return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { "Content-Type": "audio/mp4", "Content-Length": String(bytes.length) },
   });
}

describe("drive audio cache", () => {
   it("reads a file id from the cache path and ignores the grant route", () => {
      expect(driveFileIdFromPath("/api/drive-audio/abc-123")).toBe("abc-123");
      expect(driveFileIdFromPath("/api/drive-audio/grant")).toBeNull();
      expect(driveFileIdFromPath("/api/stream/abc/audio")).toBeNull();
   });

   it("closes an open range to the whole file", () => {
      expect(byteRange(null, 8)).toEqual({ start: 0, end: 7 });
      expect(byteRange("bytes=0-", 8)).toEqual({ start: 0, end: 7 });
      expect(byteRange("bytes=2-4", 8)).toEqual({ start: 2, end: 4 });
      expect(byteRange("bytes=5-", 8)).toEqual({ start: 5, end: 7 });
      expect(byteRange("bytes=-3", 8)).toEqual({ start: 5, end: 7 });
      expect(byteRange("bytes=8-", 8)).toBeNull();
   });

   it("accepts only a complete body", () => {
      expect(isWholeFile(206, "bytes 0-7/8", 8)).toBe(true);
      expect(isWholeFile(206, "bytes 2-4/8", 3)).toBe(false);
      expect(isWholeFile(200, null, 40)).toBe(true);
      expect(isWholeFile(206, "bytes 0-7/8", 4)).toBe(false);
   });

   it("answers a range with a 206 slice of the stored file", async () => {
      const cached = audio([10, 11, 12, 13, 14, 15, 16, 17]);
      const open = await rangedAudioResponse(cached, new Request("https://save-songs.vercel.app/a", {
         headers: { Range: "bytes=0-" },
      }));
      expect(open.status).toBe(206);
      expect(open.headers.get("content-range")).toBe("bytes 0-7/8");
      expect(new Uint8Array(await open.arrayBuffer())).toEqual(new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17]));

      const seek = await rangedAudioResponse(audio([10, 11, 12, 13, 14, 15, 16, 17]), new Request("https://save-songs.vercel.app/a", {
         headers: { Range: "bytes=2-4" },
      }));
      expect(seek.headers.get("content-range")).toBe("bytes 2-4/8");
      expect(seek.headers.get("content-length")).toBe("3");
      expect(new Uint8Array(await seek.arrayBuffer())).toEqual(new Uint8Array([12, 13, 14]));

      const head = await rangedAudioResponse(audio([10, 11, 12, 13, 14, 15, 16, 17]), new Request("https://save-songs.vercel.app/a", {
         method: "HEAD",
         headers: { Range: "bytes=0-" },
      }));
      expect(head.status).toBe(206);
      expect(await head.arrayBuffer()).toEqual(new ArrayBuffer(0));

      const past = await rangedAudioResponse(audio([10, 11, 12, 13, 14, 15, 16, 17]), new Request("https://save-songs.vercel.app/a", {
         headers: { Range: "bytes=20-" },
      }));
      expect(past.status).toBe(416);
   });
});
