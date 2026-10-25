from __future__ import annotations
import json
import re
import httpx
import structlog
from typing import Optional
from app.core.config import settings
from app.core.exceptions import SpotifyError

log = structlog.get_logger()

# ── URL patterns ──────────────────────────────────────────────
_TRACK_RE    = re.compile(r'open\.spotify\.com/track/([A-Za-z0-9]+)')
_ALBUM_RE    = re.compile(r'open\.spotify\.com/album/([A-Za-z0-9]+)')
_PLAYLIST_RE = re.compile(r'open\.spotify\.com/playlist/([A-Za-z0-9]+)')
_ARTIST_RE   = re.compile(r'open\.spotify\.com/artist/([A-Za-z0-9]+)')

_token_cache: dict[str, str] = {}   # simple in-memory, refreshed when expired


async def _get_token() -> str:
    """Fetch a Spotify client-credentials token. Cached in memory."""
    if not settings.has_spotify:
        raise SpotifyError("Spotify credentials not configured")

    # Return cached token if still valid
    if _token_cache.get("token"):
        return _token_cache["token"]

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            "https://accounts.spotify.com/api/token",
            data={"grant_type": "client_credentials"},
            auth=(settings.SPOTIFY_CLIENT_ID, settings.SPOTIFY_CLIENT_SECRET),
        )
        if resp.status_code != 200:
            raise SpotifyError(f"Token fetch failed: {resp.status_code}")

        data  = resp.json()
        token = data.get("access_token", "")
        if not token:
            raise SpotifyError("Empty token from Spotify")

        _token_cache["token"] = token

        # Schedule cache clear after expires_in seconds
        import asyncio
        expires_in = data.get("expires_in", 3600)
        asyncio.get_event_loop().call_later(
            expires_in - 60,    # clear 60s before expiry
            _token_cache.clear,
        )
        return token


async def _get(path: str) -> dict:
    """Authenticated GET to Spotify API."""
    token = await _get_token()
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"https://api.spotify.com/v1{path}",
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code == 401:
            # Token expired — clear cache and retry once
            _token_cache.clear()
            token = await _get_token()
            resp  = await client.get(
                f"https://api.spotify.com/v1{path}",
                headers={"Authorization": f"Bearer {token}"},
            )
        if resp.status_code != 200:
            raise SpotifyError(f"Spotify API error {resp.status_code}: {path}")
        return resp.json()


# ── Parsers ───────────────────────────────────────────────────

def _parse_image(images: list[dict]) -> str:
    if not images:
        return ""
    # Prefer the largest image
    return sorted(images, key=lambda x: x.get("width", 0), reverse=True)[0].get("url", "")


def _parse_artist(a: dict) -> dict:
    return {
        "id":       a.get("id", ""),
        "name":     a.get("name", ""),
        "imageUrl": _parse_image(a.get("images", [])),
        "genres":   a.get("genres", []),
    }


def _parse_album(al: dict) -> dict:
    artists = al.get("artists", [])
    return {
        "id":          al.get("id", ""),
        "title":       al.get("name", ""),
        "artworkUrl":  _parse_image(al.get("images", [])),
        "releaseYear": int(al.get("release_date", "0")[:4] or 0),
        "trackCount":  al.get("total_tracks", 0),
        "artist": {
            "id":       artists[0].get("id", "")   if artists else "",
            "name":     artists[0].get("name", "") if artists else "",
            "imageUrl": "",
            "genres":   [],
        },
    }


def _parse_track(t: dict) -> dict:
    album   = t.get("album", {})
    artists = t.get("artists", [])
    return {
        "id":           t.get("id", ""),
        "title":        t.get("name", ""),
        "duration":     t.get("duration_ms", 0) / 1000,
        "artworkUrl":   _parse_image(album.get("images", [])),
        "spotifyId":    t.get("id", ""),
        "isDownloaded": False,
        "isLiked":      False,
        "artist": {
            "id":       artists[0].get("id", "")   if artists else "",
            "name":     artists[0].get("name", "") if artists else "",
            "imageUrl": "",
            "genres":   [],
        },
        "album": _parse_album(album),
    }


# ── Public API ────────────────────────────────────────────────

def detect_spotify_type(url: str) -> Optional[str]:
    """Returns 'track' | 'album' | 'playlist' | 'artist' | None."""
    if _TRACK_RE.search(url):    return "track"
    if _ALBUM_RE.search(url):    return "album"
    if _PLAYLIST_RE.search(url): return "playlist"
    if _ARTIST_RE.search(url):   return "artist"
    return None


def extract_spotify_id(url: str, kind: str) -> Optional[str]:
    patterns = {
        "track":    _TRACK_RE,
        "album":    _ALBUM_RE,
        "playlist": _PLAYLIST_RE,
        "artist":   _ARTIST_RE,
    }
    m = patterns[kind].search(url)
    return m.group(1) if m else None


async def get_track(track_id: str) -> dict:
    data = await _get(f"/tracks/{track_id}")
    return _parse_track(data)


