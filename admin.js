const WEB_APP_URL = "https://script.google.com/macros/s/AKfycby4GFEtETO4IsTZnup7cbTxJIa1kt0qh-ts485HjTVRkpXM0Vn_yqnYmvfJjG3dZl3XRQ/exec";
window.WEB_APP_URL = WEB_APP_URL;
const submtt = document.getElementById("submtt");
const $ = (id) => document.getElementById(id);

// Global cache for popups
let statsCache = [];
let editionsCache = [];

function buildFormBody(payload) {
    const formBody = new URLSearchParams();
    Object.entries(payload).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        formBody.append(key, typeof value === "string" ? value : JSON.stringify(value));
    });
    return formBody.toString();
}

async function postToBackend(payload) {
    const jsonResponse = await fetch(WEB_APP_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(payload)
    });

    const jsonResult = await jsonResponse.json();
    const backendMessage = (jsonResult.msg || jsonResult.error || "").toLowerCase();
    const shouldRetryAsForm =
        jsonResult.status !== "success" &&
        (backendMessage.includes("unsupported action") || backendMessage.includes("unknown action"));

    if (!shouldRetryAsForm) {
        return jsonResult;
    }

    const formResponse = await fetch(WEB_APP_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: buildFormBody(payload)
    });

    return formResponse.json();
}

// --- 1. CORE DATA FETCHING ---
async function loadDashboardData() {
    try {
        const response = await fetch(`${WEB_APP_URL}?adminCall=true`);
        const data = await response.json();

        if (data && data.status === "success") {
            $('stat-total-editions').innerText = data.totalEditions || 0;
            $('stat-today-editions').innerText = data.todayEditions || 0;
            $('stat-live-stories').innerText = data.lastVideo ? 1 : 0;
            $('stat-total-views').innerText = data.totalViews ? data.totalViews.toLocaleString() : 0;
            editionsCache = data.fullList || [];
            statsCache = data.dailyBreakdown || [];
            if (data.visitorCount !== undefined) {
                statsCache.unshift({ date: "Today (Live)", count: data.visitorCount });
            }
        } else if (data && data.error) {
            console.error("Script Error:", data.error);
        }
    } catch (error) {
        console.error("Dashboard Load Error:", error);
    }
}

// --- 2. AUTH & UPLOAD LOGIC ---
async function handleLogin() {
    const emailValue = $("email").value.trim();
    const passwordValue = $("password").value.trim();

    if (!emailValue || !passwordValue) {
        alert("Please enter both Email and Password");
        return;
    }
    submtt.style.display = 'none';
    try {
        const result = await postToBackend({ action: "login", email: emailValue, password: passwordValue });
        if (result.status === "success") {
            sessionStorage.setItem("isLoggedIn", "true");
            showForm();
        } else {
            alert("Login Failed: " + (result.msg || result.error || "Unexpected login response from server."));
            submtt.style.display = 'inline-block';
        }
    } catch (error) {
        console.error("Login request error:", error);
        alert("Connection error.");
        submtt.style.display = 'inline-block';
    }
}


async function handleUpload() {
    const ytLink = $("ytLink").value;
    const fileInput = $("pdfFile");
    const submt = $("submt");

    if (!ytLink && !fileInput.files[0]) {
        alert("Please provide a YouTube link or a PDF file.");
        return;
    }

    let payload = { action: "submitForm", youtubeLink: ytLink };
    submt.style.display = 'none';

    if (fileInput.files[0]) {
        const file = fileInput.files[0];
        const reader = new FileReader();
        reader.onload = async (e) => {
            payload.pdfData = e.target.result.split(",")[1];
            payload.pdfName = file.name;
            sendData(payload);
        };
        reader.readAsDataURL(file);
    } else {
        sendData(payload);
    }
}

async function sendData(payload) {
    try {
        const result = await postToBackend(payload);
        if (result.status === "success") {
            alert("Uploaded successfully!");
            location.reload();
        }
    } catch (err) {
        alert("Upload failed: " + err.message);
    }
}

// --- 3. POPUP MODALS ---

// A. Manage Editions Popup (Total / Today Cards)
function openEditionsPopup() {
    if (editionsCache.length === 0) {
        Swal.fire("Info", "No editions found to manage.", "info");
        return;
    }

    let html = `<div style="max-height: 400px; overflow-y: auto;">`;
    editionsCache.slice().reverse().forEach(item => {
        html += `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #eee;">
                <span style="font-size:14px;"><i class="fa-solid fa-file-pdf" style="color:#ff4d4d;"></i> ${item.name}</span>
                <button onclick="deleteEdition('${item.date}')" style="background:none; border:none; color:#e74c3c; cursor:pointer; font-size:18px;">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        `;
    });
    html += `</div>`;

    Swal.fire({
        title: 'Manage Editions',
        html: html,
        width: '500px',
        showConfirmButton: false,
        showCloseButton: true
    });
}

