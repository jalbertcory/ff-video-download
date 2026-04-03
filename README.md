# Embedded MP4 Grabber

[![License: 0BSD](https://img.shields.io/badge/license-0BSD-17624a.svg)](./LICENSE)
[![Firefox](https://img.shields.io/badge/browser-Firefox-f08a24.svg)](https://www.mozilla.org/firefox/)
[![Manifest V3](https://img.shields.io/badge/webextension-MV3-1d2433.svg)](https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions)

A small Firefox extension that finds direct `.mp4` video files and HLS `.m3u8` playlists on the current page so you can download them or open the stream URL in VLC.

Firefox extension for grabbing direct embedded media URLs from ordinary web pages so you can watch them in a desktop player instead of a cramped browser video widget.

## License

This project is licensed under the `0BSD` license, which is about as permissive as it gets for software reuse.

## What it does

- Scans the page for direct MP4 sources in `<video>`, `<source>`, links, and common `data-*` attributes.
- Detects HLS `.m3u8` playlists when a site uses a `blob:` video element backed by a real playlist URL.
- Watches real network responses for MP4 files and HLS playlists, which helps when a custom player hides the URL in the DOM.
- Shows everything it found in the toolbar popup.
- Downloads one file at a time or all detected files at once.
- Copies stream URLs so you can paste an HLS playlist directly into VLC with `Media -> Open Network Stream`.

## What it does not do

- It only targets direct MP4 files and HLS playlist URLs.
- It does not turn HLS playlists into MP4 files inside Firefox.
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
