const DB_NAME = "NammaNelaCache";
const STORE_NAME = "papers";
const DB_VERSION = 1;

// Global Elements
const canvas = document.getElementById("pdf-render");
const ctx = canvas.getContext("2d");
const viewerContainer = document.querySelector('.viewer-container');
const scrollWrapper = document.getElementById('customScrollContainer');
const pageIndicator = document.getElementById("pageIndicator");
const paperBadge = document.getElementById("paperBadge");
const leftScrollButton = document.querySelector('.custom-scroll-content.left');
const rightScrollButton = document.querySelector('.custom-scroll-content.right');
const fixedPrevButton = document.getElementById('fixedPrev');
const fixedNextButton = document.getElementById('fixedNext');
const editionTitle = document.getElementById("editionTitle");
const readerCount = document.getElementById("readerCount");
const thumbnailSidebar = document.getElementById("thumbnailSidebar");
// const scrollThumb = document.getElementById('customScrollThumb');

let pdfDoc = null, pageNum = 1, paperMap = {}, availableDates = [];
let currentRenderTask = null;
let currentScaleFactor = 1;
let currentEditionDate = "";
let snippetMappings = [];
let snippetLayer = null;
const snippetImageCache = new Map();
let snippetSyncFrame = null;
let appBootstrapped = false;

const WEB_APP_URL = "https://script.google.com/macros/s/AKfycby4GFEtETO4IsTZnup7cbTxJIa1kt0qh-ts485HjTVRkpXM0Vn_yqnYmvfJjG3dZl3XRQ/exec";
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.14.305/pdf.worker.min.js";


// --- DATABASE & CACHE ---
const openDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
};

const saveToDB = async (date, data) => {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(data, date);
    return tx.complete;
};

const getFromDB = async (date) => {
    const db = await openDB();
    return new Promise((resolve) => {
        const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(date);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
    });
};

const getCacheKey = (date, fileId) => `${date}__${fileId || "no-file"}`;

function ensureSnippetLayer() {
    if (snippetLayer) return snippetLayer;
    snippetLayer = document.createElement("div");
    snippetLayer.className = "paper-snippet-layer";
    viewerContainer.appendChild(snippetLayer);
    return snippetLayer;
}

function scheduleSnippetHotspotSync() {
    if (snippetSyncFrame !== null) {
        cancelAnimationFrame(snippetSyncFrame);
    }

    snippetSyncFrame = requestAnimationFrame(() => {
        snippetSyncFrame = null;
        renderSnippetHotspots();
    });
}

const cleanOldDB = async () => {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const validDates = [];
    for (let i = 0; i < 8; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        validDates.push(`${day}-${month}-${year}`);
    }
    const request = store.openCursor();
    request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
            const isValidKey = validDates.some(date => String(cursor.key).startsWith(`${date}__`));
            if (!isValidKey) store.delete(cursor.key);
            cursor.continue();
        }
    };
};

// --- CORE RENDERING ---
function renderPage(num) {
    pdfDoc.getPage(num).then(page => {
        if (currentRenderTask !== null) currentRenderTask.cancel();

        const viewport = page.getViewport({ scale: 4 });
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
            canvasContext: ctx,
            viewport: viewport,
            intent: 'print'
        };

        currentRenderTask = page.render(renderContext);
        currentRenderTask.promise.then(() => {
            currentRenderTask = null;
            currentScaleFactor = 1;
            applyZoom();
            scheduleSnippetHotspotSync();
            viewerContainer.scrollLeft = 0;
            window.scrollTo(0, 0);
        }).catch(err => {
            if (err.name !== 'RenderingCancelledException') console.error(err);
        });

        if (pageIndicator) {
            pageIndicator.innerText = `Page ${num} / ${pdfDoc.numPages}`;
        }
    });
}

