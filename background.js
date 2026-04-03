const mediaByTab = new Map()

const MEDIA_TYPES = {
  MP4: "mp4",
  HLS: "hls"
}

function sanitizeFilename(rawName) {
  const cleaned = (rawName || "video.mp4")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()

  return cleaned || "video.mp4"
}

function guessFilename(urlString) {
  try {
    const url = new URL(urlString)
    const pathname = url.pathname || ""
    const lastSegment = pathname.split("/").pop() || ""
    const decoded = decodeURIComponent(lastSegment)
    const baseName = decoded || "video"
    if (/\.(mp4|m3u8)($|[?#])/i.test(baseName)) {
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

async function downloadMedia(url, filename) {
  return browser.downloads.download({
    url,
    filename: sanitizeFilename(filename || guessFilename(url)),
    saveAs: false,
    conflictAction: "uniquify"
  })
}

function getMediaForTab(tabId) {
  return (mediaByTab.get(tabId) || []).slice(0, 100)
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

  if (message?.type === "download-media") {
    if (message.mediaType === MEDIA_TYPES.HLS) {
      return Promise.reject(new Error("HLS streams are playlists, not single MP4 files. Copy the URL into VLC instead."))
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
