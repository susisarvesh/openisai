import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, MagnifyingGlass, Play } from "@phosphor-icons/react";
import { searchApi, resolveToTracks } from "@/api/search.api";
import { tracksApi } from "@/api/tracks.api";
import LegalLinks from "@/components/layout/LegalLinks";
import { ArtworkImage } from "@/components/ui/ArtworkImage";
import { useToast } from "@/components/ui/Toaster";
import { useQueue } from "@/hooks/queue.hook";
import { formatDuration } from "@/lib/formatters";
import {
   driveFileId,
   driveFiles,
   driveFolder,
   extensionFor,
   fileBase,
   googleAccessToken,
   googleClientId,
   uploadToDrive,
} from "@/lib/googleDrive";
import { requestWakeLock, releaseWakeLock } from "@/lib/keepAwake";
import { playlistsStore, tracksStore } from "@/lib/localDb";
import { parseSpotifyUrl } from "@/lib/utils";
import { usePlayerStore } from "@/store/player.store";
import type { Playlist, Track } from "@/types";

type SavePhase =
   | { kind: "idle" }
   | { kind: "exporting"; done: number; total: number; title: string };

type Preview = {
   url: string;
   kind: "playlist" | "album";
   title: string;
   artworkUrl: string;
   tracks: Track[];
};

const rise = { duration: 0.4, ease: [0.32, 0.72, 0, 1] as const };

function playlistFrom(spotifyId: string, title: string, tracks: Track[], createdAt?: string): Playlist {
   const now = new Date().toISOString();
   return {
      id: `spotify-${spotifyId}`,
      title: title || "Spotify playlist",
      description: "",
      artworkUrl: tracks[0]?.artworkUrl ?? "",
      tracks,
      trackIds: tracks.map((track) => track.id),
      trackCount: tracks.length,
      isLocal: true,
      spotifyId,
      totalDuration: tracks.reduce((sum, track) => sum + (track.duration || 0), 0),
      createdAt: createdAt ?? now,
      updatedAt: now,
   };
}

