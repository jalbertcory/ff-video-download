function normalizeUrl(rawUrl) {
  if (!rawUrl) {
    return null
  }

  try {
    const url = new URL(rawUrl, document.baseURI)
    if (!["http:", "https:"].includes(url.protocol)) {
      return null
    }
    return url.href
  } catch {
    return null
  }
}

function guessFilename(urlString) {
  try {
    const url = new URL(urlString)
    const filename = decodeURIComponent(url.pathname.split("/").pop() || "")
    return filename || "video"
  } catch {
    return "video"
  }
}

function detectMediaType(url) {
  if (/\.mp4($|[?#])/i.test(url)) {
    return "mp4"
  }

  if (/\.m3u8($|[?#])/i.test(url)) {
    return "hls"
  }

  return null
}

function collectDomMedia() {
  const results = new Map()

  const addCandidate = (rawUrl, source) => {
    const url = normalizeUrl(rawUrl)
    const mediaType = url ? detectMediaType(url) : null
    if (!url || !mediaType) {
      return
    }

    if (!results.has(url)) {
      results.set(url, {
        url,
        filename: guessFilename(url),
        mediaType,
        source
      })
    }
  }

  for (const video of document.querySelectorAll("video")) {
    addCandidate(video.currentSrc, "video.currentSrc")
    addCandidate(video.src, "video.src")
  }

  for (const source of document.querySelectorAll("video source, source")) {
    addCandidate(source.src, "source.src")
    addCandidate(source.getAttribute("src"), "source[src]")
  }

  for (const element of document.querySelectorAll("[src], [href], [data-src], [data-video], [data-url]")) {
    addCandidate(element.getAttribute("src"), "src")
    addCandidate(element.getAttribute("href"), "href")
    addCandidate(element.getAttribute("data-src"), "data-src")
    addCandidate(element.getAttribute("data-video"), "data-video")
    addCandidate(element.getAttribute("data-url"), "data-url")
  }

  return Array.from(results.values())
}

let scanTimer = null

function publishMedia() {
  const media = collectDomMedia()
  if (media.length === 0) {
    return
  }

  browser.runtime.sendMessage({
    type: "register-media",
    media
  }).catch(() => {})
}

function scheduleScan() {
  window.clearTimeout(scanTimer)
  scanTimer = window.setTimeout(() => {
    publishMedia()
  }, 300)
}

publishMedia()
window.addEventListener("load", publishMedia, { once: true })

const observer = new MutationObserver(() => {
  scheduleScan()
})

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["src", "href", "data-src", "data-video", "data-url"]
})

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "rescan-page") {
    publishMedia()
    return Promise.resolve({ ok: true })
  }

  return undefined
})
