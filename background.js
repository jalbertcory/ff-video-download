/* global muxjs */

const mediaByTab = new Map()

const MEDIA_TYPES = {
  MP4: "mp4",
  HLS: "hls"
}

const HLS_FETCH_CONCURRENCY = 6

function sanitizeFilename(rawName) {
  const cleaned = (rawName || "video.mp4")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()

  return cleaned || "video.mp4"
}

function stripKnownExtension(filename) {
  return (filename || "video").replace(/\.(mp4|m3u8|ts|m3u)$/i, "")
}

function withExtension(filename, extension) {
  return sanitizeFilename(`${stripKnownExtension(filename)}.${extension}`)
}

function guessFilename(urlString) {
  try {
    const url = new URL(urlString)
    const pathname = url.pathname || ""
    const lastSegment = pathname.split("/").pop() || ""
    const decoded = decodeURIComponent(lastSegment)
    const baseName = decoded || "video"
    if (/\.(mp4|m3u8|ts|m3u)($|[?#])/i.test(baseName)) {
      return sanitizeFilename(baseName)
    }
    return sanitizeFilename(`${baseName}.mp4`)
  } catch {
    return "video.mp4"
  }
}

function isMp4Url(urlString) {
  return /\.mp4($|[?#])/i.test(urlString)
}

function isHlsUrl(urlString) {
  return /\.m3u8($|[?#])/i.test(urlString)
}

function getContentType(headers = []) {
  return headers.find((header) => {
    return header.name.toLowerCase() === "content-type" && header.value
  })?.value || ""
}

function detectMediaType(urlString, mimeType = "") {
  const normalizedMimeType = mimeType.toLowerCase()

  if (isMp4Url(urlString) || normalizedMimeType.includes("video/mp4")) {
    return MEDIA_TYPES.MP4
  }

  if (
    isHlsUrl(urlString) ||
    normalizedMimeType.includes("application/vnd.apple.mpegurl") ||
    normalizedMimeType.includes("application/x-mpegurl")
  ) {
    return MEDIA_TYPES.HLS
  }

  return null
}

function normalizeMediaItem(incoming, normalizedUrl) {
  const mediaType = incoming.mediaType || detectMediaType(normalizedUrl, incoming.mimeType || "")
  if (!mediaType) {
    return null
  }

  const preferredFilename = incoming.filename || guessFilename(normalizedUrl)
  const defaultFilename = mediaType === MEDIA_TYPES.HLS ? "video.m3u8" : "video.mp4"

  return {
    url: normalizedUrl,
    mediaType,
    filename: sanitizeFilename(preferredFilename || defaultFilename),
    mimeType: incoming.mimeType || "",
    sources: [incoming.source || "unknown"],
    frameUrls: incoming.frameUrl ? [incoming.frameUrl] : [],
    firstSeen: Date.now(),
    lastSeen: Date.now()
  }
}

function upsertMedia(tabId, incoming) {
  if (typeof tabId !== "number" || !incoming?.url) {
    return
  }

  let parsedUrl
  try {
    parsedUrl = new URL(incoming.url)
  } catch {
    return
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return
  }

  const existing = mediaByTab.get(tabId) || []
  const normalizedUrl = parsedUrl.href
  const current = existing.find((item) => item.url === normalizedUrl)
  const normalizedItem = normalizeMediaItem(incoming, normalizedUrl)

  if (!normalizedItem) {
    return
  }

  if (current) {
    current.lastSeen = Date.now()
    current.sources = Array.from(new Set([...(current.sources || []), incoming.source || "unknown"]))
    current.frameUrls = Array.from(new Set([...(current.frameUrls || []), ...(incoming.frameUrl ? [incoming.frameUrl] : [])]))
    current.mimeType = current.mimeType || incoming.mimeType || ""
    current.mediaType = current.mediaType || normalizedItem.mediaType
    return
  }

  existing.push(normalizedItem)
  existing.sort((a, b) => b.lastSeen - a.lastSeen)
  mediaByTab.set(tabId, existing)
}

function clearTabMedia(tabId) {
  if (typeof tabId === "number") {
    mediaByTab.delete(tabId)
  }
}

function getMediaForTab(tabId) {
  return (mediaByTab.get(tabId) || []).slice(0, 100)
}

async function downloadMedia(url, filename) {
  return browser.downloads.download({
    url,
    filename: sanitizeFilename(filename || guessFilename(url)),
    saveAs: false,
    conflictAction: "uniquify"
  })
}

function createBlobDownload(blob, filename) {
  const blobUrl = URL.createObjectURL(blob)

  return browser.downloads.download({
    url: blobUrl,
    filename: sanitizeFilename(filename),
    saveAs: false,
    conflictAction: "uniquify"
  }).finally(() => {
    setTimeout(() => {
      URL.revokeObjectURL(blobUrl)
    }, 60_000)
  })
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function shellAnsiQuote(value) {
  return `$'${String(value)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")}'`
}

async function getCookieHeader(url) {
  try {
    const cookies = await browser.cookies.getAll({ url })
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ")
  } catch {
    return ""
  }
}

async function buildFfmpegCommand(item) {
  const headerLines = []
  const referer = item.frameUrls?.[0]
  const cookies = await getCookieHeader(item.url)

  if (referer) {
    headerLines.push(`Referer: ${referer}`)
  }

  if (cookies) {
    headerLines.push(`Cookie: ${cookies}`)
  }

  const commandParts = [
    "ffmpeg",
    "-user_agent",
    shellQuote(navigator.userAgent)
  ]

  if (headerLines.length > 0) {
    commandParts.push("-headers", shellAnsiQuote(`${headerLines.join("\r\n")}\r\n`))
  }

  commandParts.push(
    "-i",
    shellQuote(item.url),
    "-c",
    "copy",
    shellQuote(withExtension(item.filename || guessFilename(item.url), "mp4"))
  )

  return commandParts.join(" ")
}

function buildFetchOptions(item) {
  const referer = item?.frameUrls?.[0]
  const options = {
    credentials: "include"
  }

  if (referer) {
    options.referrer = referer
    options.referrerPolicy = "strict-origin-when-cross-origin"
  }

  return options
}

function resolveUrl(baseUrl, rawUrl) {
  return new URL(rawUrl, baseUrl).href
}

function parseAttributeList(rawAttributes) {
  const attributes = {}
  const pattern = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi

  for (const match of rawAttributes.matchAll(pattern)) {
    const key = match[1]
    const rawValue = match[2] || ""
    attributes[key] = rawValue.startsWith("\"") && rawValue.endsWith("\"")
      ? rawValue.slice(1, -1)
      : rawValue
  }

  return attributes
}

function findNextUriLine(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index]
    if (line && !line.startsWith("#")) {
      return { index, line }
    }
  }

  return null
}

function parseHlsPlaylist(text, playlistUrl) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const playlist = {
    playlistUrl,
    variants: [],
    segments: [],
    encrypted: false,
    usesByteRange: false,
    mapUrl: ""
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (line.startsWith("#EXT-X-KEY:")) {
      const attributes = parseAttributeList(line.slice("#EXT-X-KEY:".length))
      if ((attributes.METHOD || "NONE").toUpperCase() !== "NONE") {
        playlist.encrypted = true
      }
      continue
    }

    if (line.startsWith("#EXT-X-BYTERANGE:")) {
      playlist.usesByteRange = true
      continue
    }

    if (line.startsWith("#EXT-X-MAP:")) {
      const attributes = parseAttributeList(line.slice("#EXT-X-MAP:".length))
      if (attributes.URI) {
        playlist.mapUrl = resolveUrl(playlistUrl, attributes.URI)
      }
      continue
    }

    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const nextEntry = findNextUriLine(lines, index + 1)
      if (nextEntry) {
        const attributes = parseAttributeList(line.slice("#EXT-X-STREAM-INF:".length))
        playlist.variants.push({
          url: resolveUrl(playlistUrl, nextEntry.line),
          bandwidth: Number(attributes.BANDWIDTH || 0),
          resolution: attributes.RESOLUTION || ""
        })
        index = nextEntry.index
      }
      continue
    }

    if (line.startsWith("#")) {
      continue
    }

    playlist.segments.push(resolveUrl(playlistUrl, line))
  }

  return playlist
}

function choosePreferredVariant(variants) {
  return [...variants].sort((left, right) => {
    const leftArea = left.resolution ? left.resolution.split("x").reduce((acc, value) => acc * Number(value || 0), 1) : 0
    const rightArea = right.resolution ? right.resolution.split("x").reduce((acc, value) => acc * Number(value || 0), 1) : 0
    return (right.bandwidth - left.bandwidth) || (rightArea - leftArea)
  })[0]
}

async function fetchText(url, item) {
  const response = await fetch(url, buildFetchOptions(item))

  if (!response.ok) {
    throw new Error(`Request failed for ${url} (${response.status}).`)
  }

  return response.text()
}

async function resolveMediaPlaylist(url, item, visited = new Set()) {
  if (visited.has(url)) {
    throw new Error("Playlist recursion loop detected.")
  }

  visited.add(url)
  const text = await fetchText(url, item)
  const playlist = parseHlsPlaylist(text, url)

  if (playlist.encrypted) {
    throw new Error("Encrypted HLS playlists are not supported for in-extension download.")
  }

  if (playlist.usesByteRange) {
    throw new Error("Byte-range HLS playlists are not supported for in-extension download.")
  }

  if (playlist.mapUrl) {
    throw new Error("fMP4-style HLS playlists are not supported for in-extension download yet.")
  }

  if (playlist.variants.length > 0) {
    const variant = choosePreferredVariant(playlist.variants)
    return resolveMediaPlaylist(variant.url, item, visited)
  }

  if (playlist.segments.length === 0) {
    throw new Error("No media segments were found in the HLS playlist.")
  }

  return playlist
}

async function fetchSegment(segmentUrl, item) {
  const response = await fetch(segmentUrl, buildFetchOptions(item))

  if (!response.ok) {
    throw new Error(`Segment request failed for ${segmentUrl} (${response.status}).`)
  }

  return {
    contentType: response.headers.get("content-type") || "",
    data: await response.arrayBuffer()
  }
}

function isLikelyTransportStream(segmentUrl, contentType = "") {
  return /\.ts($|[?#])/i.test(segmentUrl) || contentType.toLowerCase().includes("video/mp2t")
}

async function fetchSegmentsInOrder(segmentUrls, item) {
  const parts = new Array(segmentUrls.length)
  let nextIndex = 1

  const firstSegment = await fetchSegment(segmentUrls[0], item)
  if (!isLikelyTransportStream(segmentUrls[0], firstSegment.contentType)) {
    throw new Error("This HLS stream is not using MPEG-TS segments, so the simple merge downloader cannot assemble it safely.")
  }
  parts[0] = firstSegment.data

  async function worker() {
    while (nextIndex < segmentUrls.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      const segment = await fetchSegment(segmentUrls[currentIndex], item)
      parts[currentIndex] = segment.data
    }
  }

  const workerCount = Math.min(HLS_FETCH_CONCURRENCY, Math.max(segmentUrls.length - 1, 0))
  const workers = Array.from({ length: workerCount }, () => worker())
  await Promise.all(workers)
  return parts
}

function concatUint8Arrays(parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const combined = new Uint8Array(totalLength)
  let offset = 0

  for (const part of parts) {
    combined.set(part, offset)
    offset += part.byteLength
  }

  return combined
}

function transmuxTsPartsToMp4(parts) {
  return new Promise((resolve, reject) => {
    if (!globalThis.muxjs?.Transmuxer) {
      reject(new Error("MP4 transmuxer is unavailable in this browser context."))
      return
    }

    const transmuxer = new muxjs.Transmuxer({
      keepOriginalTimestamps: false,
      remux: true
    })
    const mp4Parts = []
    let sawSegment = false

    transmuxer.on("data", (segment) => {
      sawSegment = true

      if (mp4Parts.length === 0) {
        mp4Parts.push(new Uint8Array(segment.initSegment))
      }

      mp4Parts.push(new Uint8Array(segment.data))
    })

    try {
      for (const part of parts) {
        transmuxer.push(new Uint8Array(part))
        transmuxer.flush()
      }
    } catch (error) {
      reject(error)
      return
    }

    if (!sawSegment || mp4Parts.length === 0) {
      reject(new Error("Unable to remux this HLS stream into MP4."))
      return
    }

    resolve(concatUint8Arrays(mp4Parts))
  })
}

async function downloadMergedHls(item) {
  const playlist = await resolveMediaPlaylist(item.url, item)
  const parts = await fetchSegmentsInOrder(playlist.segments, item)
  const mp4Bytes = await transmuxTsPartsToMp4(parts)
  const blob = new Blob([mp4Bytes], {
    type: "video/mp4"
  })
  const filename = withExtension(item.filename || guessFilename(item.url), "mp4")
  const downloadId = await createBlobDownload(blob, filename)

  return {
    downloadId,
    filename,
    segmentCount: playlist.segments.length
  }
}

async function saveVlcHelper(item) {
  const title = stripKnownExtension(item.filename || guessFilename(item.url)) || "Stream"
  const helperContents = [
    "#EXTM3U",
    `#EXTINF:-1,${title}`,
    item.url
  ].join("\n")

  const blob = new Blob([helperContents], {
    type: "audio/x-mpegurl"
  })
  const filename = withExtension(item.filename || guessFilename(item.url), "m3u")
  const downloadId = await createBlobDownload(blob, filename)

  return {
    downloadId,
    filename
  }
}

browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) {
      return
    }

    const mimeType = getContentType(details.responseHeaders)
    const mediaType = detectMediaType(details.url, mimeType)

    if (!mediaType) {
      return
    }

    upsertMedia(details.tabId, {
      url: details.url,
      filename: guessFilename(details.url),
      mimeType,
      mediaType,
      source: "network"
    })
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
)

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    clearTabMedia(tabId)
  }
})

