var DB = []
var DB_result = []
var baseUrls = {}
var PER_PAGE = 30
var isInitial = true
var previousSearch = ""
var favorites = [] // Array to store favorite app indices
var searchHistory = [] // Array to store search history
NodeList.prototype.forEach = Array.prototype.forEach // fix for < iOS 9.3

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

      // Load favorites from localStorage
      loadFavorites()

      // Load search history from localStorage
      loadSearchHistory()

      if (config && (config.page > 0 || config.search || config.bundleid)) {
        searchIPA(true)
      }
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
 * Favorites Management
 */

function loadFavorites() {
  try {
    const storedFavorites = localStorage.getItem("iparchive_favorites")
    if (storedFavorites) {
      favorites = JSON.parse(storedFavorites)
    }
  } catch (error) {
    console.error("Error loading favorites:", error)
    favorites = []
  }
}

function saveFavorites() {
  try {
    localStorage.setItem("iparchive_favorites", JSON.stringify(favorites))
  } catch (error) {
    console.error("Error saving favorites:", error)
  }
}

function toggleFavorite(idx) {
  const index = favorites.indexOf(idx)
  if (index === -1) {
    // Add to favorites
    favorites.push(idx)
    document.querySelectorAll(`.favorite-btn[data-idx="${idx}"]`).forEach((btn) => {
      btn.classList.add("active")
      btn.innerHTML = "★"
      btn.title = "Remove from favorites"
    })
  } else {
    // Remove from favorites
    favorites.splice(index, 1)
    document.querySelectorAll(`.favorite-btn[data-idx="${idx}"]`).forEach((btn) => {
      btn.classList.remove("active")
      btn.innerHTML = "☆"
      btn.title = "Add to favorites"
    })
  }
  saveFavorites()
}

function showFavorites() {
  if (favorites.length === 0) {
    setMessage(
      "<h3>Favorites</h3><p>You have no favorite apps saved. Click the star icon on any app to add it to your favorites.</p>",
    )
    return
  }

  const output = document.getElementById("content")
  output.innerHTML = "<h3>Favorites (" + favorites.length + ")</h3>"

  // Add export button for favorites
  output.innerHTML +=
    '<div class="export-actions"><button class="btn btn-primary" onclick="exportFavoritesToCSV()">Export Favorites to CSV</button></div>'

  // Display favorites
  output.innerHTML += entriesToStr(".entry", favorites)

  // Update favorite buttons to show active state
  favorites.forEach((idx) => {
    const btns = document.querySelectorAll(`.favorite-btn[data-idx="${idx}"]`)
    btns.forEach((btn) => {
      btn.classList.add("active")
      btn.innerHTML = "★"
      btn.title = "Remove from favorites"
    })
  })
}

/*
 * Search History Management
 */

function loadSearchHistory() {
  try {
    const storedHistory = localStorage.getItem("iparchive_search_history")
    if (storedHistory) {
      searchHistory = JSON.parse(storedHistory)
    }
  } catch (error) {
    console.error("Error loading search history:", error)
    searchHistory = []
  }

  // Display search history in the UI
  updateSearchHistoryUI()
}

function saveSearchHistory() {
  try {
    // Limit history to last 10 searches
    if (searchHistory.length > 10) {
      searchHistory = searchHistory.slice(-10)
    }
    localStorage.setItem("iparchive_search_history", JSON.stringify(searchHistory))

    // Update the UI
    updateSearchHistoryUI()
  } catch (error) {
    console.error("Error saving search history:", error)
  }
}

function updateSearchHistoryUI() {
  const historyContainer = document.getElementById("search-history")
  if (!historyContainer) return

  if (searchHistory.length === 0) {
    historyContainer.innerHTML = "<p>No recent searches</p>"
    return
  }

  let html = '<h4>Recent Searches</h4><ul class="history-list">'
  searchHistory
    .slice()
    .reverse()
    .forEach((item) => {
      html += `<li>
           <a href="#" onclick="applyHistorySearch('${encodeURIComponent(JSON.stringify(item))}'); return false;">
               ${item.search ? `"${item.search}"` : ""} 
               ${item.bundleid ? `Bundle: ${item.bundleid}` : ""} 
               ${item.minos ? `iOS ${item.minos}+` : ""} 
               ${item.maxos ? `iOS ${item.maxos}-` : ""}
               ${item.size_min ? `Size: ${item.size_min}MB+` : ""}
               ${item.size_max ? `Size: ${item.size_max}MB-` : ""}
           </a>
           <button class="history-delete" onclick="removeFromHistory(${searchHistory.indexOf(item)}); event.stopPropagation();">×</button>
       </li>`
    })
  html += "</ul>"
  historyContainer.innerHTML = html
}

