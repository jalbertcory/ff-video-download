# Embedded MP4 Grabber

[![License: 0BSD](https://img.shields.io/badge/license-0BSD-17624a.svg)](./LICENSE)
[![Firefox](https://img.shields.io/badge/browser-Firefox-f08a24.svg)](https://www.mozilla.org/firefox/)
[![Manifest V3](https://img.shields.io/badge/webextension-MV3-1d2433.svg)](https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions)

A small Firefox extension that finds direct `.mp4` video files and HLS `.m3u8` playlists on the current page so you can download MP4s, export VLC helpers, or try simple HLS remuxing to `.mp4`.

Firefox extension for grabbing direct embedded media URLs from ordinary web pages so you can watch them in a desktop player instead of a cramped browser video widget.

## License

The original extension code in this repo is licensed under `0BSD`.

This repo also vendors:

- `mux.js` in [vendor/mux-mp4.js](/Users/jalbertcory/Documents/code/ff-video-download/vendor/mux-mp4.js), licensed under `Apache-2.0`
- `mp4box` in [vendor/mp4box.all.js](/Users/jalbertcory/Documents/code/ff-video-download/vendor/mp4box.all.js), licensed under `BSD-3-Clause`

That means the repository is a mixed-license distribution rather than a pure `0BSD` codebase.

See [LICENSE](/Users/jalbertcory/Documents/code/ff-video-download/LICENSE), [THIRD_PARTY_NOTICES.md](/Users/jalbertcory/Documents/code/ff-video-download/THIRD_PARTY_NOTICES.md), [THIRD_PARTY_LICENSES/Apache-2.0.txt](/Users/jalbertcory/Documents/code/ff-video-download/THIRD_PARTY_LICENSES/Apache-2.0.txt), and [THIRD_PARTY_LICENSES/BSD-3-Clause.txt](/Users/jalbertcory/Documents/code/ff-video-download/THIRD_PARTY_LICENSES/BSD-3-Clause.txt).

## What it does

- Scans the page for direct MP4 sources in `<video>`, `<source>`, links, and common `data-*` attributes.
- Detects HLS `.m3u8` playlists when a site uses a `blob:` video element backed by a real playlist URL.
- Watches real network responses for MP4 files and HLS playlists, which helps when a custom player hides the URL in the DOM.
- Shows everything it found in the toolbar popup.
- Downloads direct MP4 files one at a time or all at once.
- Saves a small VLC helper `.m3u` file for HLS streams.
- Exports an `ffmpeg` command for HLS URLs, including cookies from the browser when available.
- Attempts a basic in-extension HLS remux for simple non-DRM MPEG-TS playlists, then flattens the fragmented MP4 into a more player-friendly final MP4 without re-encoding.

## What it does not do

- It only targets direct MP4 files and HLS playlist URLs.
- It does not turn HLS playlists into MP4 files inside Firefox.
- The built-in HLS remux only supports straightforward non-DRM MPEG-TS segment playlists. It does not support encrypted HLS, byte-range playlists, or fMP4-style HLS with `#EXT-X-MAP`.
- The in-browser MP4 remux is best-effort. If a site uses a trickier stream layout, use the exported `ffmpeg` command instead.
- It does not handle DRM, encrypted streams, `blob:` URLs themselves, or DASH (`.mpd`) manifests.
- It is intentionally not built for large streaming sites or site-specific extraction logic.

## Load it in Firefox

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Choose `{repo-directory}/ff-video-download/manifest.json`
4. Visit a page with an embedded MP4 player
5. Click the extension button and press **Download**

## Next ideas

- Add filename rules based on page title
- Add a right-click download action for videos
- Add filtering so duplicate CDN variants are easier to sort through
