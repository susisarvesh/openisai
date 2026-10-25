import React from "react";
import { Outlet } from "react-router-dom";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import { Toaster } from "@/components/ui/Toaster";
import PlayerBar from "@/components/player/PlayerBar";
import { usePlayerStore } from "@/store/player.store";
import { useUIStore } from "@/store/ui.store";
import { usePlayerSync } from "@/hooks/playerSync.hook";
import { cn } from "@/lib/utils";

/**
 * Mobile layout stack (bottom → top in z-order):
 *
 *  ┌─────────────────────────────┐  ← page content (scrollable)
 *  │                             │
 *  │         <Outlet />          │
 *  │                             │
 *  ├─────────────────────────────┤
 *  │         PlayerBar           │  ← always visible when track loaded
 *  ├─────────────────────────────┤
 *  │         BottomNav           │  ← visible by default; hides behind
 *  └─────────────────────────────┘    PlayerBar when track plays, swipe-up restores
 *
 * Desktop (lg+):
 *  Sidebar on left, no BottomNav, PlayerBar pinned at bottom of content column.
 */

/** Settings → Appearance → Reduce motion, OR the OS-level
 *  prefers-reduced-motion setting — either signal disables motion.
 *  Applied by wrapping the shell in MotionConfig with reducedMotion="always",
 *  which makes every framer-motion animation in the app jump to its end
 *  state — a global, accessible motion kill-switch. Mirrored onto
 *  [data-reduce-motion] so the CSS layer (index.css media-
 *  independent block) collapses non-framer CSS animations too. */
function useReduceMotion(): boolean {
   const reduced = useUIStore(s => s.reduceMotion);

   // The OS preference is tracked live so changing it in system settings
   // takes effect without a reload.
   const [osReduced, setOsReduced] = React.useState(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
   );

   React.useEffect(() => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      const onChange = (e: MediaQueryListEvent) => setOsReduced(e.matches);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
   }, []);

   const effective = reduced || osReduced;

   React.useEffect(() => {
      document.documentElement.setAttribute('data-reduce-motion', String(effective));
      return () => document.documentElement.removeAttribute('data-reduce-motion');
   }, [effective]);

   return effective;
}

export default function RootLayout() {
   // Cross-device playback sync (this tab ⇄ the account's other devices)
   usePlayerSync();
   const reduceMotion = useReduceMotion();

   const hasTrack = usePlayerStore(s => s.currentTrack !== null);

   return (
      <MotionConfig reducedMotion={reduceMotion ? "always" : "never"}>
      <Toaster>
         <div className='flex h-full w-full overflow-hidden bg-black'>
            <div className='flex min-w-0 flex-1 flex-col overflow-hidden'>
               <main
                  className={cn(
                     "flex-1 overflow-y-auto overflow-x-hidden",
                     hasTrack && "pb-[calc(var(--player-height)+12px)]"
                  )}>
                  <Outlet />
               </main>
               <div className='hidden flex-shrink-0 lg:block'>
                  <PlayerBar />
               </div>
            </div>
            <div className='lg:hidden'>
               <AnimatePresence>
                  {hasTrack && (
                     <motion.div
                        key='player-bar'
                        initial={{ y: 80, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 80, opacity: 0 }}
                        transition={{ type: "spring", damping: 28, stiffness: 300 }}
                        className='fixed inset-x-0 bottom-0 z-50 pb-[env(safe-area-inset-bottom)]'>
                        <PlayerBar />
                     </motion.div>
                  )}
               </AnimatePresence>
            </div>
         </div>
      </Toaster>
      </MotionConfig>
   );
}
