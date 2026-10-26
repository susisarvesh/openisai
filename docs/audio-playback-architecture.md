# Drive playback

A saved song plays through the Save Songs API. The page sends the Google access token to that API in a header. The API reads the file from Drive and streams it to the audio element. The browser does not call Drive for the audio, and it does not build a blob URL.

## Why the old path failed

The audio element opens with `Range: bytes=0-` and will only play a `206` whose `Content-Range` matches the body. Drive answers that open range with `416 Requested range not satisfiable`. Browser JavaScript also cannot read Drive's `Content-Range`, because Drive's CORS response does not expose it.

Handing the downloaded bytes to the audio element as a blob URL failed the same way in Chrome: the element requested `Range: bytes=0-` and the request was cancelled. Decoding the bytes in the page was not verified against a real file.

## What plays a song now

1. The play control resumes the Web Audio context immediately, while the click is still the current gesture.
2. The page calls `POST /api/drive-audio/grant` with the Google access token in `X-Drive-Token`. The token is not put in the URL.
3. The API returns a path whose `play` query value is an encrypted grant. The grant holds the file id, the token, and an expiry. The expiry is the earlier of the token's expiry and 15 minutes. The grant is not written to disk or a database.
4. Howler plays that URL with `html5: true`. The audio element sends its normal range request to the API.
5. The API calls Drive `files.get?fields=size,mimeType`. If the size is missing, it stops. It does not guess a size from a partial body.
6. An open range such as `bytes=0-` or `bytes=500000-` is closed so it ends at `size - 1`. A closed range is forwarded as sent. `bytes=0-` is never sent to Drive.
7. The API requests `alt=media` with that closed range and streams Drive's response. Drive's status, `Content-Type`, `Content-Length`, and `Content-Range` are copied through unchanged.
8. A `401` drops the in-memory token and the page asks for one new grant. `403`, `404`, and `416` are not retried.

The service worker does not cache `/api/drive-audio/`. A cached response there would be served back to a later range request.

These saved files are m4a, and the index is often at the end of the file. The response is a real `206`, so the element can play it. The first sound can still wait until that index arrives. This path does not remux the file.

## Tests

From `api/`:

```sh
python -m pytest tests/test_drive_audio.py
```

The tests mock Drive. They do not call Google and do not use a real account. A song was not played through a Google account while these tests were written.

Confirm a saved song in Chrome at `http://localhost:3000/`: reload, press play once, and check that the media request goes to the API and returns `206` with a `Content-Range` whose total matches the file.

## References

- [Google Drive downloads](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
- [files.get](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get)
- [HTTP range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests)
- [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html)
- [HTML media elements](https://html.spec.whatwg.org/multipage/media.html)