export default function LocalPlaylist() {
   const { toast } = useToast();
   const { playTrack, playAll } = useQueue();
   const currentId = usePlayerStore((s) => s.currentTrack?.id ?? null);
   const isPlaying = usePlayerStore((s) => s.isPlaying);

   const [url, setUrl] = useState("");
   const [phase, setPhase] = useState<SavePhase>({ kind: "idle" });
   const [checking, setChecking] = useState(false);
   const [error, setError] = useState("");
   const [preview, setPreview] = useState<Preview | null>(null);
   const [saved, setSaved] = useState<Playlist[]>([]);
   const [activeId, setActiveId] = useState<string | null>(null);
   const [showInstall, setShowInstall] = useState(false);

   const trimmed = url.trim();
   const parsed = parseSpotifyUrl(trimmed);
   const linkKind = parsed?.type === "playlist" || parsed?.type === "album" ? parsed.type : null;
   const checked = !!preview && preview.url === trimmed;
   const active = saved.find((playlist) => playlist.id === activeId) ?? null;
   const busy = phase.kind !== "idle" || checking;

   useEffect(() => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches
         || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      let dismissed = false;
      try { dismissed = localStorage.getItem("rheoson-ios-install-hint") === "1"; } catch { /* private mode */ }
      setShowInstall(ios && !standalone && !dismissed);
   }, []);

   useEffect(() => {
      const root = document.documentElement;
      root.removeAttribute("data-surface");
      root.removeAttribute("data-theme");
      root.style.setProperty("--accent-rgb", "30 215 96");
      root.style.setProperty("--accent-soft-rgb", "30 215 96");
      root.style.setProperty("--accent-deep-rgb", "29 185 84");
      root.style.setProperty("--bg-base", "#000000");
      root.style.setProperty("--bg-surface", "#121212");
      root.style.setProperty("--bg-elevated", "#1f1f1f");
      root.style.setProperty("--text-primary", "#ffffff");
      root.style.setProperty("--text-secondary", "#b3b3b3");
   }, []);

   useEffect(() => {
      let cancelled = false;
      playlistsStore.getAll().then((rows) => {
         if (cancelled) return;
         const local = rows.filter((row) => (row.tracks ?? []).some((track) => track.filePath?.startsWith("drive:")));
         setSaved(local);
         setActiveId((current) => current ?? local[0]?.id ?? null);
      }).catch(() => undefined);
      return () => {
         cancelled = true;
      };
   }, []);

   const remember = async (playlist: Playlist) => {
      await tracksStore.putAll(playlist.tracks);
      await playlistsStore.put(playlist);
      setSaved((rows) => {
         const next = rows.filter((row) => row.id !== playlist.id);
         return [playlist, ...next];
      });
      setActiveId(playlist.id);
   };

   const check = async () => {
      if (!linkKind || busy) return;
      setChecking(true);
      setError("");
      setPreview(null);
      try {
         const result = await searchApi.preview(trimmed);
         if (result.tracks.length === 0) {
            setError(linkKind === "album" ? "That album has no songs this page can read." : "That playlist has no songs this page can read.");
            return;
         }
         setPreview({
            url: trimmed,
            kind: result.type,
            title: result.title || (linkKind === "album" ? "Album" : "Playlist"),
            artworkUrl: result.artworkUrl || result.tracks[0]?.artworkUrl || "",
            tracks: result.tracks,
         });
      } catch (err) {
         const message = err instanceof Error ? err.message : "Could not read that link";
         setError(message);
      } finally {
         setChecking(false);
      }
   };

   const exportDrive = async () => {
      if (phase.kind !== "idle" || !checked || !preview || !parsed) return;
      if (!googleClientId()) {
         setError("Add VITE_GOOGLE_CLIENT_ID before exporting to Drive.");
         return;
      }
      setError("");
      setPhase({ kind: "exporting", done: 0, total: preview.tracks.length, title: "Finding the songs…" });
      try {
         await googleAccessToken();
         const resolved = await searchApi.resolve(preview.url);
         const tracks = resolveToTracks(resolved);
         const title = (resolved.type === "playlist" || resolved.type === "album") && resolved.title
            ? resolved.title
            : preview.title;
         if (tracks.length === 0) {
            setError("None of those songs could be matched for download.");
            return;
         }
         const folderId = await driveFolder(title, parsed.id);
         const existing = await driveFiles(folderId);
         await requestWakeLock();
         let done = 0;
         const savedTracks: Track[] = [];
         for (const track of tracks) {
            const base = fileBase(track.artist?.name || "", track.title);
            setPhase({ kind: "exporting", done, total: tracks.length, title: track.title });
            let fileId = driveFileId(existing, base);
            if (!fileId) {
               try {
                  const response = await fetch(tracksApi.getStreamUrl(track.id, { download: true, name: base }), {
                     headers: import.meta.env.VITE_APP_TOKEN
                        ? { "X-App-Token": import.meta.env.VITE_APP_TOKEN }
                        : {},
                  });
                  if (!response.ok) throw new Error("skip");
                  const blob = await response.blob();
                  const filename = `${base}${extensionFor(blob.type || response.headers.get("content-type") || "")}`;
                  fileId = await uploadToDrive(folderId, filename, blob);
                  existing.set(filename, fileId);
               } catch {
                  done += 1;
                  setPhase({ kind: "exporting", done, total: tracks.length, title: track.title });
                  continue;
               }
            }
            savedTracks.push({ ...track, filePath: `drive:${fileId}`, streamUrl: "" });
            done += 1;
            setPhase({ kind: "exporting", done, total: tracks.length, title: track.title });
         }
         if (savedTracks.length > 0) {
            const previous = await playlistsStore.get(`spotify-${parsed.id}`);
            const playlist = playlistFrom(parsed.id, title, savedTracks, previous?.createdAt);
            playlist.artworkUrl = preview.artworkUrl || playlist.artworkUrl;
            await remember(playlist);
            setPreview(null);
         }
         toast(
            savedTracks.length
               ? `${savedTracks.length} songs are ready to play from Google Drive.`
               : "No songs were saved to Drive.",
            savedTracks.length ? "success" : "error",
            5000,
         );
      } catch (err) {
         const message = err instanceof Error ? err.message : "Could not export to Drive";
         setError(message);
         toast(message, "error", 4000);
      } finally {
         setPhase({ kind: "idle" });
         void releaseWakeLock();
      }
   };

   const driveLabel = phase.kind === "exporting"
      ? phase.title === "Finding the songs…"
         ? "Finding the songs…"
         : `Saving to Drive… ${phase.done} of ${phase.total}`
      : "Export to Google Drive";
   const saveRatio = phase.kind === "exporting" && phase.total > 0
      ? phase.done / phase.total
      : 0;
   const playable = (active?.tracks ?? []).filter((track) => track.filePath?.startsWith("drive:"));

   return (
      <div className="min-h-full bg-black text-white lg:grid lg:grid-cols-[340px_minmax(0,1fr)]" style={{ fontFamily: "Inter, system-ui, -apple-system, sans-serif" }}>
         <aside className="sticky top-0 hidden h-dvh flex-col overflow-y-auto bg-[#121212] px-3 py-4 lg:flex">
            <div className="mb-3 flex items-center gap-3 px-2">
               <img src="/assets/openisai-logo.png" alt="" className="h-10 w-10 rounded-full object-cover" />
               <span className="text-[16px] font-bold leading-none">Songs</span>
            </div>
            <h2 className="px-3 py-2 text-[16px] font-bold leading-[1.2]">Your library</h2>
            {saved.length === 0 ? (
               <p className="px-3 text-[13px] leading-snug text-[#b3b3b3]">Playlists land here after they are saved to Drive.</p>
            ) : (
               <ul className="mt-2 flex flex-col gap-1">
                  {saved.map((playlist) => (
                     <LibraryRow key={playlist.id} playlist={playlist} selected={!checked && playlist.id === activeId} onSelect={(id) => { setPreview(null); setActiveId(id); }} />
                  ))}
               </ul>
            )}
         </aside>

         <div className="min-w-0 px-4 pb-8 pt-[max(16px,env(safe-area-inset-top))] lg:px-8 lg:pt-6">
            <div className="flex items-center gap-3">
               <img src="/assets/openisai-logo.png" alt="" className="h-11 w-11 rounded-full object-cover lg:hidden" />
               <div className="min-w-0">
                  <h1 className="text-[24px] font-bold leading-[1.2]">Songs</h1>
                  <p className="mt-1 max-w-xl text-[14px] leading-[1.33] text-[#b3b3b3]">
                     Paste a Spotify playlist or album, save it to your Drive, then play it here.
                  </p>
                  <LegalLinks className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[#b3b3b3]" />
               </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
               <label className="relative block min-w-0 flex-1">
                  <span className="sr-only">Spotify playlist or album link</span>
                  <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white" />
                  <input
                     value={url}
                     onChange={(event) => setUrl(event.target.value)}
                     placeholder="Paste a Spotify playlist or album link"
                     autoCapitalize="off"
                     autoCorrect="off"
                     spellCheck={false}
                     className="h-12 w-full rounded-full bg-[#1f1f1f] pl-10 pr-14 text-[14px] text-white outline-none placeholder:text-[#c5c5c5]"
                  />
                  <AnimatePresence>
                     {linkKind && (
                        <motion.button
                           key="check"
                           type="button"
                           aria-label={checked ? "Songs loaded" : "Check this link"}
                           onClick={check}
                           disabled={busy}
                           initial={{ opacity: 0, scale: 0.7 }}
                           animate={{ opacity: 1, scale: 1 }}
                           exit={{ opacity: 0, scale: 0.7 }}
                           whileTap={{ scale: 0.92 }}
                           transition={{ type: "spring", stiffness: 520, damping: 26 }}
                           className={`absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-black disabled:opacity-60 ${checked ? "bg-[#1ed760]" : "bg-white"}`}>
                           {checking ? (
                              <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" />
                           ) : (
                              <Check weight="bold" className="h-5 w-5" />
                           )}
                        </motion.button>
                     )}
                  </AnimatePresence>
               </label>
               <AnimatePresence>
                  {checked && (
                     <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        transition={rise}
                        className="flex flex-col gap-2 sm:flex-row">
                        <button
                           type="button"
                           onClick={exportDrive}
                           disabled={phase.kind !== "idle"}
                           className="inline-flex h-12 shrink-0 items-center justify-center rounded-full bg-white px-4 text-[14px] font-bold text-black disabled:opacity-60">
                           {driveLabel}
                        </button>
                     </motion.div>
                  )}
               </AnimatePresence>
            </div>

            {showInstall && (
               <p className="mt-3 flex items-start justify-between gap-3 text-[12px] leading-[1.33] text-[#b3b3b3]">
                  <span>On iPhone, tap Share, then Add to Home Screen.</span>
                  <button
                     type="button"
                     className="shrink-0 font-bold text-white"
                     onClick={() => {
                        try { localStorage.setItem("rheoson-ios-install-hint", "1"); } catch { /* ignore */ }
                        setShowInstall(false);
                     }}>
                     Dismiss
                  </button>
               </p>
            )}

            {(phase.kind === "exporting") && (
               <div className="mt-3">
                  <div className="h-1 overflow-hidden rounded-full bg-[#1f1f1f]">
                     <div className="h-full bg-[#1ed760] transition-[width] duration-300" style={{ width: `${Math.round(saveRatio * 100)}%` }} />
                  </div>
                  {phase.kind === "exporting" && phase.title !== "Finding the songs…" && (
                     <p className="mt-2 truncate text-[12px] text-[#b3b3b3]">{phase.title}</p>
                  )}
               </div>
            )}
            {linkKind && !checked && (
               <p className="mt-2 max-w-xl text-[12px] leading-[1.33] text-[#b3b3b3]">
                  Tap the check to load the songs. Nothing is saved until you confirm the list.
               </p>
            )}
            {error && <p className="mt-3 text-[13px] text-[#b85850]">{error}</p>}

            {!checked && !active && !linkKind && (
               <motion.div
                  className="mt-16 flex flex-col items-center text-center"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={rise}>
                  <motion.img
                     src="/assets/openisai-logo.png"
                     alt=""
                     className="h-28 w-28 rounded-full object-cover"
                     animate={{ y: [0, -8, 0] }}
                     transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
                  />
                  <p className="mt-6 text-[18px] font-bold">Your library starts here</p>
                  <p className="mt-2 max-w-sm text-[14px] leading-[1.4] text-[#b3b3b3]">
                     Check a link to see the songs, then save them into a folder in your own Google Drive.
                  </p>
               </motion.div>
            )}

            {saved.length > 0 && (
               <ul className="mt-6 flex gap-3 overflow-x-auto lg:hidden">
                  {saved.map((playlist) => (
                     <li key={playlist.id} className="w-28 shrink-0">
                        <button type="button" onClick={() => { setPreview(null); setActiveId(playlist.id); }} className="w-full text-left">
                           <ArtworkImage src={playlist.artworkUrl} alt="" radius="rounded-md" className="aspect-square w-full" />
                           <span className={`mt-2 block truncate text-[13px] font-semibold ${playlist.id === activeId ? "text-white" : "text-[#b3b3b3]"}`}>
                              {playlist.title}
                           </span>
                        </button>
                     </li>
                  ))}
               </ul>
            )}

            <AnimatePresence mode="wait">
               {checked && preview && (
                  <SongList
                     key={preview.url}
                     title={preview.title}
                     artworkUrl={preview.artworkUrl}
                     kind={preview.kind}
                     tracks={preview.tracks}
                     detail={`${preview.tracks.length} songs`}
                  />
               )}
               {!checked && active && (
                  <SongList
                     key={active.id}
                     title={active.title}
                     artworkUrl={active.artworkUrl}
                     kind="playlist"
                     tracks={active.tracks}
                     detail={`${playable.length} songs in Google Drive`}
                     onPlayAll={playable.length ? () => playAll(playable) : undefined}
                     onPlay={(track) => playTrack(track, playable)}
                     currentId={currentId}
                     isPlaying={isPlaying}
                  />
               )}
            </AnimatePresence>
         </div>
      </div>
   );
}

