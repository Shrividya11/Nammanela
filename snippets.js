(() => {
    const WEB_APP_URL = window.WEB_APP_URL || "https://script.google.com/macros/s/AKfycby4GFEtETO4IsTZnup7cbTxJIa1kt0qh-ts485HjTVRkpXM0Vn_yqnYmvfJjG3dZl3XRQ/exec";
    const STORAGE_KEY = "nammanela_snippet_mappings";

    const state = {
        initialized: false,
        latestDate: "",
        latestFileId: "",
        pdfDoc: null,
        currentPage: 1,
        currentImage: "",
        isDrawing: false,
        selection: null,
        activePointerId: null,
        canvasBounds: null
    };

    const els = {};

    function afterNextPaint() {
        return new Promise((resolve) => {
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(resolve);
            });
        });
    }

    function cacheElements() {
        els.section = document.getElementById("snippet-section");
        els.stage = document.getElementById("snippetPreviewStage");
        els.canvas = document.getElementById("snippetPdfCanvas");
        els.markingLayer = document.getElementById("snippetMarkingLayer");
        els.selection = document.getElementById("snippetSelection");
        els.emptyState = document.getElementById("snippetEmptyState");
        els.status = document.getElementById("snippetStatus");
        els.pageNumber = document.getElementById("snippetPageNumber");
        els.imageInput = document.getElementById("snippetImage");
        els.clearBtn = document.getElementById("clearSnippetSelection");
        els.saveBtn = document.getElementById("saveSnippetMapping");
        els.savedGrid = document.getElementById("snippetSavedGrid");
        els.savedSummary = document.getElementById("snippetSavedSummary");
        els.ctx = els.canvas ? els.canvas.getContext("2d") : null;
    }

    function setStatus(message, isError = false) {
        if (!els.status) return;
        els.status.textContent = message;
        els.status.style.color = isError ? "#d14343" : "#5c6f92";
    }

    function toggleEmptyState(show, message) {
        if (!els.emptyState) return;
        els.emptyState.textContent = message || "Upload an edition first. The latest paper preview will appear here for snippet mapping.";
        els.emptyState.classList.toggle("hidden", !show);
        if (els.markingLayer) {
            els.markingLayer.classList.toggle("hidden", show);
        }
    }

    function ensurePdfWorker() {
        if (window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.14.305/pdf.worker.min.js";
        }
    }

    async function fetchLatestPaper() {
        const response = await fetch(WEB_APP_URL);
        if (!response.ok) {
            throw new Error("Could not reach the paper service.");
        }

        const data = await response.json();
        const availableDates = Array.isArray(data.availableDates) ? data.availableDates : [];
        const paperMap = data.paperMap || {};

        if (!availableDates.length) {
            throw new Error("No uploaded editions found yet.");
        }

        const latestDate = availableDates[availableDates.length - 1];
        const latestFileId = paperMap[latestDate];

        if (!latestFileId) {
            throw new Error("The latest edition is missing its preview file.");
        }

        state.latestDate = latestDate;
        state.latestFileId = latestFileId;
    }

    async function loadPdfBase64(fileId) {
        const response = await fetch(`${WEB_APP_URL}?fileId=${encodeURIComponent(fileId)}`);
        if (!response.ok) {
            throw new Error("Could not load the latest PDF preview.");
        }

        const base64 = await response.text();
        if (!base64 || base64.startsWith("Error")) {
            throw new Error("The latest PDF preview is not available.");
        }

        const pdfData = atob(base64);
        const bytes = new Uint8Array(pdfData.length);
        for (let i = 0; i < pdfData.length; i++) {
            bytes[i] = pdfData.charCodeAt(i);
        }
        return bytes;
    }

    async function renderPage(pageNumber) {
        if (!state.pdfDoc || !els.canvas || !els.ctx) return;

        const safePage = Math.min(Math.max(Number(pageNumber) || 1, 1), state.pdfDoc.numPages);
        state.currentPage = safePage;
        els.pageNumber.value = safePage;

        const page = await state.pdfDoc.getPage(safePage);
        const viewport = page.getViewport({ scale: 1.45 });
        els.canvas.width = viewport.width;
        els.canvas.height = viewport.height;
        await page.render({ canvasContext: els.ctx, viewport }).promise;

        els.canvas.style.width = `${viewport.width}px`;
        els.canvas.style.height = `${viewport.height}px`;
        syncMarkingLayer();
        toggleEmptyState(false);
        clearSelection();
        setStatus(`Showing ${state.latestDate} edition, page ${safePage}. Drag on the preview to map the snippet area.`);
    }

    async function refreshLayout() {
        if (!els.section || !els.canvas || !state.pdfDoc) return;
        await afterNextPaint();
        syncMarkingLayer();
    }

    function syncMarkingLayer() {
        if (!els.markingLayer || !els.canvas || !els.stage) return;
        const stageRect = els.stage.getBoundingClientRect();
        const canvasRect = els.canvas.getBoundingClientRect();
        const left = canvasRect.left - stageRect.left + els.stage.scrollLeft;
        const top = canvasRect.top - stageRect.top + els.stage.scrollTop;
        state.canvasBounds = {
            left,
            top,
            width: canvasRect.width,
            height: canvasRect.height
        };

        els.markingLayer.style.left = `${left}px`;
        els.markingLayer.style.top = `${top}px`;
        els.markingLayer.style.width = `${canvasRect.width}px`;
        els.markingLayer.style.height = `${canvasRect.height}px`;

        if (els.selection && state.selection) {
            els.selection.style.left = `${state.selection.left}px`;
            els.selection.style.top = `${state.selection.top}px`;
        }
    }

    function getRelativePoint(clientX, clientY) {
        const rect = els.canvas.getBoundingClientRect();
        const isInside =
            clientX >= rect.left &&
            clientX <= rect.right &&
            clientY >= rect.top &&
            clientY <= rect.bottom;
        const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
        const y = Math.max(0, Math.min(clientY - rect.top, rect.height));
        return { x, y, rect, isInside };
    }

    function updateSelectionBox(startX, startY, currentX, currentY) {
        const left = Math.min(startX, currentX);
        const top = Math.min(startY, currentY);
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);
        state.selection = {
            startX,
            startY,
            left,
            top,
            width,
            height
        };

        els.selection.style.left = `${left}px`;
        els.selection.style.top = `${top}px`;
        els.selection.style.width = `${width}px`;
        els.selection.style.height = `${height}px`;
        els.selection.classList.toggle("hidden", width < 8 || height < 8);

        if (state.currentImage) {
            els.selection.style.backgroundImage = `url(${state.currentImage})`;
        } else {
            els.selection.style.backgroundImage = "none";
        }
    }

    function clearSelection() {
        state.selection = null;
        if (!els.selection) return;
        els.selection.classList.add("hidden");
        els.selection.style.width = "0";
        els.selection.style.height = "0";
        els.selection.style.backgroundImage = state.currentImage ? `url(${state.currentImage})` : "none";
    }

    function handlePointerDown(event) {
        if (!state.pdfDoc || !els.canvas || !els.stage) return;
        if (event.button !== undefined && event.button !== 0) return;

        const point = getRelativePoint(event.clientX, event.clientY);
        if (!point.isInside) return;

        event.preventDefault();
        state.isDrawing = true;
        state.activePointerId = event.pointerId;
        els.stage.classList.add("is-drawing");
        if (typeof els.markingLayer.setPointerCapture === "function") {
            els.markingLayer.setPointerCapture(event.pointerId);
        }
        state.selection = {
            startX: point.x,
            startY: point.y,
            left: point.x,
            top: point.y,
            width: 0,
            height: 0
        };
        updateSelectionBox(point.x, point.y, point.x, point.y);
    }

    function handlePointerMove(event) {
        if (state.activePointerId !== null && event.pointerId !== state.activePointerId) return;
        if (!state.isDrawing || !state.selection) return;
        event.preventDefault();
        const point = getRelativePoint(event.clientX, event.clientY);
        updateSelectionBox(state.selection.startX, state.selection.startY, point.x, point.y);
    }

    function handlePointerUp(event) {
        if (state.activePointerId !== null && event.pointerId !== state.activePointerId) return;
        if (!state.isDrawing) return;
        if (typeof els.markingLayer.releasePointerCapture === "function" && state.activePointerId !== null) {
            try {
                els.markingLayer.releasePointerCapture(state.activePointerId);
            } catch (error) {
            }
        }
        state.isDrawing = false;
        state.activePointerId = null;
        els.stage.classList.remove("is-drawing");

        if (!state.selection || state.selection.width < 8 || state.selection.height < 8) {
            clearSelection();
            setStatus("Drag a larger area on the page to create a snippet mapping.");
            return;
        }

        setStatus("Selection ready. You can save this snippet mapping now.");
    }

    function handleImageUpload(event) {
        const file = event.target.files && event.target.files[0];
        if (!file) {
            state.currentImage = "";
            if (els.selection) {
                els.selection.style.backgroundImage = "none";
            }
            return;
        }

        const reader = new FileReader();
        reader.onload = (loadEvent) => {
            state.currentImage = loadEvent.target.result;
            if (els.selection && state.selection) {
                els.selection.style.backgroundImage = `url(${state.currentImage})`;
            }
            setStatus("Snippet image loaded. Drag on the paper preview to map its placement.");
        };
        reader.readAsDataURL(file);
    }

    function getSavedMappings() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        } catch (error) {
            return [];
        }
    }

    function saveMappings(mappings) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(mappings));
    }

    function formatCreatedAt(value) {
        if (!value) return "Unknown";
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return String(value);
        const day = String(parsed.getDate()).padStart(2, "0");
        const month = String(parsed.getMonth() + 1).padStart(2, "0");
        const year = parsed.getFullYear();
        return `${day}/${month}/${year}`;
    }

    async function fetchRemoteMappings() {
        try {
            const response = await fetch(`${WEB_APP_URL}?action=getSnippetMappings`);
            if (!response.ok) return [];
            const result = await response.json();
            return result && Array.isArray(result.mappings) ? result.mappings : [];
        } catch (error) {
            return [];
        }
    }

    function normalizeMapping(mapping) {
        return {
            id: mapping.id,
            title: mapping.title || "",
            pageNumber: Number(mapping.pageNumber || 1),
            editionDate: mapping.editionDate || "",
            imageUrl: mapping.imageUrl || "",
            imageFileId: mapping.imageFileId || "",
            imageData: mapping.imageData || "",
            imageName: mapping.imageName || "",
            createdAt: mapping.createdAt || "",
            selection: mapping.selection || {}
        };
    }

    async function fetchSnippetImageSource(mapping) {
        if (!mapping) return "";

        if (mapping.imageData) {
            return mapping.imageData;
        }

        if (mapping.imageFileId) {
            try {
                const response = await fetch(`${WEB_APP_URL}?imageFileId=${encodeURIComponent(mapping.imageFileId)}`);
                if (response.ok) {
                    const result = await response.json();
                    if (result && result.status === "success" && result.dataUrl) {
                        return result.dataUrl;
                    }
                }
            } catch (error) {
                // fallback to imageUrl
            }
        }

        return mapping.imageUrl || "";
    }

    async function renderSavedMappings() {
        if (!els.savedGrid || !els.savedSummary) return;

        const localMappings = getSavedMappings().map(normalizeMapping);
        const remoteMappings = (await fetchRemoteMappings()).map(normalizeMapping);
        const mapById = new Map();

        [...remoteMappings, ...localMappings].forEach((mapping) => {
            const key = String(mapping.id || "");
            if (!key) return;

            const existing = mapById.get(key);

            if (!existing) {
                mapById.set(key, mapping);
                return;
            }

            // Keep local mapping when it has image data and remote does not.
            if (!existing.imageData && mapping.imageData) {
                mapById.set(key, mapping);
                return;
            }

            // Merge fallback fields if needed.
            if (!existing.imageUrl && mapping.imageUrl) {
                mapById.set(key, { ...existing, imageUrl: mapping.imageUrl });
            }
            if (!existing.imageFileId && mapping.imageFileId) {
                mapById.set(key, { ...mapById.get(key), imageFileId: mapping.imageFileId });
            }
        });

        const merged = Array.from(mapById.values());

        merged.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));

        els.savedSummary.textContent = merged.length
            ? `${merged.length} snippet${merged.length === 1 ? "" : "s"} saved`
            : "No snippets saved yet.";

        if (!merged.length) {
            els.savedGrid.innerHTML = `<div class="snippet-saved-empty">Save a snippet mapping and it will appear here.</div>`;
            return;
        }

        els.savedGrid.innerHTML = merged.map((mapping) => {
            const initialImage = mapping.imageData || mapping.imageUrl || "";
            return `
            <article class="snippet-saved-item">
                ${initialImage ? `<img src="${initialImage}" alt="${mapping.title}">` : ""}
                ${mapping.title ? `<h4>${mapping.title}</h4>` : ""}
                <div class="snippet-saved-meta">
                    <span>Page ${mapping.pageNumber}</span>
                    <span>Date: ${mapping.editionDate || "-"}</span>
                    <span>Created: ${formatCreatedAt(mapping.createdAt)}</span>
                </div>
                <button type="button" class="snippet-delete-btn" data-snippet-id="${mapping.id}">Delete</button>
            </article>
        `;
        }).join("");

        els.savedGrid.querySelectorAll(".snippet-delete-btn").forEach((button) => {
            button.addEventListener("click", () => deleteSnippet(button.dataset.snippetId));
        });

        merged.forEach(async (mapping, index) => {
            const card = els.savedGrid.children[index];
            if (!card) return;

            const img = card.querySelector("img");
            if (!img || mapping.imageData) return;

            const source = await fetchSnippetImageSource(mapping);
            if (source) {
                img.src = source;
            }
        });
    }

    async function deleteSnippet(id) {
        if (!id) return;
        if (!window.confirm("Delete this snippet mapping?")) return;

        const localMappings = getSavedMappings().filter((item) => String(item.id) !== String(id));
        saveMappings(localMappings);

        try {
            await fetch(WEB_APP_URL, {
                method: "POST",
                mode: "cors",
                headers: { "Content-Type": "text/plain" },
                body: JSON.stringify({ action: "deleteSnippetMapping", id })
            });
        } catch (error) {
        }

        await renderSavedMappings();
        setStatus("Snippet mapping deleted.");
    }

    async function saveSnippet() {
        if (!state.selection) {
            notify("Please draw a selection on the paper preview.", "warning");
            return;
        }

        const rect = els.canvas.getBoundingClientRect();
        const mapping = {
            id: Date.now(),
            title: "",
            pageNumber: state.currentPage,
            editionDate: state.latestDate,
            imageName: els.imageInput.files[0] ? els.imageInput.files[0].name : "",
            imageData: state.currentImage,
            selection: {
                x: Number((state.selection.left / rect.width).toFixed(4)),
                y: Number((state.selection.top / rect.height).toFixed(4)),
                width: Number((state.selection.width / rect.width).toFixed(4)),
                height: Number((state.selection.height / rect.height).toFixed(4))
            },
            createdAt: new Date().toISOString()
        };

        const mappings = getSavedMappings();
        mappings.push(mapping);
        saveMappings(mappings);

        try {
            const response = await fetch(WEB_APP_URL, {
                method: "POST",
                mode: "cors",
                headers: { "Content-Type": "text/plain" },
                body: JSON.stringify({ action: "saveSnippetMapping", mapping })
            });
            const result = await response.json();
            if (result && result.status === "success") {
                notify("Snippet mapping saved.", "success");
                if (result.imageUrl) {
                    mapping.imageUrl = result.imageUrl;
                    const updatedMappings = getSavedMappings().map((item) =>
                        String(item.id) === String(mapping.id) ? { ...item, imageUrl: result.imageUrl } : item
                    );
                    saveMappings(updatedMappings);
                }
            } else {
                notify("Snippet mapping saved locally. Backend save is not available yet.", "success");
            }
        } catch (error) {
            notify("Snippet mapping saved locally. Backend save is not available yet.", "success");
        }

        if (els.imageInput) {
            els.imageInput.value = "";
        }
        state.currentImage = "";
        clearSelection();
        await renderSavedMappings();
        setStatus("Snippet saved. Select another area to continue mapping.");
    }

    function notify(message, icon) {
        if (window.Swal) {
            window.Swal.fire({
                title: icon === "success" ? "Success" : "Notice",
                text: message,
                icon
            });
        } else {
            alert(message);
        }
    }

    async function initialize() {
        cacheElements();
        if (!els.section || !els.canvas || !els.stage || !els.markingLayer) return;
        if (state.initialized) return;

        ensurePdfWorker();

        els.markingLayer.appendChild(els.selection);
        els.markingLayer.addEventListener("pointerdown", handlePointerDown);
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);
        els.stage.addEventListener("scroll", syncMarkingLayer);
        window.addEventListener("resize", syncMarkingLayer);
        els.imageInput.addEventListener("change", handleImageUpload);
        els.pageNumber.addEventListener("change", () => renderPage(els.pageNumber.value));
        els.clearBtn.addEventListener("click", () => {
            clearSelection();
            setStatus("Selection cleared. Drag on the paper preview to create a new one.");
        });
        els.saveBtn.addEventListener("click", saveSnippet);

        state.initialized = true;
        await renderSavedMappings();
        await ensureLoaded();
    }

    async function ensureLoaded() {
        cacheElements();
        if (!els.section || !window.pdfjsLib) {
            return;
        }

        if (state.pdfDoc) {
            await afterNextPaint();
            await renderPage(state.currentPage || els.pageNumber.value || 1);
            return;
        }

        setStatus("Loading the latest paper preview for snippet mapping...");
        toggleEmptyState(true, "Loading the latest paper preview...");

        try {
            await fetchLatestPaper();
            const pdfBytes = await loadPdfBase64(state.latestFileId);
            state.pdfDoc = await window.pdfjsLib.getDocument({ data: pdfBytes }).promise;
            els.pageNumber.max = state.pdfDoc.numPages;
            await afterNextPaint();
            await renderPage(els.pageNumber.value || 1);
            await renderSavedMappings();
        } catch (error) {
            toggleEmptyState(true, error.message || "Preview could not be loaded.");
            setStatus(error.message || "Preview could not be loaded.", true);
        }
    }

    document.addEventListener("DOMContentLoaded", initialize);

    window.SnippetManager = {
        ensureLoaded,
        refreshLayout,
        clearSelection
    };
})();
