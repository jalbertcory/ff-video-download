const statusEl = document.getElementById("status")
const mediaListEl = document.getElementById("media-list")
const refreshButton = document.getElementById("refresh")
const downloadAllButton = document.getElementById("download-all")
const hideDuplicatesToggle = document.getElementById("hide-duplicates")
const template = document.getElementById("media-item-template")

let activeTabId = null
let currentMedia = []
let activeTabTitle = ""
let hideDuplicateVariants = true

function isHls(item) {
  return item.mediaType === "hls"
}

function isMp4(item) {
  return item.mediaType === "mp4"
}

function stripKnownExtension(name) {
  return String(name || "")
    .replace(/\.(mp4|m3u8|ts|m3u)$/i, "")
    .trim()
}

function normalizeSuggestedName(name) {
  return stripKnownExtension(
    String(name || "")
      .replace(/[_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  )
}

function getNormalizedPathSegments(urlString) {
  try {
    return new URL(urlString)
      .pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => normalizeSuggestedName(decodeURIComponent(segment)))
      .filter(Boolean)
  } catch {
    return []
  }
}

function getHlsAssetStem(item) {
  if (!isHls(item)) {
    return ""
  }

  const segments = getNormalizedPathSegments(item.url)
  const last = segments.at(-1) || ""
  const previous = segments.at(-2) || ""

  if (/^\d{3,6}$/.test(last) && previous) {
    return previous
  }

  if (["master", "index", "playlist", "stream"].includes(last) && previous) {
    return previous
  }

  return last || previous || ""
}

function cleanTitleCandidate(title) {
  const raw = String(title || "").trim()
  if (!raw) {
    return ""
  }

  const parts = raw.split(/\s[|:-]\s/)
  const candidate = parts[0] || raw
  return normalizeSuggestedName(candidate)
}

function looksOpaqueName(name) {
  const value = stripKnownExtension(name).toLowerCase()
  if (!value || value.length < 4) {
    return true
  }

  if (["video", "stream", "playlist", "master", "index", "source"].includes(value)) {
    return true
  }

  return /^[a-z0-9_-]{10,}$/i.test(value)
}

function buildSuggestedOutputNames(media, tabTitle, previousByUrl) {
  const pageBase = cleanTitleCandidate(tabTitle)
  const counts = new Map()

  return media.map((item) => {
    const previousName = normalizeSuggestedName(previousByUrl.get(item.url))
    if (previousName) {
      return {
        ...item,
        outputName: previousName
      }
    }

    const derivedHlsBase = getHlsAssetStem(item)
    const detectedBase = normalizeSuggestedName(item.filename)
    const structuralBase = derivedHlsBase || detectedBase
    const baseName = looksOpaqueName(detectedBase) && pageBase ? pageBase : (detectedBase || pageBase || "video")
    const finalBaseName = isHls(item) && structuralBase
      ? (looksOpaqueName(structuralBase) && pageBase ? pageBase : structuralBase)
      : baseName
    const count = (counts.get(finalBaseName) || 0) + 1
    counts.set(finalBaseName, count)

    return {
      ...item,
      outputName: count === 1 ? finalBaseName : `${finalBaseName} ${count}`
    }
  })
}

function getPrimaryExtension(item) {
  return ".mp4"
}

function getVariantLabel(item) {
  const haystack = `${item.filename} ${item.url}`
  const resolution = haystack.match(/\b(2160|1440|1080|960|720|540|480|360|240)p\b/i)
  if (resolution) {
    return `${resolution[1]}p`
  }

  const dimensions = haystack.match(/\b(\d{3,4})x(\d{3,4})\b/i)
  if (dimensions) {
    return `${dimensions[1]}x${dimensions[2]}`
  }

  if (/master/i.test(haystack)) {
    return "master"
  }

  return ""
}

function getResolutionScore(item) {
  const label = getVariantLabel(item)
  const resolution = label.match(/^(\d{3,4})p$/)
  if (resolution) {
    return Number(resolution[1])
  }

  const dimensions = label.match(/^(\d{3,4})x(\d{3,4})$/)
  if (dimensions) {
    return Math.max(Number(dimensions[1]), Number(dimensions[2]))
  }

  return 0
}

function getDuplicateGroupKey(item) {
  const pageBase = cleanTitleCandidate(activeTabTitle)
  const hlsAssetStem = getHlsAssetStem(item)
  let candidate = hlsAssetStem || normalizeSuggestedName(item.filename)

  if (looksOpaqueName(candidate) && pageBase) {
    candidate = pageBase
  }

  if (!candidate) {
    try {
      const pathnameStem = decodeURIComponent(new URL(item.url).pathname.split("/").pop() || "")
      candidate = normalizeSuggestedName(pathnameStem)
    } catch {
      candidate = ""
    }
  }

  const cleaned = candidate
    .toLowerCase()
    .replace(/\b(?:2160|1440|1080|960|720|540|480|360|240)p\b/g, " ")
    .replace(/\b\d{3,4}x\d{3,4}\b/g, " ")
    .replace(/\b(?:master|playlist|stream|index|video|audio|source|h264|x264|x265|hevc|avc1|aac|stereo|mono|high|medium|low)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  return `${item.mediaType}:${cleaned || pageBase.toLowerCase() || "video"}`
}

function getVariantScore(item) {
  let score = getResolutionScore(item) * 100000

  if (isMp4(item)) {
    score += 100000000
  }

  if (/master/i.test(item.url)) {
    score -= 10000
  }

  score += item.lastSeen || 0
  return score
}

function getVisibleMedia(items = currentMedia) {
  if (!hideDuplicateVariants) {
    return {
      media: items.map((item) => {
        item.hiddenVariantCount = 0
        return item
      }),
      hiddenVariantCount: 0
    }
  }

  const grouped = new Map()

  for (const item of items) {
    const key = getDuplicateGroupKey(item)
    const score = getVariantScore(item)
    const existing = grouped.get(key)

    if (!existing) {
      grouped.set(key, {
        best: item,
        bestScore: score,
        items: [item]
      })
      continue
    }

    existing.items.push(item)
    if (score > existing.bestScore) {
      existing.best = item
      existing.bestScore = score
    }
  }

  const media = Array.from(grouped.values())
    .map((entry) => {
      entry.best.hiddenVariantCount = Math.max(entry.items.length - 1, 0)
      return entry.best
    })
    .sort((left, right) => getVariantScore(right) - getVariantScore(left))

  return {
    media,
    hiddenVariantCount: items.length - media.length
  }
}

function getChosenBaseName(item) {
  return normalizeSuggestedName(item.outputName) || normalizeSuggestedName(item.filename) || "video"
}

function getOutputFilename(item, extension = "mp4") {
  return `${getChosenBaseName(item)}.${extension}`
}

function truncateUrl(url) {
  if (url.length <= 110) {
    return url
  }

  return `${url.slice(0, 72)}...${url.slice(-28)}`
}

function setStatus(message) {
  statusEl.textContent = message
}

function describeSources(item) {
  const sources = Array.isArray(item.sources) && item.sources.length > 0
    ? item.sources.join(", ")
    : "unknown"

  const details = [`Found via: ${sources}`]
  const variantLabel = getVariantLabel(item)

  if (variantLabel) {
    details.push(`Variant: ${variantLabel}`)
  }

  if (item.hiddenVariantCount > 0) {
    details.push(`${item.hiddenVariantCount} similar variant${item.hiddenVariantCount === 1 ? "" : "s"} hidden`)
  }

  return details.join(" • ")
}

function describeKind(item) {
  if (isHls(item)) {
    return "HLS stream playlist (.m3u8)"
  }

  return "Direct MP4 file"
}

function getStatusSummary() {
  const mp4Count = currentMedia.filter((item) => item.mediaType === "mp4").length
  const hlsCount = currentMedia.filter((item) => item.mediaType === "hls").length
  const parts = []

  if (mp4Count > 0) {
    parts.push(`${mp4Count} MP4`)
  }

  if (hlsCount > 0) {
    parts.push(`${hlsCount} HLS`)
  }

  return parts.join(" and ")
}

function getDownloadableMedia() {
  return getVisibleMedia(currentMedia).media.filter((item) => item.mediaType === "mp4")
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const helper = document.createElement("textarea")
  helper.value = text
  helper.setAttribute("readonly", "true")
  helper.style.position = "absolute"
  helper.style.left = "-9999px"
  document.body.append(helper)
  helper.select()
  document.execCommand("copy")
  helper.remove()
}

async function getActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true })
  return tabs[0] || null
}

