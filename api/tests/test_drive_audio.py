"""Drive playback proxy. Drive itself is mocked; no Google account is used."""

from __future__ import annotations

import time

import pytest

from app.core.config import settings
from app.services import drive_audio_service as drive


GOOGLE_TOKEN = "ya29.secret-token-not-for-urls"


@pytest.fixture(autouse=True)
def _drive_tests_skip_the_site_gate(monkeypatch):
    """The playback tests check the Drive grant, not the shared site token."""
    monkeypatch.setattr(settings, "APP_TOKEN", "")


def test_open_range_closes_at_the_real_size():
    assert drive.closed_range("bytes=0-", 1000) == (0, 999)
    assert drive.closed_range("bytes=500-", 1000) == (500, 999)
    assert drive.range_header(0, 999) == "bytes=0-999"
    assert drive.range_header(0, 999) != "bytes=0-"


def test_closed_range_is_forwarded_inside_the_file():
    assert drive.closed_range("bytes=0-10", 1000) == (0, 10)


@pytest.mark.asyncio
async def test_grant_url_hides_the_google_token_and_closes_the_open_range(client, monkeypatch):
    seen: dict[str, str] = {}

    async def fetch_metadata(file_id, token):
        assert file_id == "file_1"
        assert token == GOOGLE_TOKEN
        return drive.DriveMetadata(status=200, size=1000, mime="audio/mp4")

    async def open_media(file_id, token, byte_range):
        seen["range"] = byte_range
        seen["token"] = token

        async def chunks():
            yield b"a" * 1000

        return drive.DriveMedia(
            status=206,
            headers={
                "Accept-Ranges": "bytes",
                "Content-Type": "audio/mp4",
                "Content-Length": "1000",
                "Content-Range": "bytes 0-999/1000",
            },
            body=chunks(),
            close=None,
        )

    monkeypatch.setattr(drive, "fetch_metadata", fetch_metadata)
    monkeypatch.setattr(drive, "open_media", open_media)

    granted = await client.post(
        "/api/drive-audio/grant",
        json={"fileId": "file_1"},
        headers={"X-Drive-Token": GOOGLE_TOKEN},
    )
    assert granted.status_code == 200
    url = granted.json()["url"]
    assert GOOGLE_TOKEN not in url
    assert url.startswith("/api/drive-audio/file_1?play=")

    probed = await client.head(url)
    assert probed.status_code == 206
    assert probed.headers["content-range"] == "bytes 0-999/1000"
    assert "range" not in seen

    played = await client.get(url, headers={"Range": "bytes=0-"})
    assert played.status_code == 206
    assert played.headers["content-range"] == "bytes 0-999/1000"
    assert seen["range"] == "bytes=0-999"
    assert seen["token"] == GOOGLE_TOKEN


@pytest.mark.asyncio
async def test_open_seek_is_closed_with_the_real_size(client, monkeypatch):
    seen: dict[str, str] = {}

    async def fetch_metadata(file_id, token):
        return drive.DriveMetadata(status=200, size=1000, mime="audio/mp4")

    async def open_media(file_id, token, byte_range):
        seen["range"] = byte_range

        async def chunks():
            yield b"b" * 500

        return drive.DriveMedia(
            status=206,
            headers={
                "Content-Type": "audio/mp4",
                "Content-Length": "500",
                "Content-Range": "bytes 500-999/1000",
            },
            body=chunks(),
            close=None,
        )

    monkeypatch.setattr(drive, "fetch_metadata", fetch_metadata)
    monkeypatch.setattr(drive, "open_media", open_media)
    granted = await client.post(
        "/api/drive-audio/grant",
        json={"fileId": "file_1"},
        headers={"X-Drive-Token": GOOGLE_TOKEN},
    )
    played = await client.get(granted.json()["url"], headers={"Range": "bytes=500-"})
    assert played.status_code == 206
    assert played.headers["content-range"] == "bytes 500-999/1000"
    assert seen["range"] == "bytes=500-999"


@pytest.mark.asyncio
async def test_missing_size_does_not_invent_content_range(client, monkeypatch):
    async def fetch_metadata(file_id, token):
        return drive.DriveMetadata(status=200, size=None, mime="audio/mp4")

    async def open_media(file_id, token, byte_range):
        raise AssertionError("media must not be fetched without a size")

    monkeypatch.setattr(drive, "fetch_metadata", fetch_metadata)
    monkeypatch.setattr(drive, "open_media", open_media)
    granted = await client.post(
        "/api/drive-audio/grant",
        json={"fileId": "file_1"},
        headers={"X-Drive-Token": GOOGLE_TOKEN},
    )
    played = await client.get(granted.json()["url"], headers={"Range": "bytes=0-"})
    assert played.status_code == 502
    assert "content-range" not in played.headers


@pytest.mark.asyncio
async def test_empty_file_is_rejected_without_a_media_request(client, monkeypatch):
    async def fetch_metadata(file_id, token):
        return drive.DriveMetadata(status=200, size=0, mime="audio/mp4")

    async def open_media(file_id, token, byte_range):
        raise AssertionError("an empty file must not be fetched")

    monkeypatch.setattr(drive, "fetch_metadata", fetch_metadata)
    monkeypatch.setattr(drive, "open_media", open_media)
    granted = await client.post(
        "/api/drive-audio/grant",
        json={"fileId": "file_1"},
        headers={"X-Drive-Token": GOOGLE_TOKEN},
    )
    played = await client.get(granted.json()["url"], headers={"Range": "bytes=0-"})
    assert played.status_code == 409
    assert played.json()["detail"] == "That saved file is empty. Save the song again."
    assert "content-range" not in played.headers


@pytest.mark.asyncio
async def test_expired_and_mismatched_grants_are_rejected(client, monkeypatch):
    async def fetch_metadata(file_id, token):
        raise AssertionError("metadata must not be read for a bad grant")

    monkeypatch.setattr(drive, "fetch_metadata", fetch_metadata)
    expired = drive.seal_grant("file_1", GOOGLE_TOKEN, int(time.time()) - 10)
    stale = await client.get("/api/drive-audio/file_1", params={"play": expired})
    assert stale.status_code == 401

    other = drive.seal_grant("file_other", GOOGLE_TOKEN, int(time.time()) + 60)
    mismatch = await client.get("/api/drive-audio/file_1", params={"play": other})
    assert mismatch.status_code == 401