function applyHistorySearch(encodedItem) {
  const item = JSON.parse(decodeURIComponent(encodedItem))

  // Apply the search parameters to the form
  document.getElementById("search").value = item.search || ""
  document.getElementById("bundleid").value = item.bundleid || ""
  document.getElementById("minos").value = item.minos || ""
  document.getElementById("maxos").value = item.maxos || ""
  document.getElementById("device").value = item.device || ""
  document.getElementById("minid").value = item.minid || ""
  document.getElementById("unique").checked = item.unique || false

  // If we have size filters
  if (document.getElementById("size_min")) {
    document.getElementById("size_min").value = item.size_min || ""
    document.getElementById("size_max").value = item.size_max || ""
  }

  // Execute the search
  searchIPA()
}

function removeFromHistory(index) {
  searchHistory.splice(index, 1)
  saveSearchHistory()
}

function addToSearchHistory() {
  // Create a search object with current parameters
  const searchObj = {
    search: document.getElementById("search").value,
    bundleid: document.getElementById("bundleid").value,
    minos: document.getElementById("minos").value,
    maxos: document.getElementById("maxos").value,
    device: document.getElementById("device").value,
    minid: document.getElementById("minid").value,
    unique: document.getElementById("unique").checked,
  }

  // Add size filters if they exist
  if (document.getElementById("size_min")) {
    searchObj.size_min = document.getElementById("size_min").value
    searchObj.size_max = document.getElementById("size_max").value
  }

  // Only add if there's at least one search parameter
  if (
    searchObj.search ||
    searchObj.bundleid ||
    searchObj.minos ||
    searchObj.maxos ||
    searchObj.device !== "" ||
    searchObj.minid ||
    searchObj.size_min ||
    searchObj.size_max
  ) {
    // Check if this search already exists in history
    const exists = searchHistory.some(
      (item) =>
        item.search === searchObj.search &&
        item.bundleid === searchObj.bundleid &&
        item.minos === searchObj.minos &&
        item.maxos === searchObj.maxos &&
        item.device === searchObj.device &&
        item.minid === searchObj.minid &&
        item.size_min === searchObj.size_min &&
        item.size_max === searchObj.size_max,
    )

    if (!exists) {
      searchHistory.push(searchObj)
      saveSearchHistory()
    }
  }
}

/*
 * CSV Export
 */

function exportToCSV() {
  if (DB_result.length === 0) {
    alert("No results to export.")
    return
  }

  // Create CSV header
  let csv = "Title,Bundle ID,Version,Min iOS,Platform,Size,Download URL\n"

  // Add data rows
  DB_result.forEach((idx) => {
    const entry = entryToDict(DB[idx])
    csv += `"${(entry.title || "").replace(/"/g, '""')}",` // Escape quotes in title
    csv += `"${entry.bundleId}",`
    csv += `"${entry.version}",`
    csv += `"${versionToStr(entry.minOS)}",`
    csv += `"${platformToStr(entry.platform)}",`
    csv += `"${humanSize(entry.size)}",`
    csv += `"${entry.ipa_url}"\n`
  })

  // Create and download the file
  downloadCSV(csv, "iparchive_export.csv")
}

function exportFavoritesToCSV() {
  if (favorites.length === 0) {
    alert("No favorites to export.")
    return
  }

  // Create CSV header
  let csv = "Title,Bundle ID,Version,Min iOS,Platform,Size,Download URL\n"

  // Add data rows
  favorites.forEach((idx) => {
    const entry = entryToDict(DB[idx])
    csv += `"${(entry.title || "").replace(/"/g, '""')}",` // Escape quotes in title
    csv += `"${entry.bundleId}",`
    csv += `"${entry.version}",`
    csv += `"${versionToStr(entry.minOS)}",`
    csv += `"${platformToStr(entry.platform)}",`
    csv += `"${humanSize(entry.size)}",`
    csv += `"${entry.ipa_url}"\n`
  })

  // Create and download the file
  downloadCSV(csv, "iparchive_favorites.csv")
}