// --- RESTORED & FIXED ZOOM LOGIC ---
function applyZoom() {
    // 1. Restore the visual scale from your working old code
    canvas.style.transformOrigin = "top left";
    canvas.style.transform = `scale(${currentScaleFactor})`;

    // 2. Calculate real zoomed dimensions for scrolling
    const zoomedWidth = canvas.offsetWidth * currentScaleFactor;
    const zoomedHeight = canvas.offsetHeight * currentScaleFactor;
    viewerContainer.style.height = zoomedHeight + "px";

    // 3. Update container size to allow vertical/horizontal scrolling
    viewerContainer.style.height = zoomedHeight + "px";

    if (currentScaleFactor > 1) {
        if (scrollWrapper) scrollWrapper.style.display = 'flex';
        // scrollThumb.style.width = zoomedWidth + "px";
        viewerContainer.style.overflowX = "auto";
    } else {
        if (scrollWrapper) scrollWrapper.style.display = 'none';
        viewerContainer.style.height = "auto";
        viewerContainer.scrollLeft = 0;
        if (scrollWrapper) {
            scrollWrapper.scrollLeft = 0;
        }
    }

    renderSnippetHotspots();
}

// --- BUTTONS ---
document.querySelector('.plus').onclick = () => {
    if (currentScaleFactor < 3.5) {
        currentScaleFactor += 0.4;
        applyZoom();
    }
};

document.querySelector('.minus').onclick = () => {
    if (currentScaleFactor > 1) {
        currentScaleFactor -= 0.4;
        if (currentScaleFactor < 1) currentScaleFactor = 1;
        applyZoom();
    }
};

// --- HORIZONTAL SCROLL BUTTONS ---
if (leftScrollButton) {
    leftScrollButton.onclick = () => {
        viewerContainer.scrollBy({ left: -200, behavior: 'smooth' });
    };
}

if (rightScrollButton) {
    rightScrollButton.onclick = () => {
        viewerContainer.scrollBy({ left: 200, behavior: 'smooth' });
    };
}

// --- FETCH & UNIQUE COUNT ---
async function fetchData() {
    await cleanOldDB();
    try {
        let url = WEB_APP_URL;

        // Use ONE unique key for this session
        if (!sessionStorage.getItem('namma_nela_final_counted')) {
            url += (url.includes('?') ? '&' : '?') + "increment=true";
            sessionStorage.setItem('namma_nela_final_counted', 'true');
        }

        const response = await fetch(url);
        const data = await response.json();

        paperMap = data.paperMap;
        availableDates = data.availableDates;

        // Video Logic
        if (data.lastVideo) {
            const dynamicLink = normalizeVideoUrl(data.lastVideo);
            if (dynamicLink) {
                videoSource = dynamicLink;
                loadVideo();
                if (localStorage.getItem('lastSeenVideo') !== data.lastVideo) showVideoNotification(data.lastVideo);
            }
        }

        // PDF Logic
        if (availableDates.length > 0) {
            const latestDate = availableDates[availableDates.length - 1];
            await loadPDF(paperMap[latestDate], latestDate);
            setupCalendar();
            prefetchRemainingPapers();
        }

        // Display Count
        if (data.visitorCount) {
            readerCount.innerText = data.visitorCount + " Readers Today";
        }
    } catch (e) {
        console.error("Fetch Error:", e);
    }
}

