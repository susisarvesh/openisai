"""Stream a Drive file to the audio element without sending an open range.

Drive answers ``Range: bytes=0-`` with 416. The media element always opens
with that range. This service learns the real size, closes the range, and
copies Drive's own 206 and Content-Range through.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from urllib.parse import quote

import httpx
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

GRANT_TTL_SECONDS = 15 * 60
_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$", re.IGNORECASE)
_FILE_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


class DriveAudioError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


@dataclass
class DriveMetadata:
    status: int
    size: int | None
    mime: str | None


@dataclass
class DriveMedia:
    status: int
    headers: dict[str, str]
    body: AsyncIterator[bytes] | None
    close: object


def valid_file_id(file_id: str) -> bool:
    return bool(_FILE_ID.match(file_id or ""))


def _fernet() -> Fernet:
    digest = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def seal_grant(file_id: str, token: str, expires_at: int) -> str:
    payload = json.dumps({"f": file_id, "t": token, "e": int(expires_at)}, separators=(",", ":"))
    return _fernet().encrypt(payload.encode()).decode()


def issue_grant(file_id: str, token: str, expires_at: int | None) -> tuple[str, str]:
    """Return ``(play token, absolute-path URL)``. The Google token is not in the URL."""
    if not valid_file_id(file_id) or not token:
        raise DriveAudioError(400, "Could not play that song from Drive")
    now = int(time.time())
    cap = now + GRANT_TTL_SECONDS
    if expires_at is None:
        exp = cap
    else:
        exp = int(expires_at)
        if exp > 10**12:
            exp = exp // 1000
        if exp <= now:
            raise DriveAudioError(401, "Sign in again to play this song")
        exp = min(exp, cap)
    play = seal_grant(file_id, token, exp)
    query = f"play={quote(play, safe='')}"
    app_token = (settings.APP_TOKEN or "").strip()
    if app_token:
        query = f"{query}&app_token={quote(app_token, safe='')}"
    url = f"/api/drive-audio/{quote(file_id, safe='')}"
    return play, f"{url}?{query}"


def read_grant(play: str, file_id: str) -> str:
    if not play or not valid_file_id(file_id):
        raise DriveAudioError(401, "Sign in again to play this song")
    try:
        raw = _fernet().decrypt(play.encode(), ttl=GRANT_TTL_SECONDS)
    except (InvalidToken, ValueError):
        raise DriveAudioError(401, "Sign in again to play this song") from None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise DriveAudioError(401, "Sign in again to play this song") from None
    if data.get("f") != file_id:
        raise DriveAudioError(401, "Sign in again to play this song")
    try:
        exp = int(data.get("e") or 0)
    except (TypeError, ValueError):
        raise DriveAudioError(401, "Sign in again to play this song") from None
    if exp < int(time.time()):
        raise DriveAudioError(401, "Sign in again to play this song")
    token = data.get("t")
    if not isinstance(token, str) or not token:
        raise DriveAudioError(401, "Sign in again to play this song")
    return token


def closed_range(header: str | None, size: int) -> tuple[int, int]:
    """Turn the caller's range into a closed ``start, end`` inside the file.

    An open range such as ``bytes=0-`` becomes ``0 .. size-1``. The result is
    never expressed as ``bytes=0-``.
    """
    if size <= 0:
        raise DriveAudioError(502, "Could not play that song from Drive")
    last = size - 1
    if header is None or not header.strip():
        return 0, last
    spec = header.strip().split(",", 1)[0].strip()
    match = _RANGE.match(spec)
    if not match:
        raise DriveAudioError(416, "Could not play that song from Drive")
    start_s, end_s = match.group(1), match.group(2)
    if start_s == "" and end_s == "":
        raise DriveAudioError(416, "Could not play that song from Drive")
    if start_s == "":
        try:
            suffix = int(end_s)
        except ValueError:
            raise DriveAudioError(416, "Could not play that song from Drive") from None
        if suffix <= 0:
            raise DriveAudioError(416, "Could not play that song from Drive")
        return max(0, size - suffix), last
    try:
        start = int(start_s)
    except ValueError:
        raise DriveAudioError(416, "Could not play that song from Drive") from None
    if start > last:
        raise DriveAudioError(416, "Could not play that song from Drive")
    if end_s == "":
        return start, last
    try:
        end = int(end_s)
    except ValueError:
        raise DriveAudioError(416, "Could not play that song from Drive") from None
    if end < start:
        raise DriveAudioError(416, "Could not play that song from Drive")
    if end > last:
        end = last
    return start, end


def range_header(start: int, end: int) -> str:
    header = f"bytes={start}-{end}"
    if header == "bytes=0-" or header.endswith("-"):
        raise DriveAudioError(500, "Could not play that song from Drive")
    return header


def _meta_url(file_id: str) -> str:
    return f"https://www.googleapis.com/drive/v3/files/{quote(file_id, safe='')}?fields=size,mimeType"


def _media_url(file_id: str) -> str:
    return f"https://www.googleapis.com/drive/v3/files/{quote(file_id, safe='')}?alt=media"


async def fetch_metadata(file_id: str, token: str) -> DriveMetadata:
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0), follow_redirects=True) as client:
            response = await client.get(_meta_url(file_id), headers=headers)
    except httpx.HTTPError:
        raise DriveAudioError(502, "Could not play that song from Drive") from None
    if response.status_code != 200:
        return DriveMetadata(status=response.status_code, size=None, mime=None)
    try:
        body = response.json()
    except json.JSONDecodeError:
        return DriveMetadata(status=200, size=None, mime=None)
    mime = body.get("mimeType")
    mime_s = mime if isinstance(mime, str) and mime else None
    try:
        size = int(body.get("size"))
    except (TypeError, ValueError):
        size = None
    return DriveMetadata(status=200, size=size, mime=mime_s)


async def open_media(file_id: str, token: str, byte_range: str) -> DriveMedia:
    if byte_range == "bytes=0-" or not re.fullmatch(r"bytes=\d+-\d+", byte_range):
        raise DriveAudioError(500, "Could not play that song from Drive")
    client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=120.0), follow_redirects=True)
    try:
        request = client.build_request(
            "GET",
            _media_url(file_id),
            headers={"Authorization": f"Bearer {token}", "Range": byte_range},
        )
        response = await client.send(request, stream=True)
    except httpx.HTTPError:
        await client.aclose()
        raise DriveAudioError(502, "Could not play that song from Drive") from None

    async def close() -> None:
        await response.aclose()
        await client.aclose()

    if response.status_code not in (200, 206):
        await close()
        return DriveMedia(status=response.status_code, headers={}, body=None, close=close)

    forwarded: dict[str, str] = {"Accept-Ranges": "bytes", "Cache-Control": "no-store"}
    for source, dest in (
        ("content-type", "Content-Type"),
        ("content-length", "Content-Length"),
        ("content-range", "Content-Range"),
    ):
        value = response.headers.get(source)
        if value:
            forwarded[dest] = value

    async def chunks() -> AsyncIterator[bytes]:
        try:
            async for chunk in response.aiter_bytes():
                yield chunk
        finally:
            await close()

    return DriveMedia(status=response.status_code, headers=forwarded, body=chunks(), close=close)
