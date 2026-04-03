const statusEl = document.getElementById("status")
const mediaListEl = document.getElementById("media-list")
const refreshButton = document.getElementById("refresh")
const downloadAllButton = document.getElementById("download-all")
const template = document.getElementById("media-item-template")

let activeTabId = null
let currentMedia = []

function isHls(item) {
  return item.mediaType === "hls"
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

  return `Found via: ${sources}`
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

  currentMedia = response.media || []
  renderMedia()
}

function renderMedia() {
  mediaListEl.textContent = ""

  if (currentMedia.length === 0) {
    downloadAllButton.disabled = true
    setStatus("No direct MP4 or HLS playlist URLs found on this tab yet.")
    return
  }

  downloadAllButton.disabled = false
  setStatus(`${currentMedia.length} media URL${currentMedia.length === 1 ? "" : "s"} found: ${getStatusSummary()}.`)

  for (const item of currentMedia) {
    const fragment = template.content.cloneNode(true)
    const article = fragment.querySelector(".media-item")
    const filenameEl = fragment.querySelector(".filename")
    const kindEl = fragment.querySelector(".kind")
    const urlEl = fragment.querySelector(".url")
    const metaEl = fragment.querySelector(".meta")
    const copyButtonEl = fragment.querySelector(".copy-one")
    const buttonEl = fragment.querySelector(".download-one")

    filenameEl.textContent = item.filename
    kindEl.textContent = describeKind(item)
    urlEl.textContent = truncateUrl(item.url)
    urlEl.title = item.url
    metaEl.textContent = describeSources(item)
    copyButtonEl.textContent = isHls(item) ? "Copy for VLC" : "Copy URL"
    buttonEl.textContent = isHls(item) ? "Download .m3u8" : "Download"

    copyButtonEl.addEventListener("click", async () => {
      copyButtonEl.disabled = true
      try {
        await copyText(item.url)
        setStatus(isHls(item) ? "Copied HLS playlist URL for VLC." : "Copied media URL.")
      } catch (error) {
        setStatus(`Copy failed: ${error.message || "unknown error"}`)
      } finally {
        copyButtonEl.disabled = false
      }
    })

    buttonEl.addEventListener("click", async () => {
      buttonEl.disabled = true
      setStatus(`Downloading ${item.filename}…`)

      try {
        await browser.runtime.sendMessage({
          type: "download-media",
          url: item.url,
          filename: item.filename
        })
        setStatus(`Started download for ${item.filename}.`)
      } catch (error) {
        setStatus(`Download failed: ${error.message || "unknown error"}`)
      } finally {
        buttonEl.disabled = false
      }
    })

    mediaListEl.append(article)
  }
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

  downloadAllButton.disabled = true
  setStatus(`Starting ${currentMedia.length} download${currentMedia.length === 1 ? "" : "s"}…`)

  try {
    await browser.runtime.sendMessage({
      type: "download-all-media",
      tabId: activeTabId
    })
    setStatus(`Started ${currentMedia.length} download${currentMedia.length === 1 ? "" : "s"}.`)
  } catch (error) {
    setStatus(`Bulk download failed: ${error.message || "unknown error"}`)
  } finally {
    downloadAllButton.disabled = false
  }
})

loadMedia().catch((error) => {
  setStatus(`Unable to scan this tab: ${error.message || "unknown error"}`)
})