// ... Include normalizeVideoUrl, loadVideo, prefetchRemainingPapers, setupCalendar etc. from your full code below ...
// --- CONSOLIDATED TOUCH & NAVIGATION LOGIC ---
if (viewerContainer) {
    viewerContainer.addEventListener('scroll', scheduleSnippetHotspotSync, { passive: true });
    viewerContainer.addEventListener('touchend', (e) => {
        const touchEndX = e.changedTouches[0].clientX;
        const swipeDistance = startX - touchEndX; // startX is set in your touchstart
        const threshold = 100; // Minimum swipe distance

        // 1. Check if we should even try to turn the page
        if (Math.abs(swipeDistance) > threshold) {

            // 2. Logic for NOT Zoomed (Simple Swipe)
            if (currentScaleFactor <= 1) {
                if (swipeDistance > 0) {
                    if (pageNum < pdfDoc.numPages) renderPage(++pageNum);
                } else {
                    if (pageNum > 1) renderPage(--pageNum);
                }
            }
            // 3. Logic for ZOOMED (Edge Swipe)
            else {
                const edgeBuffer = 50;
                const isAtRightEdge = Math.ceil(viewerContainer.scrollLeft + viewerContainer.clientWidth) >= (viewerContainer.scrollWidth - edgeBuffer);
                const isAtLeftEdge = viewerContainer.scrollLeft <= edgeBuffer;

                if (swipeDistance > 150 && isAtRightEdge) { // Require a firmer swipe when zoomed
                    if (pageNum < pdfDoc.numPages) renderPage(++pageNum);
                } else if (swipeDistance < -150 && isAtLeftEdge) {
                    if (pageNum > 1) renderPage(--pageNum);
                }
            }
        }

        // Reset positions for next touch
        touchStartX = 0;
        startX = 0;
    }, { passive: true });
}

window.addEventListener('resize', scheduleSnippetHotspotSync);

// This links the top fixed bar to the zoomed PDF container
if (scrollWrapper) {
    scrollWrapper.addEventListener('scroll', function () {
        viewerContainer.scrollLeft = this.scrollLeft;
    });
}

async function loadPDF(fileId, date) {
    if (paperBadge) {
        paperBadge.innerText = date;
    }
    editionTitle.innerText = date + " Edition";
    currentEditionDate = date;

    const cacheKey = getCacheKey(date, fileId);
    let base64Data = await getFromDB(cacheKey);
    if (!base64Data) {
        try {
            const resp = await fetch(`${WEB_APP_URL}?fileId=${encodeURIComponent(fileId)}`);
            base64Data = await resp.text();
            await saveToDB(cacheKey, base64Data);
        } catch (err) {
            console.error("PDF download failed:", err);
            editionTitle.innerText = `${date} Edition - PDF failed to load`;
            return;
        }
    }

    try {
        const pdfData = atob(base64Data);
        const uint8Array = new Uint8Array(pdfData.length);
        for (let i = 0; i < pdfData.length; i++) uint8Array[i] = pdfData.charCodeAt(i);

        const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;
        pdfDoc = pdf;
        pageNum = 1;
        await loadSnippetMappingsForDate(date);
        await renderThumbnails();
        renderPage(1);
    } catch (err) {
        console.error("PDF render failed:", err);
        editionTitle.innerText = `${date} Edition - Invalid PDF data`;
    }
}

async function loadSnippetMappingsForDate(date) {
    try {
        const response = await fetch(`${WEB_APP_URL}?action=getSnippetMappings&editionDate=${encodeURIComponent(date)}`);
        if (!response.ok) {
            snippetMappings = [];
            renderSnippetHotspots();
            return;
        }
        const result = await response.json();
        snippetMappings = result && Array.isArray(result.mappings) ? result.mappings : [];
    } catch (error) {
        snippetMappings = [];
    }
    prefetchSnippetImagesForDate(date);
    scheduleSnippetHotspotSync();
    requestAnimationFrame(() => {
        requestAnimationFrame(scheduleSnippetHotspotSync);
    });
}

async function fetchSnippetPreviewUrl(imageUrl, imageFileId) {
    const cacheKey = imageFileId || imageUrl || "";
    if (!cacheKey) return "";
    if (snippetImageCache.has(cacheKey)) {
        return snippetImageCache.get(cacheKey);
    }

    let previewUrl = "";

    if (imageFileId) {
        try {
            const response = await fetch(`${WEB_APP_URL}?imageFileId=${encodeURIComponent(imageFileId)}`);
            if (response.ok) {
                const result = await response.json();
                if (result && result.status === "success" && result.dataUrl) {
                    previewUrl = result.dataUrl;
                }
            }
        } catch (error) {
        }
    }

    if (!previewUrl) {
        previewUrl = imageUrl || "";
    }

    if (previewUrl) {
        snippetImageCache.set(cacheKey, previewUrl);
    }

    return previewUrl;
}

