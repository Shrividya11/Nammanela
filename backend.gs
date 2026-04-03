const CONFIG = {
  adminEmail: "admin",
  adminPassword: "123456",
  paperFolderName: "NammaNela_Papers",
  snippetImageFolderName: "NammaNela_Snippet_Images"
};

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};

    if (params.action === "shareSnip" && params.imageFileId) {
      return getSnipSharePage_(params.imageFileId);
    }

    if (params.imageFileId) {
      return json_(getImageAsData_(params.imageFileId));
    }

    if (params.fileId) {
      return getFileAsBase64_(params.fileId);
    }

    if (params.action === "getSnippetMappings") {
      return json_({
        status: "success",
        mappings: getSnippetMappings_(params.editionDate, params.pageNumber)
      });
    }

    if (params.adminCall === "true") {
      return json_(getDashboardData_());
    }

    incrementVisitorCount_();
    return json_(getPublicData_());
  } catch (error) {
    return json_({
      status: "error",
      error: error.message || String(error)
    });
  }
}

function doPost(e) {
  try {
    const payload = parseBody_(e);
    const action = payload.action;

    switch (action) {
      case "login":
        return json_(handleLogin_(payload));
      case "submitForm":
        return json_(handleSubmitForm_(payload));
      case "deleteEdition":
        return json_(deleteEdition_(payload.date));
      case "saveSnippetMapping":
        return json_(saveSnippetMapping_(payload.mapping));
      case "uploadSnipImage":
        return json_(uploadSnipImage_(payload));
      case "deleteSnippetMapping":
        return json_(deleteSnippetMapping_(payload.id));
      default:
        return json_({
          status: "error",
          msg: "Unknown action"
        });
    }
  } catch (error) {
    return json_({
      status: "error",
      error: error.message || String(error)
    });
  }
}

function handleLogin_(payload) {
  const email = String(payload.email || "").trim();
  const password = String(payload.password || "").trim();

  if (email === CONFIG.adminEmail && password === CONFIG.adminPassword) {
    logAdminLogin_(email);
    return { status: "success", msg: "Login successful" };
  }

  return { status: "error", msg: "Invalid email or password" };
}

function handleSubmitForm_(payload) {
  const youtubeLink = String(payload.youtubeLink || "").trim();
  const pdfData = String(payload.pdfData || "").trim();
  const pdfName = String(payload.pdfName || "").trim();

  if (youtubeLink) {
    setSetting_("lastVideo", youtubeLink);
  }

  if (pdfData && pdfName) {
    const folder = getOrCreateFolder_(CONFIG.paperFolderName);
    const editionDate = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      "dd-MM-yyyy"
    );
    const safeName = editionDate + "_" + pdfName.replace(/[^\w.\- ]/g, "_");
    const bytes = Utilities.base64Decode(pdfData);
    const file = folder.createFile(Utilities.newBlob(bytes, MimeType.PDF, safeName));

    upsertEditionRow_({
      date: editionDate,
      fileId: file.getId(),
      fileName: safeName,
      createdAt: new Date().toISOString()
    });

    setSetting_("latestEditionDate", editionDate);
    setSetting_("latestEditionFileId", file.getId());
  }

  return { status: "success", msg: "Upload saved successfully" };
}

function deleteEdition_(dateString) {
  if (!dateString) {
    throw new Error("Edition date is required.");
  }

  const items = getStore_("editions", []);
  const remainingItems = [];

  items.forEach(function(item) {
    if (String(item.date) === String(dateString)) {
      if (item.fileId) {
        try {
          DriveApp.getFileById(item.fileId).setTrashed(true);
        } catch (error) {
        }
      }
      return;
    }

    remainingItems.push(item);
  });

  setStore_("editions", remainingItems);

  return { status: "success", msg: "Edition deleted" };
}

