/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/**
 * Typed contract for every Vite env var the app reads.
 *
 * These are the ONLY names import.meta.env may be queried with — keep this
 * list in sync with web/.env.example, which documents them. Accessing an
 * undeclared key is a type error, so a typo'd variable fails the build
 * instead of silently reading as `undefined` in production.
 */
interface ImportMetaEnv {
   /** Absolute backend origin, no trailing slash. See web/.env.example. */
   readonly VITE_API_URL?: string
   /** Clerk publishable key (pk_test_… / pk_live_…). */
   readonly VITE_CLERK_PUBLISHABLE_KEY?: string
   /** Public Google OAuth client id for Drive export. */
   readonly VITE_GOOGLE_CLIENT_ID?: string
   /** Shared app token sent as X-App-Token. Empty in local dev. */
   readonly VITE_APP_TOKEN?: string
   /** Optional remote sink for client error logs. */
   readonly VITE_ERROR_ENDPOINT?: string
   /** Injected by Vite itself — true in `npm run dev`. */
   readonly DEV: boolean
   /** Injected by Vite itself — true in production builds. */
   readonly PROD: boolean
}

interface ImportMeta {
   readonly env: ImportMetaEnv
}