function prefetchSnippetImagesForDate(date) {
    const itemsToPrefetch = snippetMappings.filter((item) => String(item.editionDate || "") === String(date));
    itemsToPrefetch.forEach((item) => {
        fetchSnippetPreviewUrl(item.imageUrl || "", item.imageFileId || "");
    });
}

function renderSnippetHotspots() {
    const layer = ensureSnippetLayer();
    if (!layer || !canvas) return;

    if (currentScaleFactor > 1) {
        layer.innerHTML = "";
        layer.style.display = "none";
        return;
    }

    const canvasRect = canvas.getBoundingClientRect();
    const viewerRect = viewerContainer.getBoundingClientRect();
    const left = canvasRect.left - viewerRect.left + viewerContainer.scrollLeft;
    const top = canvasRect.top - viewerRect.top + viewerContainer.scrollTop;

    layer.style.left = `${left}px`;
    layer.style.top = `${top}px`;
    layer.style.width = `${canvasRect.width}px`;
    layer.style.height = `${canvasRect.height}px`;

    const pageMappings = snippetMappings.filter((item) =>
        String(item.editionDate || "") === String(currentEditionDate) &&
        Number(item.pageNumber || 0) === Number(pageNum)
    );

    if (!pageMappings.length) {
        layer.innerHTML = "";
        layer.style.display = "none";
        return;
    }

    layer.style.display = "block";
    layer.innerHTML = "";

    pageMappings.forEach((item, index) => {
        const selection = item.selection || {};
        const title = item.title || `Snippet ${index + 1}`;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "paper-snippet-hotspot";
        button.style.left = `${Number(selection.x || 0) * 100}%`;
        button.style.top = `${Number(selection.y || 0) * 100}%`;
        button.style.width = `${Number(selection.width || 0) * 100}%`;
        button.style.height = `${Number(selection.height || 0) * 100}%`;
        button.setAttribute("aria-label", title);
        button.title = title;
        button.addEventListener("click", () => {
            button.classList.add("is-active");
            setTimeout(() => button.classList.remove("is-active"), 900);
            openSnippetPreview(item.title || "", item.imageUrl || "", item.imageFileId || "");
        });
        layer.appendChild(button);
    });
}

async function openSnippetPreview(title, imageUrl, imageFileId) {
    const previewUrl = await fetchSnippetPreviewUrl(imageUrl, imageFileId);

    if (!previewUrl) {
        alert("Snippet image is not available yet.");
        return;
    }

    if (window.Swal) {
        const popupTitle = "ನಮ್ಮ ನೆಲ";
        window.Swal.fire({
            title: popupTitle,
            html: `
                <div class="snippet-popup-wrap">
                    <div class="snippet-popup-media">
                        <img src="${previewUrl}" alt="${popupTitle}" class="snippet-popup-image">
                    </div>
                    <div class="snippet-popup-actions">
                        <button type="button" class="snippet-share-btn wa" data-action="whatsapp">WhatsApp</button>
                        <button type="button" class="snippet-share-btn fb" data-action="facebook">Facebook</button>
                        <button type="button" class="snippet-share-btn ig" data-action="instagram">Instagram</button>
                        <button type="button" class="snippet-share-btn tw" data-action="twitter">Twitter</button>
                        <button type="button" class="snippet-share-btn dl" data-action="download">Download</button>
                    </div>
                </div>
            `,
            width: 760,
            confirmButtonText: "Close"
            ,
            didOpen: (popup) => {
                attachSnippetPopupActions(popup, {
                    title: popupTitle,
                    previewUrl,
                    imageFileId
                });
            }
        });
        return;
    }

    window.open(previewUrl, "_blank");
}