function SongList({
   title,
   artworkUrl,
   kind,
   tracks,
   detail,
   onPlayAll,
   onPlay,
   currentId,
   isPlaying,
}: {
   title: string;
   artworkUrl: string;
   kind: "playlist" | "album";
   tracks: Track[];
   detail: string;
   onPlayAll?: () => void;
   onPlay?: (track: Track) => void;
   currentId?: string | null;
   isPlaying?: boolean;
}) {
   return (
      <motion.div
         className="mt-8"
         initial={{ opacity: 0, y: 16 }}
         animate={{ opacity: 1, y: 0 }}
         exit={{ opacity: 0, y: 8 }}
         transition={rise}>
         <div className="flex items-end gap-4">
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...rise, delay: 0.05 }}>
               <ArtworkImage src={artworkUrl} alt="" radius="rounded-md" className="h-28 w-28 sm:h-40 sm:w-40" />
            </motion.div>
            <div className="min-w-0 flex-1 pb-1">
               <p className="text-[11px] font-bold uppercase tracking-wide text-[#b3b3b3]">{kind === "album" ? "Album" : "Playlist"}</p>
               <h2 className="mt-1 truncate text-[24px] font-bold leading-[1.2]">{title}</h2>
               <p className="mt-1 text-[13px] text-[#b3b3b3]">{detail}</p>
            </div>
            {onPlayAll && (
               <button
                  type="button"
                  aria-label="Play"
                  onClick={onPlayAll}
                  className="mb-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#1ed760] text-black">
                  <Play weight="fill" className="h-5 w-5 translate-x-px" />
               </button>
            )}
         </div>
         <ul className="mt-6">
            {tracks.map((track, index) => {
               const playing = track.id === currentId;
               const row = (
                  <>
                     <span className={`flex items-end justify-end gap-[2px] text-right text-[14px] ${playing ? "text-[#1ed760]" : "text-[#b3b3b3]"}`}>
                        {playing && isPlaying ? (
                           <>
                              <span className="eq-bar h-2" />
                              <span className="eq-bar h-3" />
                              <span className="eq-bar h-2" />
                           </>
                        ) : (
                           index + 1
                        )}
                     </span>
                     <ArtworkImage src={track.artworkUrl} alt="" size={40} radius="rounded-md" className="h-10 w-10" />
                     <span className="min-w-0">
                        <span className={`block truncate text-[14px] font-semibold leading-[1.2] ${playing ? "text-[#1ed760]" : "text-white"}`}>{track.title}</span>
                        <span className="mt-0.5 block truncate text-[13px] text-[#b3b3b3]">
                           {track.artist?.name || "Unknown artist"}
                        </span>
                     </span>
                     <span className="text-[12px] text-[#b3b3b3]">{formatDuration(track.duration)}</span>
                  </>
               );
               return (
                  <motion.li
                     key={track.id || `${title}-${index}`}
                     initial={{ opacity: 0, y: 8 }}
                     animate={{ opacity: 1, y: 0 }}
                     transition={{ duration: 0.28, delay: Math.min(index * 0.02, 0.36), ease: [0.32, 0.72, 0, 1] }}>
                     {onPlay ? (
                        <button type="button" onClick={() => onPlay(track)} className="grid w-full grid-cols-[28px_40px_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-[#1f1f1f]">
                           {row}
                        </button>
                     ) : (
                        <div className="grid w-full grid-cols-[28px_40px_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2">
                           {row}
                        </div>
                     )}
                  </motion.li>
               );
            })}
         </ul>
      </motion.div>
   );
}

function LibraryRow({
   playlist,
   selected,
   onSelect,
}: {
   playlist: Playlist;
   selected: boolean;
   onSelect: (id: string) => void;
}) {
   return (
      <li>
         <button
            type="button"
            onClick={() => onSelect(playlist.id)}
            className={`flex w-full items-center gap-3 rounded-md p-2 text-left ${selected ? "bg-[#292929]" : "hover:bg-[#1f1f1f]"}`}>
            <ArtworkImage src={playlist.artworkUrl} alt="" size={48} radius="rounded-md" className="h-12 w-12" />
            <span className="min-w-0">
               <span className="block truncate text-[14px] font-semibold">{playlist.title}</span>
               <span className="block text-[12px] text-[#b3b3b3]">{playlist.trackCount} songs</span>
            </span>
         </button>
      </li>
   );
}