async function rescanTab(tabId) {
  try {
    await browser.tabs.sendMessage(tabId, { type: "rescan-page" })
  } catch {
    // Some pages do not allow content scripts or may not have finished loading.
  }
}

async function loadMedia() {
  const tab = await getActiveTab()
  activeTabId = tab?.id ?? null
  activeTabTitle = tab?.title || ""

  if (!activeTabId) {
    currentMedia = []
    renderMedia()
    setStatus("No active tab found.")
    return
  }

  setStatus("Scanning this tab…")
  await rescanTab(activeTabId)

  const response = await browser.runtime.sendMessage({
    type: "get-media-for-tab",
    tabId: activeTabId
  })

  const previousByUrl = new Map(currentMedia.map((item) => [item.url, item.outputName]))
  currentMedia = buildSuggestedOutputNames(response.media || [], activeTabTitle, previousByUrl)
  renderMedia()
}

function renderMedia() {
  mediaListEl.textContent = ""

  if (currentMedia.length === 0) {
    downloadAllButton.disabled = true
    setStatus("No direct MP4 or HLS playlist URLs found on this tab yet.")
    return
  }

  const { media: visibleMedia, hiddenVariantCount } = getVisibleMedia(currentMedia)
  const downloadableMedia = getDownloadableMedia()
  downloadAllButton.disabled = downloadableMedia.length === 0
  downloadAllButton.textContent = downloadableMedia.length > 0
    ? `Download ${downloadableMedia.length === 1 ? "MP4" : "All MP4s"}`
    : "No MP4 Downloads"
  const hiddenSummary = hiddenVariantCount > 0 ? ` ${hiddenVariantCount} duplicate variant${hiddenVariantCount === 1 ? "" : "s"} hidden.` : ""
  setStatus(`${currentMedia.length} media URL${currentMedia.length === 1 ? "" : "s"} found: ${getStatusSummary()}.${hiddenSummary}`)

  for (const item of visibleMedia) {
    const fragment = template.content.cloneNode(true)
    const article = fragment.querySelector(".media-item")
    const nameInputEl = fragment.querySelector(".name-input")
    const nameExtensionEl = fragment.querySelector(".name-extension")
    const filenameEl = fragment.querySelector(".filename")
    const kindEl = fragment.querySelector(".kind")
    const urlEl = fragment.querySelector(".url")
    const metaEl = fragment.querySelector(".meta")
    const helperButtonEl = fragment.querySelector(".helper-one")
    const commandButtonEl = fragment.querySelector(".command-one")
    const buttonEl = fragment.querySelector(".download-one")

    nameInputEl.value = item.outputName
    nameExtensionEl.textContent = getPrimaryExtension(item)
    filenameEl.textContent = `Detected source name: ${item.filename}`
    kindEl.textContent = describeKind(item)
    urlEl.textContent = truncateUrl(item.url)
    urlEl.title = item.url
    metaEl.textContent = describeSources(item)
    helperButtonEl.textContent = isHls(item) ? "Save VLC Helper" : "Copy URL"
    commandButtonEl.classList.toggle("is-hidden", isMp4(item))
    buttonEl.textContent = isHls(item) ? "Try MP4 Remux" : "Download MP4"
    buttonEl.title = isHls(item)
      ? "Attempts to remux simple non-DRM MPEG-TS HLS streams into an MP4 file."
      : ""

    nameInputEl.addEventListener("input", (event) => {
      item.outputName = event.target.value
    })

    nameInputEl.addEventListener("blur", () => {
      const normalized = getChosenBaseName(item)
      item.outputName = normalized
      nameInputEl.value = normalized
    })

    helperButtonEl.addEventListener("click", async () => {
      helperButtonEl.disabled = true
      try {
        if (isHls(item)) {
          const response = await browser.runtime.sendMessage({
            type: "save-vlc-helper",
            item: {
              ...item,
              outputName: getChosenBaseName(item)
            }
          })
          setStatus(`Saved VLC helper playlist as ${response.filename}.`)
        } else {
          await copyText(item.url)
          setStatus("Copied media URL.")
        }
      } catch (error) {
        setStatus(`Helper action failed: ${error.message || "unknown error"}`)
      } finally {
        helperButtonEl.disabled = false
      }
    })

    commandButtonEl.addEventListener("click", async () => {
      commandButtonEl.disabled = true
      try {
        const response = await browser.runtime.sendMessage({
          type: "build-ffmpeg-command",
          item: {
            ...item,
            outputName: getChosenBaseName(item)
          }
        })
        await copyText(response.command)
        setStatus("Copied ffmpeg command.")
      } catch (error) {
        setStatus(`ffmpeg export failed: ${error.message || "unknown error"}`)
      } finally {
        commandButtonEl.disabled = false
      }
    })

    buttonEl.addEventListener("click", async () => {
      buttonEl.disabled = true
      setStatus(isHls(item) ? `Attempting MP4 remux for ${item.filename}…` : `Downloading ${item.filename}…`)

      try {
        if (isHls(item)) {
          const response = await browser.runtime.sendMessage({
            type: "download-media",
            mediaType: item.mediaType,
            item: {
              ...item,
              outputName: getChosenBaseName(item)
            }
          })
          setStatus(`Remuxed ${response.segmentCount} HLS segment${response.segmentCount === 1 ? "" : "s"} into ${response.filename}. If a site uses a more complex playlist format, use the ffmpeg export instead.`)
        } else {
          await browser.runtime.sendMessage({
            type: "download-media",
            url: item.url,
            filename: getOutputFilename(item),
            mediaType: item.mediaType,
            item
          })
          setStatus(`Started download for ${getOutputFilename(item)}.`)
        }
      } catch (error) {
        setStatus(`Download failed: ${error.message || "unknown error"}`)
      } finally {
        buttonEl.disabled = false
      }
    })

    mediaListEl.append(article)
  }
}