function attachSnippetPopupActions(container, payload) {
    container.querySelectorAll(".snippet-share-btn").forEach((button) => {
        button.addEventListener("click", () => {
            const action = button.dataset.action;
            handleSnippetAction(action, payload);
        });
    });
}

async function fetchSnippetBlob(previewUrl, title) {
    const response = await fetch(previewUrl);
    if (!response.ok) {
        throw new Error("Could not load snippet image for sharing.");
    }

    const blob = await response.blob();
    return new File(
        [blob],
        `${slugifySnippetTitle(title || "snippet")}.png`,
        { type: blob.type || "image/png" }
    );
}

async function tryNativeSnippetShare(payload) {
    if (!navigator.share || !navigator.canShare || !payload.previewUrl) {
        return false;
    }

    const file = await fetchSnippetBlob(payload.previewUrl, payload.title || "snippet");
    if (!navigator.canShare({ files: [file] })) {
        return false;
    }

    await navigator.share({
        title: "ನಮ್ಮ ನೆಲ",
        text: `${payload.title || "Snippet"} - ${currentEditionDate || "Namma Nela"}`,
        files: [file]
    });

    return true;
}

function handleSnippetAction(action, payload) {
    const shareText = `${payload.title || "Snippet"} - ${currentEditionDate || "Namma Nela"}`;
    const shareUrl = payload.previewUrl || window.location.href;

    switch (action) {
        case "whatsapp":
            tryNativeSnippetShare(payload).then((shared) => {
                if (!shared) {
                    window.open(`https://wa.me/?text=${encodeURIComponent(`${shareText}\n${shareUrl}`)}`, "_blank", "noopener");
                }
            }).catch(() => {
                window.open(`https://wa.me/?text=${encodeURIComponent(`${shareText}\n${shareUrl}`)}`, "_blank", "noopener");
            });
            break;
        case "facebook":
            tryNativeSnippetShare(payload).then((shared) => {
                if (!shared) {
                    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`, "_blank", "noopener");
                }
            }).catch(() => {
                window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`, "_blank", "noopener");
            });
            break;
        case "twitter":
            tryNativeSnippetShare(payload).then((shared) => {
                if (!shared) {
                    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`, "_blank", "noopener");
                }
            }).catch(() => {
                window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`, "_blank", "noopener");
            });
            break;
        case "instagram":
            downloadSnippetImage(payload.previewUrl, `${slugifySnippetTitle(payload.title || "snippet")}.png`);
            window.open("https://www.instagram.com/", "_blank", "noopener");
            break;
        case "download":
            downloadSnippetImage(payload.previewUrl, `${slugifySnippetTitle(payload.title || "snippet")}.png`);
            break;
        default:
            break;
    }
}

function downloadSnippetImage(url, filename) {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
}

function slugifySnippetTitle(value) {
    return String(value || "snippet")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "snippet";
}

// --- SWIPE GESTURES ---
let startX = 0;
let endX = 0;


function handleSwipe() {
    const threshold = 100;
    if (!scrollWrapper || !pdfDoc) return;

    // Check edges using the custom scrollbar's position
    const isAtRightEdge = Math.ceil(scrollWrapper.scrollLeft + scrollWrapper.clientWidth) >= scrollWrapper.scrollWidth - 50;
    const isAtLeftEdge = scrollWrapper.scrollLeft <= 50;

    if (startX - endX > threshold) {
        if (currentScaleFactor > 1 && !isAtRightEdge) return; // Just panning
        if (pageNum < pdfDoc.numPages) renderPage(++pageNum);
    } else if (endX - startX > threshold) {
        if (currentScaleFactor > 1 && !isAtLeftEdge) return; // Just panning
        if (pageNum > 1) renderPage(--pageNum);
    }
}

function moveLeft() {
    if (!scrollWrapper) return;
    scrollWrapper.scrollBy({ left: -200, behavior: 'smooth' });
}