// B. Visitor Stats Popup (Total Views Card)
function showViewsPopup() {
    if (statsCache.length === 0) {
        Swal.fire("Info", "No visitor data available yet.", "info");
        return;
    }

    let html = `
        <div style="max-height: 400px; overflow-y: auto;">
            <table style="width: 100%; border-collapse: collapse; text-align: left;">
                <thead style="position: sticky; top: 0; background: #f4f4f4;">
                    <tr><th style="padding: 12px; border-bottom: 2px solid #ddd;">Date</th><th style="padding: 12px; border-bottom: 2px solid #ddd;">Readers</th></tr>
                </thead>
                <tbody>
    `;
    statsCache.forEach(item => {
        html += `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding: 10px;">${item.date}</td>
                <td style="padding: 10px; font-weight: bold; color: #2c3e50;">${item.count}</td>
            </tr>
        `;
    });
    html += `</tbody></table></div>`;

    Swal.fire({
        title: 'Visitor Analytics',
        html: html,
        width: '400px',
        confirmButtonText: 'Close',
        confirmButtonColor: '#3498db'
    });
}

// Delete Logic
async function deleteEdition(dateString) {
    if (!confirm(`Are you sure you want to delete the edition for ${dateString}?`)) return;

    try {
        const result = await postToBackend({ action: "deleteEdition", date: dateString });
        if (result.status === "success") {
            Swal.fire("Deleted!", "The edition has been removed.", "success").then(() => location.reload());
        }
    } catch (e) { alert("Error connecting to server."); }
}

// --- 4. NAVIGATION & INITIALIZATION ---
function showForm() {
    $("loginBox").style.display = "none";
    $('main-dashboard').style.display = 'flex';
    loadDashboardData();
}

document.addEventListener('DOMContentLoaded', () => {
    const menuToggle = $('mobile-menu');
    const sidebar = $('sidebar');
    const navItems = document.querySelectorAll('.nav-item');

    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('active');
        });

        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 992 &&
                !sidebar.contains(e.target) &&
                !menuToggle.contains(e.target)) {
                sidebar.classList.remove('active');
            }
        });
    }

    if (sessionStorage.getItem('isLoggedIn') === 'true') {
        showForm();
    }

    // Navigation
    const sections = {
        'btn-dashboard': 'dashboard-section',
        'btn-upload': 'adminForm',
        'btn-live-news': 'adminForm',
        'btn-snippets': 'snippet-section'
    };

    const titleMap = {
        'btn-dashboard': 'Dashboard',
        'btn-upload': 'Upload Edition',
        'btn-live-news': 'Live News',
        'btn-snippets': 'Snippets'
    };

    Object.keys(sections).forEach(btnId => {
        const btn = $(btnId);
        if (btn) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                $('dashboard-section').style.display = 'none';
                $('adminForm').style.display = 'none';
                $('snippet-section').style.display = 'none';

                const target = $(sections[btnId]);
                target.style.display = (btnId === 'btn-dashboard') ? 'grid' : 'block';

                $('pdf-input-group').style.display = (btnId === 'btn-upload') ? 'block' : 'none';
                $('video-input-group').style.display = (btnId === 'btn-live-news') ? 'block' : 'none';
                $('submt').style.display = (btnId === 'btn-snippets') ? 'none' : 'block';
                $('main-title').innerText = titleMap[btnId] || 'Dashboard';
                if (btnId === 'btn-snippets' && window.SnippetManager && typeof window.SnippetManager.ensureLoaded === 'function') {
                    window.requestAnimationFrame(() => {
                        window.requestAnimationFrame(() => {
                            window.SnippetManager.ensureLoaded();
                            if (typeof window.SnippetManager.refreshLayout === 'function') {
                                window.SnippetManager.refreshLayout();
                            }
                        });
                    });
                }

                navItems.forEach((item) => item.classList.remove('active'));
                btn.classList.add('active');
                if (window.innerWidth <= 992 && sidebar) {
                    sidebar.classList.remove('active');
                }
            });
        }
    });

    const totalEdCard = $('stat-total-editions')?.closest('.stat-card');
    const totalViewCard = $('stat-total-views')?.closest('.stat-card');

    if (totalEdCard) totalEdCard.onclick = openEditionsPopup;
    if (totalViewCard) totalViewCard.onclick = showViewsPopup;
});

function logout() {
    if (confirm("Are you sure you want to logout?")) {
        sessionStorage.removeItem("isLoggedIn");
        location.reload();
    }
}
