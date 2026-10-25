import { describe, it, expect, beforeEach } from 'vitest'
import { applyRouteSeo, SITE_URL } from '@/lib/seo'

describe('applyRouteSeo', () => {
  beforeEach(() => {
    document.title = 'Rheoson'
    document.head
      .querySelectorAll('meta[property="og:title"], meta[property="og:url"], link[rel="canonical"]')
      .forEach((el) => el.remove())
  })

  it('home route sets the descriptive title and canonical with trailing slash', () => {
    applyRouteSeo('/')
    expect(document.title).toBe('Songs')
    const link = document.head.querySelector('link[rel="canonical"]')
    expect(link?.getAttribute('href')).toBe(`${SITE_URL}/`)
  })

  it('known route sets its per-route title and canonical path', () => {
    applyRouteSeo('/library')
    expect(document.title).toBe('Your Library — Rheoson')
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${SITE_URL}/library`
    )
  })

  it('deep link to a playlist keeps a generic title (dynamic name unknown at route level)', () => {
    applyRouteSeo('/playlist/abc123')
    expect(document.title).toBe('Playlist — Rheoson')
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${SITE_URL}/playlist/abc123`
    )
  })

  it('unknown route falls back to plain Rheoson title, canonical is the path', () => {
    applyRouteSeo('/some/unknown/path')
    expect(document.title).toBe('Rheoson')
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${SITE_URL}/some/unknown/path`
    )
  })

  it('updates og:title and og:url to match', () => {
    applyRouteSeo('/downloads')
    expect(
      document.head.querySelector('meta[property="og:title"]')?.getAttribute('content')
    ).toBe('Downloads — Rheoson')
    expect(
      document.head.querySelector('meta[property="og:url"]')?.getAttribute('content')
    ).toBe(`${SITE_URL}/downloads`)
  })

  it('privacy and terms use the public site origin, title, and description', () => {
    applyRouteSeo('/privacy')
    expect(document.title).toBe('Privacy Policy — Save Songs')
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://save-songs.vercel.app/privacy'
    )
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toContain(
      'Google Drive'
    )

    applyRouteSeo('/terms')
    expect(document.title).toBe('Terms of Service — Save Songs')
    expect(document.head.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe(
      'https://save-songs.vercel.app/terms'
    )

    applyRouteSeo('/library')
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${SITE_URL}/library`
    )
  })

  it('is idempotent — re-running reuses the existing tags instead of duplicating them', () => {
    applyRouteSeo('/library')
    applyRouteSeo('/library')
    applyRouteSeo('/library')
    expect(document.head.querySelectorAll('link[rel="canonical"]').length).toBe(1)
    expect(document.head.querySelectorAll('meta[property="og:title"]').length).toBe(1)
  })
})