function downloadCSV(csvContent, filename) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)

  const link = document.createElement("a")
  link.setAttribute("href", url)
  link.setAttribute("download", filename)
  link.style.visibility = "hidden"

  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
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

  // Get size filters if they exist
  const size_min = document.getElementById("size_min") ? document.getElementById("size_min").value : ""
  const size_max = document.getElementById("size_max") ? document.getElementById("size_max").value : ""

  const minV = minos ? strToVersion(minos) : 0
  const maxV = maxos ? strToVersion(maxos) : 9999999
  const device = platform ? 1 << platform : 255 // all flags
  const minPK = minid ? Number.parseInt(minid) : 0

  // Convert MB to bytes for size filtering
  const minSize = size_min ? Number.parseFloat(size_min) * 1024 * 1024 : 0
  const maxSize = size_max ? Number.parseFloat(size_max) * 1024 * 1024 : Number.POSITIVE_INFINITY

  // [7, 2,20200,"180","com.headcasegames.180","1.0",1,"180.ipa", 189930],
  // [pk, platform, minOS, title, bundleId, version, baseUrl, pathName, size]
  DB_result = []
  isInitial = false
  const uniqueBundleIds = {}
  DB.forEach((ipa, i) => {
    if (ipa[2] < minV || ipa[2] > maxV || !(ipa[1] & device) || ipa[0] < minPK) {
      return
    }

    // Size filtering
    if ((size_min && ipa[8] < minSize) || (size_max && ipa[8] > maxSize)) {
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

  // Add this search to history
  addToSearchHistory()
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

function entryToDict(entry) {
  const pk = entry[0]
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
    img_url: "data/" + Math.floor(pk / 1000) + "/" + pk + ".jpg",
  }
}

function entriesToStr(templateType, data) {
  const template = getTemplate(templateType)
  var rv = ""
  for (var i = 0; i < data.length; i++) {
    const entry = entryToDict(DB[data[i]])
    rv += renderTemplate(template, {
      $IDX: data[i],
      $IMG: entry.img_url,
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

  // Add favorite buttons to all entries
  setTimeout(() => {
    document.querySelectorAll(".entry, .full").forEach((entry) => {
      const idx = entry.getAttribute("data-idx")
      if (!idx) return

      // Find the info div to add the favorite button
      const infoDiv = entry.querySelector(".info")
      if (!infoDiv) return

      // Create favorite button if it doesn't exist
      if (!entry.querySelector(".favorite-btn")) {
        const favoriteBtn = document.createElement("button")
        favoriteBtn.className = "favorite-btn"
        favoriteBtn.setAttribute("data-idx", idx)
        favoriteBtn.innerHTML = favorites.includes(Number.parseInt(idx)) ? "★" : "☆"
        favoriteBtn.title = favorites.includes(Number.parseInt(idx)) ? "Remove from favorites" : "Add to favorites"
        if (favorites.includes(Number.parseInt(idx))) {
          favoriteBtn.classList.add("active")
        }
        favoriteBtn.onclick = () => {
          toggleFavorite(Number.parseInt(idx))
        }

        // Add button to the entry
        const firstChild = infoDiv.firstChild
        infoDiv.insertBefore(favoriteBtn, firstChild)
      }
    })
  }, 100)

  return rv
}

function printIPA(offset) {
  if (!offset) {
    offset = 0
  }

  const total = DB_result.length
  var content = "<h3>Results: " + total
  if (previousSearch) {
    content += ' -- Go to: <a onclick="restoreSearch()">previous search</a>'
  }
  content += "</h3>"

  // Add export button
  if (total > 0) {
    content +=
      '<div class="export-actions"><button class="btn btn-primary" onclick="exportToCSV()">Export to CSV</button></div>'
  }

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