async def get_album(album_id: str) -> dict:
    data   = await _get(f"/albums/{album_id}")
    tracks = [_parse_track(t) for t in data.get("tracks", {}).get("items", [])]
    album  = _parse_album(data)
    album["tracks"] = tracks
    return album


_EMBED_JSON = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
    re.DOTALL,
)


def _embed_artwork(entity: dict) -> str:
    sources = (entity.get("coverArt") or {}).get("sources") or []
    urls = [s.get("url") for s in sources if s.get("url")]
    if urls:
        return urls[-1]
    images = (entity.get("visualIdentity") or {}).get("image") or []
    ranked = sorted(images, key=lambda item: item.get("maxWidth") or 0)
    urls = [item.get("url") for item in ranked if item.get("url")]
    return urls[-1] if urls else ""


async def get_playlist_embed(playlist_id: str) -> dict:
    """Read a public playlist from Spotify's embed page."""
    return await get_collection_embed("playlist", playlist_id)


async def get_collection_embed(kind: str, collection_id: str) -> dict:
    """Read a public playlist or album from Spotify's embed page.

    Used when no Spotify API credentials are configured. The page lists
    title and artist for each track (up to the first page Spotify returns).
    Audio still comes from YouTube Music — these are names, not files.
    """
    if kind not in ("playlist", "album"):
        raise SpotifyError("Unsupported Spotify link")
    if not re.fullmatch(r"[A-Za-z0-9]+", collection_id or ""):
        raise SpotifyError("Invalid Spotify id")

    url = f"https://open.spotify.com/embed/{kind}/{collection_id}"
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
    if resp.status_code != 200:
        raise SpotifyError(f"Spotify page returned {resp.status_code}")

    match = _EMBED_JSON.search(resp.text)
    if not match:
        raise SpotifyError("Spotify page had no track list")
    try:
        payload = json.loads(match.group(1))
        entity = payload["props"]["pageProps"]["state"]["data"]["entity"]
    except (KeyError, TypeError, json.JSONDecodeError) as e:
        raise SpotifyError("Spotify page could not be read") from e

    artwork = _embed_artwork(entity)
    tracks = []
    for item in entity.get("trackList") or []:
        title = (item.get("title") or "").strip()
        artist = (item.get("subtitle") or "").strip() or "Unknown"
        if not title or item.get("isPlayable") is False:
            continue
        duration_ms = item.get("duration") or 0
        spotify_id = (item.get("uri") or "").split(":")[-1]
        tracks.append({
            "id": spotify_id,
            "title": title,
            "duration": duration_ms / 1000 if duration_ms > 1000 else float(duration_ms or 0),
            "artworkUrl": artwork,
            "spotifyId": spotify_id,
            "isDownloaded": False,
            "isLiked": False,
            "artist": {"id": "", "name": artist, "imageUrl": "", "genres": []},
            "album": {
                "id": "",
                "title": entity.get("title") or entity.get("name") or "",
                "artworkUrl": artwork,
                "releaseYear": 0,
                "trackCount": 0,
                "artist": {"id": "", "name": artist, "imageUrl": "", "genres": []},
            },
        })

    return {
        "id": entity.get("id") or collection_id,
        "title": entity.get("title") or entity.get("name") or ("Album" if kind == "album" else "Playlist"),
        "artworkUrl": artwork,
        "trackCount": len(tracks),
        "tracks": tracks,
        "source": "spotify",
    }


async def get_playlist(playlist_id: str) -> dict:
    data   = await _get(f"/playlists/{playlist_id}")
    tracks = []
    for item in data.get("tracks", {}).get("items", []):
        t = item.get("track")
        if t and t.get("id"):
            tracks.append(_parse_track(t))
    return {
        "id":         data.get("id", ""),
        "title":      data.get("name", ""),
        "artworkUrl": _parse_image(data.get("images", [])),
        "trackCount": data.get("tracks", {}).get("total", 0),
        "tracks":     tracks,
        "source":     "spotify",
    }


async def get_artist(artist_id: str) -> dict:
    artist     = await _get(f"/artists/{artist_id}")
    top_tracks = await _get(f"/artists/{artist_id}/top-tracks?market=US")
    albums_raw = await _get(f"/artists/{artist_id}/albums?limit=10&include_groups=album,single")

    tracks = [_parse_track(t) for t in top_tracks.get("tracks", [])]
    albums = [_parse_album(a) for a in albums_raw.get("items", [])]

    return {
        **_parse_artist(artist),
        "topTracks": tracks,
        "albums":    albums,
    }


async def track_to_search_query(spotify_url: str) -> str:
    """Convert a Spotify track URL to a 'title artist' search string for yt-dlp."""
    kind = detect_spotify_type(spotify_url)
    if kind != "track":
        return ""
    sid   = extract_spotify_id(spotify_url, "track")
    if not sid:
        return ""
    track = await get_track(sid)
    return f"{track['title']} {track['artist']['name']}"