function moveRight() {
    if (!scrollWrapper) return;
    scrollWrapper.scrollBy({ left: 200, behavior: 'smooth' });
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    if (!appBootstrapped) {
        appBootstrapped = true;
        fetchData();
        setInterval(checkForUpdates, 20000);
    }
    setTimeout(() => {
        document.body.style.backgroundImage = 'none';
    }, 6000);
});

// Navigation UI
document.getElementById('fixedPrev').onclick = () => { if (pageNum > 1) renderPage(--pageNum); window.scrollTo(0, 0); };
document.getElementById('fixedNext').onclick = () => { if (pageNum < pdfDoc.numPages) renderPage(++pageNum); window.scrollTo(0, 0); };

// Helper UI Functions
function toggleMenu() { document.getElementById("sideMenu").classList.toggle("open"); }
function showPopup(id) {
    document.getElementById("popupBody").innerHTML = document.getElementById(id).innerHTML;
    document.getElementById("popupOverlay").style.display = "flex";
}
function closePopup() { document.getElementById("popupOverlay").style.display = "none"; }


// Add the missing prefetchRemainingPapers and normalizeVideoUrl functions below as per your previous versions...
const CACHE_PREFIX = "paper_"; // This must be defined before clearOldCache runs
// 2. CACHE HELPERS SECOND
function getFormattedDate(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    // Returns DD-MM-YYYY
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
}

function clearOldCache() {
    const validDates = [];
    for (let i = 0; i < 7; i++) {
        validDates.push(CACHE_PREFIX + getFormattedDate(i));
    }

    Object.keys(localStorage).forEach(key => {
        // Only delete our paper keys, leave login/session keys alone
        if (key.startsWith(CACHE_PREFIX) && !validDates.includes(key)) {
            localStorage.removeItem(key);
        }
    });
}

// --- CALENDAR & NAV LOGIC ---
function setupCalendar() {
    const calendarBtn = document.getElementById("calendarBtn");
    const datePicker = document.getElementById("datePicker");

    if (calendarBtn && datePicker) {
        // 1. Make the 📅 button open the actual date picker
        calendarBtn.onclick = () => {
            try {
                datePicker.showPicker(); // Modern browser way
            } catch (e) {
                datePicker.click(); // Fallback
            }
        };

        // 2. Listen for when a date is picked
        datePicker.addEventListener("change", (e) => {
            const rawValue = e.target.value; // Format: YYYY-MM-DD
            if (!rawValue) return;

            const selectedDate = rawValue.split("-").reverse().join("-");

            if (paperMap[selectedDate]) {
                loadPDF(paperMap[selectedDate], selectedDate);
                // Close mobile menu if open
                document.getElementById("sideMenu").classList.remove("open");
            } else {
                alert("ನಮ್ಮ ನೆಲ: No paper available for " + selectedDate);
            }
        });

        // 3. Restrict the calendar to only available dates
        if (availableDates.length > 0) {
            const sortedDates = [...availableDates].sort((a, b) => {
                return new Date(a.split("-").reverse().join("-")) - new Date(b.split("-").reverse().join("-"));
            });

            datePicker.min = sortedDates[0].split("-").reverse().join("-");
            datePicker.max = sortedDates[sortedDates.length - 1].split("-").reverse().join("-");
        }
    }
}

function showVideoNotification(videoId) {
    const notify = document.getElementById('videoNotify');
    const viewBtn = document.getElementById('viewVideoBtn');

    notify.style.display = 'flex';

    // 1. If user clicks "Watch Video"
    viewBtn.onclick = () => {
        // Navigate to video section (assuming your video div has id="video-section")
        document.getElementById('videoFrame').scrollIntoView({ behavior: 'smooth' });
        notify.style.display = 'none';
        // Remember that we've seen this video
        localStorage.setItem('lastSeenVideo', videoId);
    };

    // 2. If user clicks anywhere else (outside the card)
    notify.onclick = (e) => {
        if (e.target === notify) {
            notify.style.display = 'none';
            // Even if they dismiss it, we mark it as seen so it doesn't annoy them again
            localStorage.setItem('lastSeenVideo', videoId);
        }
    };
}

