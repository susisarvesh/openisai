"""Playback URL for a saved Drive file.

The audio element cannot set a Google bearer token, so the page trades that
token for a short-lived encrypted grant. The grant is the only credential on
the media URL. Drive is contacted from this process, which can read
``Content-Range``.
"""

from __future__ import annotations

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from app.services import drive_audio_service as drive

router = APIRouter()


class GrantRequest(BaseModel):
    fileId: str = Field(min_length=1, max_length=128)
    expiresAt: int | None = None


class GrantResponse(BaseModel):
    url: str


def _failure(exc: drive.DriveAudioError) -> JSONResponse:
    return JSONResponse({"detail": exc.detail}, status_code=exc.status)


def _drive_status(status: int) -> JSONResponse | None:
    if status == 401:
        return JSONResponse({"detail": "Sign in again to play this song"}, status_code=401)
    if status == 403:
        return JSONResponse({"detail": "Drive refused access to that song"}, status_code=403)
    if status == 404:
        return JSONResponse({"detail": "That song is no longer in Drive"}, status_code=404)
    if status == 416:
        return JSONResponse({"detail": "Could not play that song from Drive"}, status_code=416)
    if status not in (200, 206):
        return JSONResponse({"detail": "Could not play that song from Drive"}, status_code=502)
    return None


@router.post("/grant", response_model=GrantResponse)
async def create_grant(
    body: GrantRequest,
    x_drive_token: str | None = Header(default=None, alias="X-Drive-Token"),
):
    token = (x_drive_token or "").strip()
    try:
        _play, url = drive.issue_grant(body.fileId, token, body.expiresAt)
    except drive.DriveAudioError as exc:
        return _failure(exc)
    if token and token in url:
        return JSONResponse({"detail": "Could not play that song from Drive"}, status_code=500)
    return GrantResponse(url=url)


async def _authorized(file_id: str, play: str) -> str:
    return drive.read_grant(play, file_id)


@router.head("/{file_id}")
@router.get("/{file_id}")
async def stream_drive_audio(
    file_id: str,
    request: Request,
    play: str = Query(default=""),
):
    try:
        token = await _authorized(file_id, play)
        meta = await drive.fetch_metadata(file_id, token)
    except drive.DriveAudioError as exc:
        return _failure(exc)
    refused = _drive_status(meta.status)
    if refused is not None:
        return refused
    if meta.size is None:
        return JSONResponse({"detail": "Could not play that song from Drive"}, status_code=502)
    if meta.size <= 0:
        return JSONResponse(
            {"detail": "That saved file is empty. Save the song again."},
            status_code=409,
        )

    try:
        start, end = drive.closed_range(request.headers.get("range"), meta.size)
        byte_range = drive.range_header(start, end)
    except drive.DriveAudioError as exc:
        return _failure(exc)

    if request.method == "HEAD":
        headers = {
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
            "Content-Length": str(end - start + 1),
            "Content-Range": f"bytes {start}-{end}/{meta.size}",
        }
        if meta.mime:
            headers["Content-Type"] = meta.mime
        return Response(status_code=206, headers=headers)

    try:
        media = await drive.open_media(file_id, token, byte_range)
    except drive.DriveAudioError as exc:
        return _failure(exc)
    refused = _drive_status(media.status)
    if refused is not None:
        return refused
    if media.body is None:
        return JSONResponse({"detail": "Could not play that song from Drive"}, status_code=502)
    return StreamingResponse(media.body, status_code=media.status, headers=media.headers)
