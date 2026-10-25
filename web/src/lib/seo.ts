/**
 * Per-route SEO — the SPA's one honest concession to being a website.
 *
 * index.html carries the static defaults (what non-JS consumers see); this
 * module keeps title/canonical/og:url correct per route for everything that
 * renders the app. Wired in router.tsx via a listener so every navigation
 * updates the head without any page importing anything.
 *
 * Deliberately minimal: no history spam (replaceState-style semantics via
 * direct DOM writes), no title flicker on first paint (router effects run
 * before paint for the initial route).
 */

export const SITE_URL = 'https://rheoson.onrender.com'

interface RouteSeo {
  title: string
  /** Canonical path — defaults to the route itself. */
  path?: string
  /** Public origin for this route. Other routes stay on SITE_URL. */
  origin?: string
  description?: string
}

const ROUTE_SEO: Array<{ pattern: RegExp; seo: RouteSeo }> = [
  {
    pattern: /^\/$/,
    seo: {
      title: 'Save Songs',
      origin: 'https://save-songs.vercel.app',
      description: 'Save Songs lets you paste a Spotify playlist or album, save the songs to your Google Drive, and play them.',
    },
  },
  { pattern: /^\/landing/,       seo: { title: 'Rheoson — Your library, your server', path: '/landing' } },
  { pattern: /^\/search/,        seo: { title: 'Search — Rheoson', path: '/search' } },
  { pattern: /^\/library/,       seo: { title: 'Your Library — Rheoson', path: '/library' } },
  { pattern: /^\/downloads/,     seo: { title: 'Downloads — Rheoson', path: '/downloads' } },
  { pattern: /^\/playlist\//,    seo: { title: 'Playlist — Rheoson' } },
  { pattern: /^\/album\//,       seo: { title: 'Album — Rheoson' } },
  { pattern: /^\/artist\//,      seo: { title: 'Artist — Rheoson' } },
  { pattern: /^\/stats/,         seo: { title: 'Listening Stats — Rheoson', path: '/stats' } },
  { pattern: /^\/settings/,      seo: { title: 'Settings — Rheoson', path: '/settings' } },
  { pattern: /^\/(auth|login|register)/, seo: { title: 'Sign in — Rheoson', path: '/auth' } },
  {
    pattern: /^\/privacy$/,
    seo: {
      title: 'Privacy Policy — Save Songs',
      path: '/privacy',
      origin: 'https://save-songs.vercel.app',
      description: 'How Save Songs uses Google Drive, what stays on your device, and what is sent to the Save Songs server.',
    },
  },
  {
    pattern: /^\/terms$/,
    seo: {
      title: 'Terms of Service — Save Songs',
      path: '/terms',
      origin: 'https://save-songs.vercel.app',
      description: 'The terms for using Save Songs to check a Spotify playlist or album and save songs to your Google Drive.',
    },
  },
]

function upsertMeta(selector: string, attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

let defaultDescription: string | undefined

export function applyRouteSeo(pathname: string): void {
  if (defaultDescription === undefined) {
    defaultDescription = document.head.querySelector('meta[name="description"]')?.getAttribute('content') ?? ''
  }
  const match = ROUTE_SEO.find((r) => r.pattern.test(pathname))
  const seo = match?.seo ?? { title: 'Rheoson' }
  const canonicalPath = seo.path ?? pathname
  const origin = seo.origin ?? SITE_URL
  const canonical = `${origin}${canonicalPath === '/' ? '/' : canonicalPath}`

  document.title = seo.title
  upsertMeta('meta[name="robots"]', 'name', 'robots', 'index, follow')
  upsertMeta('meta[property="og:title"]', 'property', 'og:title', seo.title)
  upsertMeta('meta[property="og:url"]', 'property', 'og:url', canonical)
  const description = seo.description ?? defaultDescription
  if (description) {
    upsertMeta('meta[name="description"]', 'name', 'description', description)
    upsertMeta('meta[property="og:description"]', 'property', 'og:description', description)
  }

  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'canonical'
    document.head.appendChild(link)
  }
  link.href = canonical
}
