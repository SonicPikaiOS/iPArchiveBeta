var DB = []
var DB_result = []
var baseUrls = {}
var PER_PAGE = 30
var isInitial = true
var previousSearch = ""
NodeList.prototype.forEach = Array.prototype.forEach // fix for < iOS 9.3

// Add this function near the top of the file, after the variable declarations
function createPlaceholderIcon() {
  // Create a simple colored square with text as a placeholder
  const canvas = document.createElement("canvas")
  canvas.width = 80
  canvas.height = 80
  const ctx = canvas.getContext("2d")

  // Fill background
  ctx.fillStyle = "#f0f0f0"
  ctx.fillRect(0, 0, 80, 80)

  // Add border
  ctx.strokeStyle = "#cccccc"
  ctx.lineWidth = 1
  ctx.strokeRect(0, 0, 80, 80)

  // Add text
  ctx.fillStyle = "#666666"
  ctx.font = "12px system-ui, -apple-system, sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText("No Icon", 40, 40)

  return canvas.toDataURL("image/png")
}

// Create the placeholder once when the script loads
const PLACEHOLDER_ICON = createPlaceholderIcon()

/*
 * Theme Management
 */
function initTheme() {
  // Check for saved theme preference
  const savedTheme = localStorage.getItem("theme")
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches

  // Apply theme based on saved preference or system preference
  if (savedTheme === "dark" || (!savedTheme && prefersDark)) {
    document.body.classList.add("dark")
    document.getElementById("theme-toggle").checked = true
  }

  // Listen for theme toggle changes
  document.getElementById("theme-toggle").addEventListener("change", (e) => {
    if (e.target.checked) {
      document.body.classList.add("dark")
      localStorage.setItem("theme", "dark")
    } else {
      document.body.classList.remove("dark")
      localStorage.setItem("theme", "light")
    }
  })

  // Listen for system preference changes
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    if (!localStorage.getItem("theme")) {
      // Only apply if user hasn't set a preference
      if (e.matches) {
        document.body.classList.add("dark")
        document.getElementById("theme-toggle").checked = true
      } else {
        document.body.classList.remove("dark")
        document.getElementById("theme-toggle").checked = false
      }
    }
  })
}

/*
 * CSV Export
 */
