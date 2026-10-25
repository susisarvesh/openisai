import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const SPLASH_KEY = 'rheoson-splash-last'
const COOLDOWN_MS = 1000 * 60 * 30

export function useSplash() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const last = parseInt(localStorage.getItem(SPLASH_KEY) || '0', 10)
    const now = Date.now()
    if (now - last > COOLDOWN_MS) {
      setShow(true)
      localStorage.setItem(SPLASH_KEY, String(now))
    }
  }, [])

  const dismiss = () => setShow(false)
  return { show, dismiss }
}

interface SplashScreenProps {
  onDone: () => void
}

export default function SplashScreen({ onDone }: SplashScreenProps) {
  const [fading, setFading] = useState(false)

  const finish = () => {
    setFading(true)
    window.setTimeout(onDone, 520)
  }

  useEffect(() => {
    const fadeTimer = window.setTimeout(() => setFading(true), 2400)
    const dismissTimer = window.setTimeout(onDone, 2920)
    return () => {
      window.clearTimeout(fadeTimer)
      window.clearTimeout(dismissTimer)
    }
  }, [onDone])

  return (
    <AnimatePresence>
      {!fading && (
        <motion.button
          type="button"
          aria-label="Skip intro"
          onClick={finish}
          className="fixed inset-0 z-[999] flex flex-col items-center justify-center bg-black"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
        >
          <div className="relative flex h-44 w-44 items-center justify-center">
            <motion.span
              className="absolute inset-4 rounded-full border border-[#1ed760]/40"
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: [0.7, 1.18, 1.35], opacity: [0, 0.7, 0] }}
              transition={{ duration: 1.8, ease: [0.22, 1, 0.36, 1] }}
            />
            <motion.img
              src="/assets/openisai-logo.png"
              alt=""
              className="relative h-32 w-32 rounded-full object-cover"
              initial={{ opacity: 0, scale: 0.62, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 180, damping: 16, mass: 0.8 }}
            />
          </div>
          <motion.div
            className="mt-2 flex h-6 items-end gap-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45, duration: 0.4 }}
          >
            <span className="eq-bar h-3" />
            <span className="eq-bar h-5" />
            <span className="eq-bar h-4" />
            <span className="eq-bar h-6" />
            <span className="eq-bar h-3" />
          </motion.div>
          <motion.p
            className="mt-5 text-[13px] font-bold tracking-[0.28em] text-white"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55, duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
          >
            SONGS
          </motion.p>
        </motion.button>
      )}
    </AnimatePresence>
  )
}
