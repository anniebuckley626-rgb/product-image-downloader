const MESSAGE_DOWNLOAD = "PRODUCT_IMAGE_EXTRACTOR_DOWNLOAD";
const MESSAGE_DEDUPE = "PRODUCT_IMAGE_EXTRACTOR_DEDUPE";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) return undefined;

  if (message.type === MESSAGE_DOWNLOAD) {
    downloadImages(message.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error?.message || "下载失败。"
        });
      });

    return true;
  }

  if (message.type === MESSAGE_DEDUPE) {
    dedupeProductForPreview(message.payload)
      .then((result) => sendResponse({ ok: true, product: result }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error?.message || "图片去重失败。"
        });
      });

    return true;
  }

  return undefined;
});

async function downloadImages(payload) {
  const platform = sanitizePathSegment(getPlatformName(payload));
  const title = sanitizePathSegment(payload?.title || `${platform} 商品`);
  const groups = Array.isArray(payload?.groups) ? payload.groups : [];
  const jobs = [];
  const seen = new Set();
  const seenContentHashes = new Set();
  const isSearchDownload = payload?.mode === "search" || String(payload?.adapter || "").endsWith("-search");

  if (isSearchDownload) {
    const keyword = sanitizePathSegment(payload?.searchKeyword || title || "搜索结果");
    let searchIndex = 0;

    groups.forEach((group) => {
      const images = Array.isArray(group?.images) ? group.images : [];

      images.forEach((image) => {
        const url = image?.url;
        const key = image?.asin || image?.contentKey || normalizeDownloadKey(url);
        if (!url || seen.has(key)) return;
        seen.add(key);

        searchIndex += 1;
        const extension = guessExtension(url);
        const sequence = String(searchIndex).padStart(2, "0");
        const fileBaseName = image?.asin
          ? sanitizePathSegment(`Search-${keyword}-${sequence}-${image.asin}`)
          : sanitizePathSegment(`Search-${keyword}-${sequence}-${image?.title || group?.name || "商品主图"}`);

        jobs.push({
          url,
          filename: `${platform}/${fileBaseName}.${extension}`
        });
      });
    });
  } else {
    groups.forEach((group) => {
      const variantName = sanitizePathSegment(group?.name || "默认变体");
      const images = Array.isArray(group?.images) ? group.images : [];
      const hasMultipleImages = images.length > 1;

      images.forEach((image, imageIndex) => {
        const url = image?.url;
        const key = image?.contentKey || normalizeDownloadKey(url);
        if (!url || seen.has(key)) return;
        seen.add(key);

        const extension = guessExtension(url);
        const sequence = String(imageIndex + 1).padStart(2, "0");
        const fileBaseName = sanitizePathSegment(
          hasMultipleImages ? `${title}-${variantName}-${sequence}` : `${title}-${variantName}`
        );
        jobs.push({
          url,
          filename: `${platform}/${fileBaseName}.${extension}`
        });
      });
    });
  }

  const uniqueJobs = [];
  for (const job of jobs) {
    const contentHash = await hashRemoteContent(job.url);
    if (contentHash) {
      if (seenContentHashes.has(contentHash)) continue;
      seenContentHashes.add(contentHash);
    }
    uniqueJobs.push(job);
  }

  for (const job of uniqueJobs) {
    await chrome.downloads.download({
      url: job.url,
      filename: job.filename,
      saveAs: false,
      conflictAction: "uniquify"
    });
    await sleep(120);
  }

  return {
    count: uniqueJobs.length
  };
}

async function dedupeProductForPreview(product) {
  const groups = Array.isArray(product?.groups) ? product.groups : [];
  const normalizedGroups = [];

  for (const group of groups) {
    const images = await dedupeImageListByHash(group?.images || []);
    if (!images.length) continue;

    normalizedGroups.push({
      ...group,
      images: images.map((image, index) => ({
        ...image,
        id: image.id || stableId(`${group?.id || group?.name || "group"}:${image.contentKey || image.url}:${index}`),
        position: index + 1,
        selected: image.selected !== false
      }))
    });
  }

  return {
    ...product,
    groups: normalizedGroups
  };
}

async function dedupeImageListByHash(images) {
  const bestByKey = new Map();

  for (const image of images) {
    if (!image?.url) continue;

    const urlKey = image.contentKey || normalizeDownloadKey(image.url);
    const contentHash = await hashRemoteContent(image.url);
    const key = contentHash || urlKey;
    if (!key) continue;

    const candidate = {
      ...image,
      contentKey: urlKey,
      contentHash
    };
    const existing = bestByKey.get(key);

    if (!existing || scorePreviewImage(candidate) > scorePreviewImage(existing)) {
      bestByKey.set(key, candidate);
    }
  }

  return Array.from(bestByKey.values())
    .sort((a, b) => (a.position || 0) - (b.position || 0));
}

function scorePreviewImage(image) {
  let score = 0;
  const source = image?.source || "";
  const url = image?.url || "";

  if (source.startsWith("embedded")) score += 30;
  if (source === "landing") score += 20;
  if (source === "gallery") score += 15;
  if (source === "swatch") score += 5;
  if (!/_AC_|_SX|_SY|_SL|_UY|_US/i.test(url)) score += 3;
  if (image?.thumbUrl && image.thumbUrl !== image.url) score += 1;

  return score;
}

async function hashRemoteContent(url) {
  try {
    const response = await fetch(url, {
      credentials: "omit",
      cache: "force-cache"
    });
    if (!response.ok) return "";

    const buffer = await response.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch (_error) {
    return "";
  }
}

function stableId(input) {
  const text = String(input || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `id_${(hash >>> 0).toString(36)}`;
}

function sanitizePathSegment(value) {
  const text = String(value || "")
    .replace(/[<>:"\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  const safe = text || "未命名";
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safe) ? `_${safe}` : safe;
  return reserved.slice(0, 120);
}

function normalizeDownloadKey(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return decodeURIComponent(url.pathname.split("/").pop() || rawUrl)
      .replace(/\._[^.]+_\./, ".")
      .replace(/\.(jpe?g|png|webp)$/i, "")
      .toLowerCase();
  } catch (_error) {
    return String(rawUrl || "").toLowerCase();
  }
}

function guessExtension(rawUrl) {
  try {
    const pathname = new URL(rawUrl).pathname;
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    const ext = match ? match[1].toLowerCase() : "jpg";
    if (ext === "jpeg") return "jpg";
    return ["jpg", "png", "webp"].includes(ext) ? ext : "jpg";
  } catch (_error) {
    return "jpg";
  }
}

function getPlatformName(payload) {
  if (payload?.platform) return payload.platform;

  const adapter = String(payload?.adapter || "").toLowerCase();
  if (adapter.includes("aliexpress")) return "AliExpress";
  if (adapter.includes("shein")) return "SHEIN";
  return "Amazon";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