function exportToCSV() {
  if (DB_result.length === 0) {
    alert("No results to export.")
    return
  }

  // CSV header
  let csvContent = "Title,Bundle ID,Version,Min iOS,Platform,Size,Download URL\n"

  // Add data rows
  for (let i = 0; i < DB_result.length; i++) {
    const idx = DB_result[i]
    const entry = entryToDict(DB[idx])

    // Escape fields that might contain commas
    const title = `"${(entry.title || "").replace(/"/g, '""')}"`
    const bundleId = `"${entry.bundleId}"`
    const version = `"${entry.version || ""}"`
    const minOS = versionToStr(entry.minOS)
    const platform = `"${platformToStr(entry.platform)}"`
    const size = humanSize(entry.size)
    const url = `"${entry.ipa_url}"`

    csvContent += `${title},${bundleId},${version},${minOS},${platform},${size},${url}\n`
  }

  // Create download link
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.setAttribute("href", url)
  link.setAttribute("download", "iparchive_export.csv")
  link.style.display = "none"
  document.body.appendChild(link)

  // Trigger download and clean up
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/*
 * Init
 */

function setMessage(msg) {
  document.getElementById("content").innerHTML = msg
}

function loadFile(url, onErrFn, fn) {
  try {
    const xhr = new XMLHttpRequest()
    xhr.open("GET", url, true)
    xhr.responseType = "text"
    xhr.onload = (e) => {
      fn(e.target.response)
    }
    xhr.onerror = (e) => {
      onErrFn("Server or network error.")
    }
    xhr.send()
  } catch (error) {
    onErrFn(error)
  }
}

function loadDB() {
  var config = null
  try {
    config = loadConfig()
  } catch (error) {
    alert(error)
  }
  setMessage("Loading base-urls ...")
  loadFile("data/urls.json", setMessage, (data) => {
    baseUrls = JSON.parse(data)
    setMessage("Loading database ...")
    loadFile("data/ipa.json", setMessage, (data) => {
      DB = JSON.parse(data)
      setMessage("ready. Links in database: " + DB.length)
      if (config && (config.page > 0 || config.search || config.bundleid)) {
        searchIPA(true)
      }

      // Initialize theme after page is loaded
      initTheme()
    })
  })
}

function loadConfig() {
  if (!location.hash) {
    return // keep default values
  }
  const params = location.hash.substring(1).split("&")
  const data = {}
  params.forEach((param) => {
    const pair = param.split("=", 2)
    data[pair[0]] = decodeURIComponent(pair[1])
  })
  document.querySelectorAll("input,select").forEach((input) => {
    if (input.type === "checkbox") {
      input.checked = data[input.id] || null
    } else {
      input.value = data[input.id] || ""
    }
  })
  return data
}

function saveConfig() {
  const data = []
  document.querySelectorAll("input,select").forEach((e) => {
    // Skip theme toggle from URL hash
    if (e.id === "theme-toggle") return

    const value = e.type === "checkbox" ? e.checked : e.value
    if (value) {
      data.push(e.id + "=" + encodeURIComponent(value))
    }
  })
  const prev = location.hash
  location.hash = "#" + data.join("&")
  return prev !== location.hash
}

/*
 * Search
 */

function applySearch() {
  const term = document.getElementById("search").value.toLowerCase()
  const bundle = document.getElementById("bundleid").value.trim().toLowerCase()
  const unique = document.getElementById("unique").checked
  const minos = document.getElementById("minos").value
  const maxos = document.getElementById("maxos").value
  const platform = document.getElementById("device").value
  const minid = document.getElementById("minid").value

  const minV = minos ? strToVersion(minos) : 0
  const maxV = maxos ? strToVersion(maxos) : 9999999
  const device = platform ? 1 << platform : 255 // all flags
  const minPK = minid ? Number.parseInt(minid) : 0

  // [7, 2,20200,"180","com.headcasegames.180","1.0",1,"180.ipa", 189930],
  // [pk, platform, minOS, title, bundleId, version, baseUrl, pathName, size]
  DB_result = []
  isInitial = false
  const uniqueBundleIds = {}
  DB.forEach((ipa, i) => {
    if (ipa[2] < minV || ipa[2] > maxV || !(ipa[1] & device) || ipa[0] < minPK) {
      return
    }
    if (bundle && ipa[4].toLowerCase().indexOf(bundle) === -1) {
      return
    }
    if (
      !term ||
      ipa[3].toLowerCase().indexOf(term) > -1 ||
      ipa[4].toLowerCase().indexOf(term) > -1 ||
      ipa[7].toLowerCase().indexOf(term) > -1
    ) {
      if (unique) {
        const bId = ipa[4]
        if (uniqueBundleIds[bId]) {
          return
        }
        uniqueBundleIds[bId] = true
      }
      DB_result.push(i)
    }
  })
  delete uniqueBundleIds // free up memory
}

function restoreSearch() {
  location.hash = previousSearch
  const conf = loadConfig()
  previousSearch = ""
  if (conf.random) {
    randomIPA(conf.random)
  } else {
    searchIPA(true)
  }
}

function searchBundle(idx, additional) {
  previousSearch = location.hash + (additional || "")
  document.getElementById("bundleid").value = DB[idx][4]
  document.getElementById("search").value = ""
  document.getElementById("page").value = null
  document.getElementById("unique").checked = false
  searchIPA()
}

function searchIPA(restorePage) {
  var page = 0
  if (restorePage) {
    page = document.getElementById("page").value
  } else {
    document.getElementById("page").value = null
  }
  applySearch()
  printIPA((page || 0) * PER_PAGE)
  saveConfig()
}

/*
 * Random IPA
 */

function urlsToImgs(redirectUrl, list) {
  const template = getTemplate(".screenshot")
  var rv = '<div class="carousel">'
  for (var i = 0; i < list.length; i++) {
    rv += renderTemplate(template, { $REF: list[i], $URL: list[i] })
  }
  return rv + "</div>"
}

function randomIPA(specificId) {
  document.getElementById("search").value = ""
  document.getElementById("bundleid").value = ""
  if (saveConfig() || isInitial || specificId) {
    applySearch()
  }
  var idx = specificId
  if (!specificId) {
    if (DB_result.length > 0) {
      idx = DB_result[Math.floor(Math.random() * DB_result.length)]
    } else {
      idx = Math.floor(Math.random() * DB.length)
    }
  }
  const entry = entryToDict(DB[idx])
  const output = document.getElementById("content")
  output.innerHTML = "<h3>Random:</h3>" + entriesToStr(".full", [idx])
  output.lastElementChild.className += " single"
  output.innerHTML += renderTemplate(getTemplate(".randomAction"), { $IDX: idx })

  // Try to fetch iTunes info directly
  const iTunesUrl = "https://itunes.apple.com/lookup?bundleId=" + entry.bundleId
  loadFile(iTunesUrl, console.error, (data) => {
    try {
      const obj = JSON.parse(data)
      if (!obj || obj.resultCount < 1) {
        output.innerHTML += '<p class="no-itunes">No iTunes results available.</p>'
        return
      }
      const info = obj.results[0]
      const imgs1 = info.screenshotUrls || []
      const imgs2 = info.ipadScreenshotUrls || []
      const device = document.getElementById("device").value || 255

      var imgStr = ""
      if (imgs1 && imgs1.length > 0 && device & 1) {
        imgStr += "<p>iPhone Screenshots:</p>" + urlsToImgs("", imgs1)
      }
      if (imgs2 && imgs2.length > 0 && device & 2) {
        imgStr += "<p>iPad Screenshots:</p>" + urlsToImgs("", imgs2)
      }

      output.innerHTML += renderTemplate(getTemplate(".itunes"), {
        $VERSION: info.version || "Unknown",
        $PRICE: info.formattedPrice || "Unknown",
        $RATING: info.averageUserRating ? info.averageUserRating.toFixed(1) : "N/A",
        $ADVISORY: info.contentAdvisoryRating || "Unknown",
        $DATE: info.currentVersionReleaseDate || "Unknown",
        $GENRES: (info.genres || []).join(", "),
        $URL: info.trackViewUrl || "#",
        $IMG: imgStr,
        $DESCRIPTION: info.description || "No description available.",
      })
    } catch (error) {
      console.error("Error parsing iTunes data:", error)
      output.innerHTML += '<p class="no-itunes">Error fetching iTunes data.</p>'
    }
  })
}

/*
 * Output
 */

function platformToStr(num) {
  if (!num) {
    return "?"
  }
  return [
    num & (1 << 1) ? "iPhone" : null,
    num & (1 << 2) ? "iPad" : null,
    num & (1 << 3) ? "TV" : null,
    num & (1 << 4) ? "Watch" : null,
  ]
    .filter(Boolean)
    .join(", ")
}

function versionToStr(num) {
  if (!num) {
    return "?"
  }
  const major = Math.floor(num / 10000)
  const minor = Math.floor(num / 100) % 100
  const patch = num % 100
  return major + "." + minor + (patch ? "." + patch : "")
}

function strToVersion(versionStr) {
  const x = ((versionStr || "0") + ".0.0.0").split(".")
  return Number.parseInt(x[0]) * 10000 + Number.parseInt(x[1]) * 100 + Number.parseInt(x[2])
}

function humanSize(size) {
  var sizeIndex = 0
  while (size > 1024) {
    size /= 1024
    sizeIndex += 1
  }
  return size.toFixed(1) + ["kB", "MB", "GB"][sizeIndex]
}

function getTemplate(name) {
  return document.getElementById("templates").querySelector(name).outerHTML
}

function renderTemplate(template, values) {
  return template.replace(/\$[A-Z]+/g, (x) => values[x])
}

function validUrl(url) {
  return encodeURI(url).replace("#", "%23").replace("?", "%3F")
}

// Find the entryToDict function and modify the img_url line to ensure it's using the correct path
function entryToDict(entry) {
  const pk = entry[0]
  const padded = pk.toString().padStart(4, "0") // Ensure at least 4 digits
  return {
    pk: pk,
    platform: entry[1],
    minOS: entry[2],
    title: entry[3],
    bundleId: entry[4],
    version: entry[5],
    baseUrl: entry[6],
    pathName: entry[7],
    size: entry[8],
    ipa_url: baseUrls[entry[6]] + "/" + entry[7],
    // Fix the image path to match the GitHub repository structure
    img_url: `/data/${Math.floor(pk / 1000)}/${pk}.jpg`,
  }
}

// Modify the entriesToStr function to use our placeholder
function entriesToStr(templateType, data) {
  const template = getTemplate(templateType)
  var rv = ""
  for (var i = 0; i < data.length; i++) {
    const entry = entryToDict(DB[data[i]])
    rv += renderTemplate(template, {
      $IDX: data[i],
      $IMG: entry.img_url,
      $PLACEHOLDER: PLACEHOLDER_ICON,
      $TITLE: (entry.title || "?").replace("<", "&lt;"),
      $VERSION: entry.version,
      $BUNDLEID: entry.bundleId,
      $MINOS: versionToStr(entry.minOS),
      $PLATFORM: platformToStr(entry.platform),
      $SIZE: humanSize(entry.size),
      $URLNAME: entry.pathName.split("/").slice(-1), // decodeURI
      $URL: validUrl(entry.ipa_url),
    })
  }
  return rv
}

function printIPA(offset) {
  if (!offset) {
    offset = 0
  }

  const total = DB_result.length
  var content = '<div class="results-header"><h3>Results: ' + total
  if (previousSearch) {
    content += ' -- Go to: <a onclick="restoreSearch()">previous search</a>'
  }
  content += "</h3>"

  // Add export button if there are results
  if (total > 0) {
    content +=
      '<div class="export-actions"><button class="btn btn-success" onclick="exportToCSV()">Export to CSV</button></div>'
  }
  content += "</div>"

  const page = Math.floor(offset / PER_PAGE)
  const pages = Math.ceil(total / PER_PAGE)
  if (pages > 1) {
    content += paginationShort(page, pages)
  }

  const templateType = document.getElementById("unique").checked ? ".short" : ".entry"
  content += entriesToStr(templateType, DB_result.slice(offset, offset + PER_PAGE))

  if (pages > 1) {
    content += paginationShort(page, pages)
    content += paginationFull(page, pages)
  }

  document.getElementById("content").innerHTML = content
  window.scrollTo(0, 0)
}

/*
 * Pagination
 */

function p(page) {
  printIPA(page * PER_PAGE)
  document.getElementById("page").value = page || null
  saveConfig()
}

function paginationShort(page, pages) {
  return (
    '<div class="shortpage">' +
    '<button onclick="p(' +
    (page - 1) +
    ')" ' +
    (page == 0 ? "disabled" : "") +
    ">Prev</button>" +
    "<span>" +
    (page + 1) +
    " / " +
    pages +
    "</span>" +
    '<button onclick="p(' +
    (page + 1) +
    ')" ' +
    (page + 1 == pages ? "disabled" : "") +
    ">Next</button>" +
    "</div>"
  )
}

function paginationFull(page, pages) {
  var rv = '<div id="pagination">Pages:'
  for (var i = 0; i < pages; i++) {
    if (i === page) {
      rv += "<b>" + (i + 1) + "</b>"
    } else {
      rv += '<a onclick="p(' + i + ')">' + (i + 1) + "</a>"
    }
  }
  return rv + "</div>"
}

function urlWithSlash(url) {
  return url.toString().slice(-1) === "/" ? url : url + "/"
}