// --- NEW BACKGROUND PREFETCH FUNCTION ---
async function prefetchRemainingPapers() {
    console.log("⏳ Background Prefetch Started...");

    // We look at the available dates from the server
    // and try to cache the last 7 days if they aren't already there.
    const last7Days = availableDates.slice(-7).reverse();

    for (const date of last7Days) {
        const fileId = paperMap[date];
        const cacheKey = getCacheKey(date, fileId);
        const cached = await getFromDB(cacheKey);
        if (!cached && fileId) {
            console.log("☁️ Prefetching in background: " + date);
            try {
                const resp = await fetch(`${WEB_APP_URL}?fileId=${encodeURIComponent(fileId)}`);
                const base64Data = await resp.text();
                if (!base64Data.startsWith("Error")) {
                    await saveToDB(cacheKey, base64Data);
                    console.log("✅ Background Cached: " + date);
                }
            } catch (e) {
                console.warn("Prefetch failed for " + date);
            }
        }
    }
    console.log("🏁 Background Prefetch Complete.");
}

async function renderThumbnails() {
    if (!thumbnailSidebar || !pdfDoc) return;
    thumbnailSidebar.innerHTML = "";

    for (let i = 1; i <= pdfDoc.numPages; i++) {
        const thumb = document.createElement("img");
        thumb.classList.add("thumb-item");
        thumb.alt = `Page ${i} thumbnail`;
        thumb.loading = "lazy";
        thumb.decoding = "async";
        thumb.onclick = () => { pageNum = i; renderPage(i); };
        thumbnailSidebar.appendChild(thumb);

        try {
            const page = await pdfDoc.getPage(i);
            const viewport = page.getViewport({ scale: 0.2 });
            const tempCanvas = document.createElement("canvas");
            const thumbContext = tempCanvas.getContext("2d");

            tempCanvas.width = Math.ceil(viewport.width);
            tempCanvas.height = Math.ceil(viewport.height);

            await page.render({
                canvasContext: thumbContext,
                viewport
            }).promise;

            thumb.src = tempCanvas.toDataURL("image/png");
        } catch (error) {
            console.error(`Thumbnail render failed for page ${i}:`, error);
            thumb.classList.add("thumb-item-error");
        }
    }
}


function restrictCalendar() {
    const picker = document.getElementById("datePicker");
    picker.addEventListener("change", (e) => {
        const selected = e.target.value.split("-").reverse().join("-");
        if (paperMap[selected]) loadPDF(paperMap[selected], selected);
        else alert("No paper available for this date");
    });
}

// ATED VIDEO LOGIC SECTION ---
// Default fallback link
let videoSource = "https://www.youtube.com/embed/mLH7jdQ6ezc?autoplay=1&mute=1";