function saveSnippetMapping_(mapping) {
  if (typeof mapping === "string") {
    mapping = JSON.parse(mapping);
  }

  if (!mapping) {
    throw new Error("Mapping payload is missing.");
  }

  const editionDate = String(mapping.editionDate || "").trim();
  const pageNumber = Number(mapping.pageNumber || 0);
  const selection = mapping.selection || {};

  if (!editionDate) {
    throw new Error("editionDate is required.");
  }
  if (!pageNumber) {
    throw new Error("pageNumber is required.");
  }
  if (
    selection.x === undefined ||
    selection.y === undefined ||
    selection.width === undefined ||
    selection.height === undefined
  ) {
    throw new Error("Selection coordinates are required.");
  }

  const snippetId = mapping.id || new Date().getTime();
  let imageUrl = "";
  let imageFileId = "";

  if (mapping.imageData) {
    const upload = saveSnippetImage_(
      mapping.imageData,
      mapping.imageName || ("snippet_" + snippetId + ".png")
    );
    imageUrl = upload.url;
    imageFileId = upload.fileId;
  }

  const snippets = getStore_("snippets", []);
  snippets.push({
    id: snippetId,
    editionDate: editionDate,
    pageNumber: pageNumber,
    title: String(mapping.title || ""),
    selection: {
      x: Number(selection.x),
      y: Number(selection.y),
      width: Number(selection.width),
      height: Number(selection.height)
    },
    imageUrl: imageUrl,
    imageFileId: imageFileId,
    imageName: String(mapping.imageName || ""),
    createdAt: new Date().toISOString()
  });
  setStore_("snippets", snippets);

  return {
    status: "success",
    msg: "Snippet mapping saved.",
    snippetId: snippetId,
    imageUrl: imageUrl
  };
}

function deleteSnippetMapping_(id) {
  if (!id) {
    throw new Error("Snippet id is required.");
  }

  const snippets = getStore_("snippets", []);
  const remainingSnippets = [];
  let deleted = false;

  snippets.forEach(function(item) {
    if (String(item.id) === String(id)) {
      deleted = true;
      if (item.imageFileId) {
        try {
          DriveApp.getFileById(item.imageFileId).setTrashed(true);
        } catch (error) {
        }
      }
      return;
    }

    remainingSnippets.push(item);
  });

  if (deleted) {
    setStore_("snippets", remainingSnippets);
    return { status: "success", msg: "Snippet deleted." };
  }

  return { status: "error", msg: "Snippet not found." };
}

function getSnippetMappings_(editionDate, pageNumber) {
  const data = getStore_("snippets", []);
  const results = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i] || {};
    const rowEditionDate = String(row.editionDate || "");
    const rowPageNumber = Number(row.pageNumber || 0);

    if (editionDate && rowEditionDate !== String(editionDate)) {
      continue;
    }
    if (pageNumber && rowPageNumber !== Number(pageNumber)) {
      continue;
    }

    results.push({
      id: row.id,
      editionDate: rowEditionDate,
      pageNumber: rowPageNumber,
      title: row.title || "",
      selection: {
        x: Number((row.selection || {}).x || 0),
        y: Number((row.selection || {}).y || 0),
        width: Number((row.selection || {}).width || 0),
        height: Number((row.selection || {}).height || 0)
      },
      imageUrl: row.imageUrl || "",
      imageFileId: row.imageFileId || "",
      imageName: row.imageName || "",
      createdAt: row.createdAt || ""
    });
  }

  return results;
}

function getDashboardData_() {
  const editions = getEditionRecords_();
  const visitorStats = getVisitorBreakdown_();
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd-MM-yyyy");
  const lastVideo = getSetting_("lastVideo");
  let totalViews = 0;

  for (var i = 0; i < visitorStats.length; i++) {
    totalViews += Number(visitorStats[i].count || 0);
  }

  return {
    status: "success",
    totalEditions: editions.length,
    todayEditions: editions.filter(function(item) {
      return item.date === today;
    }).length,
    totalViews: totalViews,
    visitorCount: getTodayVisitorCount_(),
    lastVideo: lastVideo || "",
    fullList: editions,
    dailyBreakdown: visitorStats
  };
}

function getPublicData_() {
  const editions = getEditionRecords_();
  const paperMap = {};
  const availableDates = [];

  editions
    .sort(function(a, b) {
      return dateValue_(a.date) - dateValue_(b.date);
    })
    .forEach(function(item) {
      paperMap[item.date] = item.fileId;
      availableDates.push(item.date);
    });

  return {
    status: "success",
    paperMap: paperMap,
    availableDates: availableDates,
    lastVideo: getSetting_("lastVideo") || ""
  };
}

