(() => {
    const viewerContainer = document.querySelector(".viewer-container");
    const canvas = document.getElementById("pdf-render");
    const snipToggle = document.getElementById("snipToggle");

    if (!viewerContainer || !canvas || !snipToggle) {
        return;
    }

    const overlay = document.createElement("div");
    overlay.className = "snip-tool-overlay";
    overlay.innerHTML = `
        <div class="snip-tool-shade"></div>
        <div class="snip-tool-selection"></div>
    `;
    viewerContainer.appendChild(overlay);

    const shade = overlay.querySelector(".snip-tool-shade");
    const selection = overlay.querySelector(".snip-tool-selection");

    let isSnipMode = false;
    let isDragging = false;
    let dragStart = null;
    let activePointerId = null;

    function getViewerTouchAction() {
        return viewerContainer.scrollWidth > viewerContainer.clientWidth ? "pan-x pan-y" : "pan-y";
    }

    function syncOverlayBounds() {
        const canvasRect = canvas.getBoundingClientRect();
        const viewerRect = viewerContainer.getBoundingClientRect();
        overlay.style.left = `${canvasRect.left - viewerRect.left + viewerContainer.scrollLeft}px`;
        overlay.style.top = `${canvasRect.top - viewerRect.top + viewerContainer.scrollTop}px`;
        overlay.style.width = `${canvasRect.width}px`;
        overlay.style.height = `${canvasRect.height}px`;
    }

    function setSnipMode(active) {
        isSnipMode = active;
        isDragging = false;
        dragStart = null;
        activePointerId = null;
        syncOverlayBounds();
        overlay.classList.toggle("is-active", active);
        overlay.classList.remove("is-dragging");
        selection.style.width = "0px";
        selection.style.height = "0px";
        snipToggle.classList.toggle("is-active", active);
        viewerContainer.classList.toggle("snip-mode", active);
        overlay.style.touchAction = active ? "none" : "";
        viewerContainer.style.touchAction = active ? "none" : getViewerTouchAction();
    }

    function getCanvasRect() {
        return canvas.getBoundingClientRect();
    }

    function clampPoint(clientX, clientY) {
        const rect = getCanvasRect();
        return {
            x: Math.max(rect.left, Math.min(clientX, rect.right)),
            y: Math.max(rect.top, Math.min(clientY, rect.bottom)),
            rect
        };
    }

    function updateSelection(clientX, clientY) {
        if (!dragStart) return;

        const point = clampPoint(clientX, clientY);
        const left = Math.min(dragStart.x, point.x);
        const top = Math.min(dragStart.y, point.y);
        const width = Math.abs(point.x - dragStart.x);
        const height = Math.abs(point.y - dragStart.y);

        selection.style.left = `${left - point.rect.left}px`;
        selection.style.top = `${top - point.rect.top}px`;
        selection.style.width = `${width}px`;
        selection.style.height = `${height}px`;

        if (shade) {
            shade.style.setProperty("--snip-left", `${left - point.rect.left}px`);
            shade.style.setProperty("--snip-top", `${top - point.rect.top}px`);
            shade.style.setProperty("--snip-width", `${width}px`);
            shade.style.setProperty("--snip-height", `${height}px`);
        }
    }

    function toSourceRect() {
        const rect = getCanvasRect();
        const left = parseFloat(selection.style.left || "0");
        const top = parseFloat(selection.style.top || "0");
        const width = parseFloat(selection.style.width || "0");
        const height = parseFloat(selection.style.height || "0");

        if (width < 8 || height < 8) {
            return null;
        }

        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        return {
            sx: Math.round(left * scaleX),
            sy: Math.round(top * scaleY),
            sw: Math.round(width * scaleX),
            sh: Math.round(height * scaleY)
        };
    }

    function captureSelection() {
        const source = toSourceRect();
        if (!source) {
            return;
        }

        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = source.sw;
        tempCanvas.height = source.sh;
        const tempCtx = tempCanvas.getContext("2d");

        tempCtx.drawImage(
            canvas,
            source.sx,
            source.sy,
            source.sw,
            source.sh,
            0,
            0,
            source.sw,
            source.sh
        );

        tempCanvas.toBlob((blob) => {
            if (!blob) {
                return;
            }

            showSnipResult(blob);
        }, "image/png");
    }

    function downloadBlob(blob) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `snip-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    async function tryNativeImageShare(blob) {
        if (!navigator.share || !navigator.canShare) {
            return false;
        }

        const file = new File([blob], `snip-${Date.now()}.png`, { type: "image/png" });
        if (!navigator.canShare({ files: [file] })) {
            return false;
        }

        await navigator.share({
            title: "Namma Nela clipping",
            text: "Namma Nela clipping",
            files: [file]
        });

        return true;
    }

    function openUrl(url) {
        const link = document.createElement("a");
        link.href = url;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
    }

    function openAppOrWeb(appUrl, webUrl) {
        const start = Date.now();
        const fallback = window.setTimeout(() => {
            if (Date.now() - start < 1800) {
                window.open(webUrl, "_blank", "noopener");
            }
        }, 900);

        const clear = () => {
            window.clearTimeout(fallback);
            document.removeEventListener("visibilitychange", clear);
            window.removeEventListener("pagehide", clear);
            window.removeEventListener("blur", clear);
        };

        document.addEventListener("visibilitychange", clear, { once: true });
        window.addEventListener("pagehide", clear, { once: true });
        window.addEventListener("blur", clear, { once: true });
        openUrl(appUrl);
    }

    async function shareSnip(action, blob) {
        const shareText = "Namma Nela clipping";
        const shareUrl = window.location.href;

        if (action === "download") {
            downloadBlob(blob);
            return;
        }

        switch (action) {
            case "whatsapp":
                if (await tryNativeImageShare(blob)) return;
                openAppOrWeb(
                    `whatsapp://send?text=${encodeURIComponent(shareText)}`,
                    `https://wa.me/?text=${encodeURIComponent(`${shareText}\n${shareUrl}`)}`
                );
                break;
            case "facebook":
                if (await tryNativeImageShare(blob)) return;
                openAppOrWeb(
                    `fb://facewebmodal/f?href=${encodeURIComponent(shareUrl)}`,
                    `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`
                );
                break;
            case "instagram":
                downloadBlob(blob);
                openAppOrWeb(
                    "instagram://camera",
                    "https://www.instagram.com/"
                );
                break;
            case "twitter":
                if (await tryNativeImageShare(blob)) return;
                openAppOrWeb(
                    `twitter://post?message=${encodeURIComponent(shareText)}`,
                    `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`
                );
                break;
            default:
                break;
        }
    }

    function showSnipResult(blob) {
        const objectUrl = URL.createObjectURL(blob);

        if (window.Swal) {
            window.Swal.fire({
                title: "ನಮ್ಮ ನೆಲ",
                html: `
                    <div class="snip-result-popup">
                        <img src="${objectUrl}" alt="Snipped region" class="snip-result-image">
                        <div class="snip-result-actions">
                            <button type="button" class="snippet-share-btn wa" data-action="whatsapp">WhatsApp</button>
                            <button type="button" class="snippet-share-btn fb" data-action="facebook">Facebook</button>
                            <button type="button" class="snippet-share-btn ig" data-action="instagram">Instagram</button>
                            <button type="button" class="snippet-share-btn tw" data-action="twitter">Twitter</button>
                            <button type="button" class="snippet-share-btn dl" data-action="download">Download</button>
                        </div>
                    </div>
                `,
                showConfirmButton: true,
                confirmButtonText: "Close",
                customClass: {
                    popup: "clean-article-popup"
                },
                didOpen: (popup) => {
                    popup.querySelectorAll(".snippet-share-btn").forEach((button) => {
                        button.addEventListener("click", async () => {
                            try {
                                await shareSnip(button.dataset.action, blob);
                            } catch (error) {
                                alert(error.message || "Sharing failed.");
                            }
                        });
                    });
                }
            }).then((result) => {
                URL.revokeObjectURL(objectUrl);
            }).catch(() => {
                URL.revokeObjectURL(objectUrl);
            });
            return;
        }

        shareSnip("whatsapp", blob);
    }

    function handlePointerDown(event) {
        if (!isSnipMode) {
            return;
        }

        if (event.pointerType === "mouse" && event.button !== 0) {
            return;
        }

        const rect = getCanvasRect();
        if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
        ) {
            return;
        }

        event.preventDefault();
        isDragging = true;
        activePointerId = event.pointerId;
        overlay.classList.add("is-dragging");
        dragStart = clampPoint(event.clientX, event.clientY);
        if (typeof overlay.setPointerCapture === "function") {
            try {
                overlay.setPointerCapture(event.pointerId);
            } catch (error) {
            }
        }
        updateSelection(event.clientX, event.clientY);
    }

    function handlePointerMove(event) {
        if (!isSnipMode || !isDragging) {
            return;
        }

        if (activePointerId !== null && event.pointerId !== activePointerId) {
            return;
        }

        event.preventDefault();
        updateSelection(event.clientX, event.clientY);
    }

    function handlePointerUp(event) {
        if (!isSnipMode || !isDragging) {
            return;
        }

        if (activePointerId !== null && event.pointerId !== activePointerId) {
            return;
        }

        event.preventDefault();
        isDragging = false;
        if (typeof overlay.releasePointerCapture === "function" && activePointerId !== null) {
            try {
                overlay.releasePointerCapture(activePointerId);
            } catch (error) {
            }
        }
        activePointerId = null;
        overlay.classList.remove("is-dragging");
        updateSelection(event.clientX, event.clientY);
        captureSelection();
        setSnipMode(false);
    }

    snipToggle.addEventListener("click", () => {
        setSnipMode(!isSnipMode);
    });

    overlay.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerUp);

    viewerContainer.addEventListener("scroll", () => {
        if (!isSnipMode || !dragStart) return;
        setSnipMode(false);
    }, { passive: true });

    window.addEventListener("resize", syncOverlayBounds);

    window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && isSnipMode) {
            setSnipMode(false);
        }
    });
})();
