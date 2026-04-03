const mediaByTab = new Map()

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
    const baseName = decoded || "video.mp4"
    return sanitizeFilename(baseName.endsWith(".mp4") ? baseName : `${baseName}.mp4`)
  } catch {
    return "video.mp4"
  }
}

function isMp4Url(urlString) {
  return /\.mp4($|[?#])/i.test(urlString)
}

function isMp4ContentType(headers = []) {
  return headers.some((header) => {
    return header.name.toLowerCase() === "content-type" &&
      header.value &&
      header.value.toLowerCase().includes("video/mp4")
  })
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

  if (current) {
    current.lastSeen = Date.now()
    current.sources = Array.from(new Set([...(current.sources || []), incoming.source || "unknown"]))
    current.frameUrls = Array.from(new Set([...(current.frameUrls || []), ...(incoming.frameUrl ? [incoming.frameUrl] : [])]))
    current.mimeType = current.mimeType || incoming.mimeType || ""
    return
  }

  existing.push({
    url: normalizedUrl,
    filename: sanitizeFilename(incoming.filename || guessFilename(normalizedUrl)),
    mimeType: incoming.mimeType || "",
    sources: [incoming.source || "unknown"],
    frameUrls: incoming.frameUrl ? [incoming.frameUrl] : [],
    firstSeen: Date.now(),
    lastSeen: Date.now()
  })

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

browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) {
      return
    }

    if (!isMp4Url(details.url) && !isMp4ContentType(details.responseHeaders)) {
      return
    }

    upsertMedia(details.tabId, {
      url: details.url,
      filename: guessFilename(details.url),
      mimeType: details.responseHeaders?.find((header) => header.name.toLowerCase() === "content-type")?.value || "",
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
      media: (mediaByTab.get(message.tabId) || []).slice(0, 100)
    })
  }

  if (message?.type === "download-media") {
    return downloadMedia(message.url, message.filename).then((downloadId) => ({
      ok: true,
      downloadId
    }))
  }

  if (message?.type === "download-all-media") {
    const media = mediaByTab.get(message.tabId) || []
    return Promise.all(media.map((item) => downloadMedia(item.url, item.filename))).then((downloadIds) => ({
      ok: true,
      downloadIds
    }))
  }

  return undefined
})