function getEditionRecords_() {
  return getStore_("editions", []);
}

function getFileAsBase64_(fileId) {
  const file = DriveApp.getFileById(fileId);
  const bytes = file.getBlob().getBytes();
  const base64 = Utilities.base64Encode(bytes);
  return ContentService
    .createTextOutput(base64)
    .setMimeType(ContentService.MimeType.TEXT);
}

function getImageAsData_(fileId) {
  const file = DriveApp.getFileById(fileId);
  const blob = file.getBlob();
  return {
    status: "success",
    fileId: fileId,
    mimeType: blob.getContentType(),
    dataUrl: "data:" + blob.getContentType() + ";base64," + Utilities.base64Encode(blob.getBytes())
  };
}

function getSharedImageUrl_(fileId) {
  return "https://drive.google.com/uc?export=view&id=" + fileId;
}

function getSnipSharePage_(fileId) {
  const file = DriveApp.getFileById(fileId);
  const imageUrl = getSharedImageUrl_(fileId);
  const title = "Namma Nela Snippet";
  const description = "Shared newspaper snippet from Namma Nela.";
  const pageTitle = sanitizeHtml_(title);
  const pageDescription = sanitizeHtml_(description);
  const pageImage = sanitizeHtml_(imageUrl);
  const imageName = sanitizeHtml_(file.getName() || "snippet");

  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html>' +
    '<html><head>' +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + pageTitle + '</title>' +
    '<meta property="og:type" content="website">' +
    '<meta property="og:title" content="' + pageTitle + '">' +
    '<meta property="og:description" content="' + pageDescription + '">' +
    '<meta property="og:image" content="' + pageImage + '">' +
    '<meta name="twitter:card" content="summary_large_image">' +
    '<meta name="twitter:title" content="' + pageTitle + '">' +
    '<meta name="twitter:description" content="' + pageDescription + '">' +
    '<meta name="twitter:image" content="' + pageImage + '">' +
    '<style>' +
    'body{margin:0;font-family:Arial,sans-serif;background:#f4f1e8;color:#111;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;box-sizing:border-box;}' +
    '.card{max-width:900px;width:100%;background:#fff;border-radius:18px;box-shadow:0 20px 60px rgba(0,0,0,0.15);padding:24px;text-align:center;}' +
    '.card img{width:100%;height:auto;border-radius:12px;display:block;background:#f8fafc;}' +
    '.meta{margin-top:16px;font-size:15px;color:#334155;}' +
    '</style>' +
    '</head><body>' +
    '<div class="card">' +
    '<img src="' + pageImage + '" alt="' + imageName + '">' +
    '<div class="meta">Namma Nela Snippet</div>' +
    '</div>' +
    '</body></html>'
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function saveSnippetImage_(imageData, fileName) {
  const folder = getOrCreateFolder_(CONFIG.snippetImageFolderName);
  const matches = String(imageData).match(/^data:(.+);base64,(.+)$/);

  if (!matches) {
    throw new Error("Snippet image format is invalid.");
  }

  const mimeType = matches[1];
  const base64 = matches[2];
  const bytes = Utilities.base64Decode(base64);
  const file = folder.createFile(Utilities.newBlob(bytes, mimeType, fileName));

  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (error) {
  }

  return {
    fileId: file.getId(),
    url: "https://drive.google.com/uc?export=view&id=" + file.getId()
  };
}

function uploadSnipImage_(payload) {
  const imageData = String(payload.imageData || "").trim();
  const imageName = String(payload.imageName || ("snip_" + new Date().getTime() + ".png")).trim();

  if (!imageData) {
    throw new Error("Snip image data is required.");
  }

  const upload = saveSnippetImage_(imageData, imageName);
  return {
    status: "success",
    imageUrl: upload.url,
    imageFileId: upload.fileId,
    shareUrl: ScriptApp.getService().getUrl() + "?action=shareSnip&imageFileId=" + encodeURIComponent(upload.fileId)
  };
}

function sanitizeHtml_(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function incrementVisitorCount_() {
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd-MM-yyyy");
  const visitors = getStore_("visitors", {});
  visitors[today] = Number(visitors[today] || 0) + 1;
  setStore_("visitors", visitors);
}

function getTodayVisitorCount_() {
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd-MM-yyyy");
  const visitors = getStore_("visitors", {});
  return Number(visitors[today] || 0);
}

function getVisitorBreakdown_() {
  const data = getStore_("visitors", {});
  const items = [];

  Object.keys(data).forEach(function(key) {
    items.push({
      date: String(key),
      count: Number(data[key] || 0)
    });
  });

  items.sort(function(a, b) {
    return dateValue_(a.date) - dateValue_(b.date);
  });

  return items;
}

function logAdminLogin_(email) {
  const logins = getStore_("adminLogins", []);
  logins.push({
    email: String(email || ""),
    timestamp: new Date().toISOString()
  });
  setStore_("adminLogins", logins);
}

function parseBody_(e) {
  const params = (e && e.parameter) || {};

  if (!e || !e.postData || !e.postData.contents) {
    return params;
  }

  const raw = String(e.postData.contents || "").trim();
  if (!raw) {
    return params;
  }

  try {
    const parsedJson = JSON.parse(raw);
    return mergePayloads_(params, parsedJson);
  } catch (jsonError) {
  }

  const formPayload = {};
  raw.split("&").forEach(function(pair) {
    if (!pair) return;

    const parts = pair.split("=");
    const key = decodeURIComponent(String(parts.shift() || "").replace(/\+/g, " "));
    const value = decodeURIComponent(String(parts.join("=") || "").replace(/\+/g, " "));

    if (key) {
      formPayload[key] = parsePossibleJson_(value);
    }
  });

  return mergePayloads_(params, formPayload);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSetting_(key) {
  const settings = getStore_("settings", {});
  return settings[key] || "";
}

function setSetting_(key, value) {
  const settings = getStore_("settings", {});
  settings[key] = value;
  setStore_("settings", settings);
}

function upsertEditionRow_(item) {
  const editions = getStore_("editions", []);
  let updated = false;

  for (let i = 0; i < editions.length; i++) {
    if (String(editions[i].date) === String(item.date)) {
      editions[i] = {
        date: item.date,
        fileId: item.fileId,
        name: item.fileName,
        createdAt: item.createdAt
      };
      updated = true;
      break;
    }
  }

  if (!updated) {
    editions.push({
      date: item.date,
      fileId: item.fileId,
      name: item.fileName,
      createdAt: item.createdAt
    });
  }

  setStore_("editions", editions);
}

function getOrCreateFolder_(name) {
  const folders = DriveApp.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(name);
}

function dateValue_(value) {
  const parts = String(value || "").split("-");
  if (parts.length !== 3) {
    return 0;
  }
  return new Date(parts[2], Number(parts[1]) - 1, parts[0]).getTime();
}

function mergePayloads_(basePayload, incomingPayload) {
  const merged = {};
  const base = basePayload || {};
  const incoming = incomingPayload || {};

  Object.keys(base).forEach(function(key) {
    merged[key] = base[key];
  });

  Object.keys(incoming).forEach(function(key) {
    merged[key] = incoming[key];
  });

  return merged;
}

function parsePossibleJson_(value) {
  const text = String(value || "").trim();

  if (!text) {
    return "";
  }

  const startsLikeJson =
    text.charAt(0) === "{" ||
    text.charAt(0) === "[" ||
    text === "true" ||
    text === "false" ||
    text === "null";

  if (!startsLikeJson) {
    return text;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return text;
  }
}

function setupApp_() {
  getStore_("settings", {});
  getStore_("editions", []);
  getStore_("snippets", []);
  getStore_("visitors", {});
  getStore_("adminLogins", []);
}

function getStore_(key, fallbackValue) {
  const properties = PropertiesService.getScriptProperties();
  const raw = properties.getProperty(key);

  if (!raw) {
    if (fallbackValue !== undefined) {
      setStore_(key, fallbackValue);
      return fallbackValue;
    }
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    return fallbackValue;
  }
}

function setStore_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(value));
}