browser.tabs.onRemoved.addListener((tabId) => {
  clearTabMedia(tabId)
})

browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "register-media") {
    const tabId = sender.tab?.id
    for (const item of message.media || []) {
      upsertMedia(tabId, {
        ...item,
        source: item.source || "page",
        frameUrl: sender.frameId && sender.url ? sender.url : sender.tab?.url
      })
    }
    return Promise.resolve({ ok: true })
  }

  if (message?.type === "get-media-for-tab") {
    return Promise.resolve({
      media: getMediaForTab(message.tabId)
    })
  }

  if (message?.type === "build-ffmpeg-command") {
    return buildFfmpegCommand(message.item).then((command) => ({
      command
    }))
  }

  if (message?.type === "save-vlc-helper") {
    return saveVlcHelper(message.item).then((result) => ({
      ok: true,
      ...result
    }))
  }

  if (message?.type === "download-media") {
    if (message.mediaType === MEDIA_TYPES.HLS) {
      return downloadMergedHls(message.item).then((result) => ({
        ok: true,
        ...result
      }))
    }

    return downloadMedia(message.url, message.filename).then((downloadId) => ({
      ok: true,
      downloadId
    }))
  }

  if (message?.type === "download-all-media") {
    const media = getMediaForTab(message.tabId).filter((item) => item.mediaType === MEDIA_TYPES.MP4)

    if (media.length === 0) {
      return Promise.reject(new Error("No direct MP4 files are available to download on this tab."))
    }

    return Promise.all(media.map((item) => downloadMedia(item.url, item.filename))).then((downloadIds) => ({
      ok: true,
      downloadIds
    }))
  }

  return undefined
})