async function loadSettings() {
  try {
    const stored = await browser.storage.local.get({
      hideDuplicateVariants: true
    })
    hideDuplicateVariants = stored.hideDuplicateVariants !== false
  } catch {
    hideDuplicateVariants = true
  }

  hideDuplicatesToggle.checked = hideDuplicateVariants
}

refreshButton.addEventListener("click", async () => {
  refreshButton.disabled = true
  try {
    await loadMedia()
  } finally {
    refreshButton.disabled = false
  }
})

downloadAllButton.addEventListener("click", async () => {
  if (!activeTabId || currentMedia.length === 0) {
    return
  }

  const downloadableMedia = getDownloadableMedia()
  if (downloadableMedia.length === 0) {
    setStatus("No direct MP4 files are available to download on this tab.")
    return
  }

  downloadAllButton.disabled = true
  setStatus(`Starting ${downloadableMedia.length} MP4 download${downloadableMedia.length === 1 ? "" : "s"}…`)

  try {
    for (const item of downloadableMedia) {
      await browser.runtime.sendMessage({
        type: "download-media",
        url: item.url,
        filename: getOutputFilename(item),
        mediaType: item.mediaType,
        item
      })
    }
    setStatus(`Started ${downloadableMedia.length} MP4 download${downloadableMedia.length === 1 ? "" : "s"}.`)
  } catch (error) {
    setStatus(`Bulk download failed: ${error.message || "unknown error"}`)
  } finally {
    downloadAllButton.disabled = false
  }
})

hideDuplicatesToggle.addEventListener("change", async () => {
  hideDuplicateVariants = hideDuplicatesToggle.checked
  try {
    await browser.storage.local.set({
      hideDuplicateVariants
    })
  } catch {
    // Ignore storage failures and keep the in-memory setting.
  }
  renderMedia()
})

async function initializePopup() {
  await loadSettings()
  await loadMedia()
}

initializePopup().catch((error) => {
  setStatus(`Unable to scan this tab: ${error.message || "unknown error"}`)
})