function normalizeVideoUrl(rawUrl) {
    if (!rawUrl) return "";
    const trimmed = rawUrl.trim();

    try {
        // 1. Handle NEW Live Links (e.g., youtube.com/live/ID)
        if (trimmed.includes("youtube.com/live/")) {
            const videoId = trimmed.split("/live/")[1].split("?")[0];
            return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1`;
        }

        // 2. Handle Short Links (youtu.be/ID)
        if (trimmed.includes("youtu.be/")) {
            const videoId = trimmed.split("/").pop().split("?")[0];
            return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1`;
        }

        // 3. Handle Standard Watch Links (v=ID)
        if (trimmed.includes("v=")) {
            const videoId = trimmed.split("v=")[1].split("&")[0];
            return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1`;
        }

        // 4. Handle existing Embed Links
        if (trimmed.includes("/embed/")) {
            return trimmed.includes("?") ? `${trimmed}&autoplay=1&mute=1` : `${trimmed}?autoplay=1&mute=1`;
        }

        return trimmed;
    } catch (error) {
        console.error("URL Normalization Error:", error);
        return "";
    }
}

function isDirectVideo(url) {
    return /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url);
}

// Apply source to video
function loadVideo() {
    const video = document.getElementById("myVideo");
    const frame = document.getElementById("videoFrame");
    if (!video || !frame) return;

    if (isDirectVideo(videoSource)) {
        frame.hidden = true;
        frame.src = "";
        video.hidden = false;
        video.src = videoSource;
        video.load();
        video.play().catch(() => { });
    } else {
        video.pause();
        video.hidden = true;
        video.removeAttribute("src");
        frame.hidden = false;
        // Apply the dynamic YouTube link
        frame.src = videoSource;
    }
}

// 🔄 Update video (Admin control)
function updateVideo() {
    const linkInput = document.getElementById("videoLink");
    const nextLink = linkInput ? normalizeVideoUrl(linkInput.value) : "";

    if (!nextLink) {
        alert("Please paste a valid YouTube or direct video link.");
        return;
    }

    videoSource = nextLink;
    loadVideo();
}

// --- AUTOMATIC REFRESH LOGIC ---
// 1. Create a function specifically for the "Silent Check"
async function checkForUpdates() {
    try {
        // Ensure the URL is fresh
        const response = await fetch(WEB_APP_URL);
        // If the response isn't OK (like a 404), stop here
        if (!response.ok) {
            console.warn("Update check skipped: Script URL might be old.");
            return;
        }

        const data = await response.json();

        if (data && data.lastVideo) {
            const lastSeenVideo = localStorage.getItem('lastSeenVideo');
            if (lastSeenVideo !== data.lastVideo) {
                const dynamicLink = normalizeVideoUrl(data.lastVideo);
                if (dynamicLink) {
                    videoSource = dynamicLink;
                    loadVideo();
                    showVideoNotification(data.lastVideo);
                }
            }
        }
    } catch (e) {
        // This prevents the "Unexpected token <" crash from showing in the console
        console.log("Check for updates: Waiting for valid server response...");
    }
}

function updateNavigationUI() {
    if (!pdfDoc) return;

    if (pageNum === 1) {
        fixedPrevButton.classList.add('nav-hidden');
    } else {
        fixedPrevButton.classList.remove('nav-hidden');
    }

    if (pageNum === pdfDoc.numPages) {
        fixedNextButton.classList.add('nav-hidden');
    } else {
        fixedNextButton.classList.remove('nav-hidden');
    }
}

window.addEventListener('scroll', () => {
    const scrollPosition = window.scrollY;
    const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
    const scrollPercent = (scrollPosition / totalHeight) * 100;

    if (scrollPercent > 65) {
        fixedPrevButton.classList.add('nav-hidden');
        fixedNextButton.classList.add('nav-hidden');
        if (scrollWrapper) {
            scrollWrapper.style.opacity = 0;
        }
        document.getElementById('zoombuttons').style.display = 'none';
    } else {
        updateNavigationUI();
        if (scrollWrapper) {
            scrollWrapper.style.opacity = 1;
        }
        document.getElementById('zoombuttons').style.display = 'flex';
    }
});

fixedPrevButton.onclick = () => {
    if (pageNum > 1) {
        pageNum--;
        renderPage(pageNum);
        updateNavigationUI();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
};

fixedNextButton.onclick = () => {
    if (pageNum < pdfDoc.numPages) {
        pageNum++;
        renderPage(pageNum);
        updateNavigationUI();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
};

// 6. Hook into existing render logic
const originalRenderPage = renderPage;
renderPage = function (num) {
    originalRenderPage(num);
    updateNavigationUI();
};

canvas.onclick = function (e) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / currentScaleFactor;
    const y = (e.clientY - rect.top) / currentScaleFactor;

    // Call the function in your new popup.js
    if (typeof showArticlePopup === 'function') {
        showArticlePopup(x, y, pageNum);
    }
};
