(function () {
  const AMAZON_HOST_RE = /(^|\.)amazon\.com$/i;
  const ASIN_PATH_RE = /(?:\/dp\/|\/gp\/product\/|\/product\/)([A-Z0-9]{10})(?:[/?#]|$)/i;
  const IMAGE_HOST_RE = /(?:^|\.)media-amazon\.com$|^images-na\.ssl-images-amazon\.com$/i;
  const EXCLUDED_IMAGE_RE = /(sprite|transparent|grey-pixel|play-button|loading|nav-|beacon|pixel|captcha|stars?|badge|logo|icon|avatar|profile)/i;
  const PRODUCT_CONTAINER_SELECTORS = [
    "#imageBlock",
    "#imageBlock_feature_div",
    "#main-image-container",
    "#imgTagWrapperId",
    "#imageBlockNew_feature_div"
  ];

  const VARIATION_LABELS = {
    color_name: "颜色",
    size_name: "尺寸",
    style_name: "款式",
    pattern_name: "图案",
    configuration: "配置",
    flavor_name: "口味",
    scent_name: "香型",
    customer_package_type: "包装",
    number_of_items: "数量",
    item_package_quantity: "数量",
    material_type: "材质"
  };

  function canHandle(urlLike) {
    try {
      const url = new URL(urlLike || window.location.href);
      return AMAZON_HOST_RE.test(url.hostname) && Boolean(extractAsin(url.href));
    } catch (_error) {
      return false;
    }
  }

  async function collect() {
    if (!canHandle(window.location.href)) {
      return {
        supported: false,
        reason: "当前页面不是 Amazon.com 商品详情页。"
      };
    }

    const asin = extractAsin(window.location.href) || getInputValue("#ASIN") || "";
    const title = getProductTitle();
    const selectedVariantParts = getSelectedVariantParts();
    const currentVariantName = joinVariantParts(selectedVariantParts) || "当前商品";
    const swatches = getVariantSwatches();
    const scriptData = readEmbeddedProductData();
    const warnings = [];

    const embeddedGroups = buildGroupsFromEmbeddedImages(scriptData, swatches, currentVariantName)
      .filter((group) => !swatches.length || !isCurrentFallbackGroup(group, currentVariantName));
    let groups = embeddedGroups;

    if (!groups.length && swatches.length) {
      groups = buildGroupsFromSwatches(swatches, []);
    }

    if (!groups.length) {
      const currentGalleryImages = collectCurrentGalleryImages();
      if (currentGalleryImages.length) {
        groups = [{
          id: stableId(`current:${currentVariantName}`),
          name: currentVariantName,
          asin,
          images: currentGalleryImages,
          source: "current-gallery"
        }];
      }
    }

    const normalizedGroups = finalizeGroups(groups);

    if (!normalizedGroups.length) {
      warnings.push("没有识别到可下载的商品主图。");
    } else if (!embeddedGroups.length) {
      warnings.push("没有读到完整变体图片数据，已兜底显示当前页面主图区域中的疑似商品图。");
    }

    return {
      supported: true,
      adapter: "amazon",
      asin,
      title,
      pageUrl: window.location.href,
      collectedAt: new Date().toISOString(),
      groups: normalizedGroups,
      warnings
    };
  }

  function extractAsin(urlText) {
    const pathMatch = String(urlText || "").match(ASIN_PATH_RE);
    if (pathMatch) return pathMatch[1].toUpperCase();

    const hiddenAsin = getInputValue("#ASIN");
    if (/^[A-Z0-9]{10}$/i.test(hiddenAsin || "")) return hiddenAsin.toUpperCase();

    const detailBullets = document.querySelector("#detailBullets_feature_div, #productDetails_detailBullets_sections1");
    const text = detailBullets ? detailBullets.textContent : "";
    const textMatch = text.match(/\bASIN\b\s*[:\u200e\u200f\s]*([A-Z0-9]{10})/i);
    return textMatch ? textMatch[1].toUpperCase() : "";
  }

  function getProductTitle() {
    const visibleTitle = cleanText(document.querySelector("#productTitle")?.textContent || "");
    if (visibleTitle) return visibleTitle;

    const ogTitle = cleanText(document.querySelector('meta[property="og:title"]')?.content || "");
    if (ogTitle) return ogTitle.replace(/\s*-\s*Amazon\.com\s*$/i, "");

    return cleanText(document.title).replace(/\s*:\s*Amazon\.com.*$/i, "") || "Amazon 商品";
  }

  function getSelectedVariantParts() {
    const parts = [];
    const containers = Array.from(document.querySelectorAll('[id^="variation_"]'));

    containers.forEach((container) => {
      const rawId = container.id.replace(/^variation_/, "");
      const label = cleanText(
        container.querySelector(".a-form-label")?.textContent ||
        container.querySelector("label")?.textContent ||
        VARIATION_LABELS[rawId] ||
        rawId.replace(/_/g, " ")
      ).replace(/:$/, "");

      let value = cleanText(container.querySelector(".selection")?.textContent || "");
      if (!value) {
        const selectedOption = container.querySelector("select option:checked");
        value = cleanText(selectedOption?.textContent || "").replace(/^[-\s]+/, "");
      }
      if (!value) {
        const selectedButton = container.querySelector(".swatchSelect, .selected, .a-button-selected, [aria-checked='true']");
        value = extractVariantLabel(selectedButton);
      }

      if (value && !/select|choose/i.test(value)) {
        parts.push({ key: rawId, label, value });
      }
    });

    return dedupeBy(parts, (part) => `${part.label}:${part.value}`);
  }

  function getVariantSwatches() {
    const results = [];
    const containers = Array.from(document.querySelectorAll('[id^="variation_"]'));

    containers.forEach((container) => {
      const dimension = container.id.replace(/^variation_/, "");
      const label = cleanText(
        container.querySelector(".a-form-label")?.textContent ||
        container.querySelector("label")?.textContent ||
        VARIATION_LABELS[dimension] ||
        dimension.replace(/_/g, " ")
      ).replace(/:$/, "");

      const candidates = Array.from(container.querySelectorAll("li, option, [data-defaultasin], [data-dp-url], .swatchAvailable, .swatchSelect"));
      candidates.forEach((node) => {
        if (node.matches?.("option") && !node.value) return;
        const value = extractVariantLabel(node);
        if (!value || /select|choose/i.test(value)) return;

        const asin = extractAsinFromNode(node);
        const imageUrl = normalizeImageUrl(extractImageFromNode(node));
        const selected = isSelectedVariantNode(node);

        results.push({
          dimension,
          label,
          value,
          name: value,
          asin,
          selected,
          thumbUrl: imageUrl,
          imageUrl
        });
      });
    });

    return dedupeBy(results, (item) => `${item.dimension}:${item.value}:${item.asin || ""}`);
  }

  function readEmbeddedProductData() {
    const scripts = Array.from(document.scripts).map((script) => script.textContent || "");
    const data = {
      colorImages: [],
      colorToAsin: [],
      dimensionToAsinMap: [],
      dimensionValuesDisplayData: [],
      variationValues: [],
      asinVariationValues: []
    };

    scripts.forEach((text) => {
      collectJsonAssignments(text, "colorImages").forEach((value) => data.colorImages.push(value));
      collectJsonAssignments(text, "colorToAsin").forEach((value) => data.colorToAsin.push(value));
      collectJsonAssignments(text, "dimensionToAsinMap").forEach((value) => data.dimensionToAsinMap.push(value));
      collectJsonAssignments(text, "dimensionValuesDisplayData").forEach((value) => data.dimensionValuesDisplayData.push(value));
      collectJsonAssignments(text, "variationValues").forEach((value) => data.variationValues.push(value));
      collectJsonAssignments(text, "asinVariationValues").forEach((value) => data.asinVariationValues.push(value));
    });

    return data;
  }

  function collectJsonAssignments(text, key) {
    const values = [];
    const keyPatterns = [
      `"${key}"`,
      `'${key}'`,
      key
    ];

    keyPatterns.forEach((pattern) => {
      let searchFrom = 0;
      while (searchFrom < text.length) {
        const keyIndex = text.indexOf(pattern, searchFrom);
        if (keyIndex === -1) break;

        const delimiterIndex = findNextDelimiter(text, keyIndex + pattern.length);
        if (delimiterIndex === -1) {
          searchFrom = keyIndex + pattern.length;
          continue;
        }

        const objectStart = findNextStructureStart(text, delimiterIndex + 1);
        if (objectStart === -1) {
          searchFrom = keyIndex + pattern.length;
          continue;
        }

        const objectText = readBalancedStructure(text, objectStart);
        if (objectText) {
          const parsed = parseJsonish(objectText);
          if (parsed) values.push(parsed);
          searchFrom = objectStart + objectText.length;
        } else {
          searchFrom = keyIndex + pattern.length;
        }
      }
    });

    return dedupeJsonValues(values);
  }

  function findNextDelimiter(text, from) {
    for (let i = from; i < Math.min(text.length, from + 80); i += 1) {
      const char = text[i];
      if (char === ":" || char === "=") return i;
      if (char === ";" || char === "\n") return -1;
    }
    return -1;
  }

  function findNextStructureStart(text, from) {
    for (let i = from; i < Math.min(text.length, from + 200); i += 1) {
      if (text[i] === "{" || text[i] === "[") return i;
      if (text[i] === ";" || text[i] === "\n") return -1;
    }
    return -1;
  }

  function readBalancedStructure(text, start) {
    const opener = text[start];
    const closer = opener === "{" ? "}" : "]";
    let depth = 0;
    let quote = "";
    let escaped = false;

    for (let i = start; i < text.length; i += 1) {
      const char = text[i];

      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = "";
        }
        continue;
      }

      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }

      if (char === opener) depth += 1;
      if (char === closer) depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }

    return "";
  }

  function parseJsonish(raw) {
    const text = String(raw || "").trim();
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch (_error) {
      // Amazon usually emits valid JSON for the data we need. This narrow
      // fallback handles older pages that quote object strings with single quotes.
    }

    try {
      const normalized = text
        .replace(/([{,]\s*)'([^'\\]*(?:\\.[^'\\]*)*)'\s*:/g, '$1"$2":')
        .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, value) => `:${JSON.stringify(value.replace(/\\'/g, "'"))}`)
        .replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(normalized);
    } catch (_error) {
      return null;
    }
  }

  function buildGroupsFromEmbeddedImages(scriptData, swatches, currentVariantName) {
    const groups = [];
    const swatchByName = new Map(swatches.map((item) => [normalizeKey(item.value), item]));

    scriptData.colorImages.forEach((colorImages) => {
      if (Array.isArray(colorImages)) {
        mergeGroup(groups, {
          id: stableId(`embedded:${currentVariantName}`),
          name: currentVariantName,
          images: normalizeImageList(colorImages),
          source: "embedded-array"
        });
        return;
      }

      if (!isPlainObject(colorImages)) return;

      Object.entries(colorImages).forEach(([rawName, imageList]) => {
        const images = normalizeImageList(imageList);
        if (!images.length) return;

        let name = cleanText(rawName);
        if (!name || /^initial$/i.test(name)) name = currentVariantName;

        const swatch = swatchByName.get(normalizeKey(name));
        mergeGroup(groups, {
          id: stableId(`embedded:${name}:${swatch?.asin || ""}`),
          name,
          asin: swatch?.asin || "",
          thumbUrl: swatch?.thumbUrl || "",
          images,
          source: "embedded-colorImages"
        });
      });
    });

    const asinNames = buildAsinNameMap(scriptData, swatches);
    if (asinNames.size && groups.length) {
      groups.forEach((group) => {
        if (group.asin && asinNames.has(group.asin)) {
          group.name = asinNames.get(group.asin);
        }
      });
    }

    return groups;
  }

  function isCurrentFallbackGroup(group, currentVariantName) {
    if (!group) return false;
    if (group.source === "embedded-array" || group.source === "current-gallery") return true;
    return !group.asin && normalizeKey(group.name) === normalizeKey(currentVariantName);
  }

  function buildGroupsFromSwatches(swatches, existingGroups) {
    const existingNames = new Set(existingGroups.map((group) => normalizeKey(group.name)));
    const imageIds = new Set(existingGroups.flatMap((group) => group.images || []).map((image) => image.contentKey));
    const groupsByName = new Map();

    swatches
      .filter((swatch) => swatch.imageUrl && !existingNames.has(normalizeKey(swatch.value)))
      .forEach((swatch) => {
        const image = buildImageRecord(swatch.imageUrl, swatch.thumbUrl || swatch.imageUrl, 0, "swatch");
        if (!image || imageIds.has(image.contentKey)) return;

        const groupKey = normalizeKey(swatch.value);
        const existing = groupsByName.get(groupKey);
        if (existing) {
          existing.images = dedupeImages([...existing.images, image]).slice(0, 1);
          existing.asin = existing.asin || swatch.asin;
          existing.thumbUrl = existing.thumbUrl || swatch.thumbUrl;
          return;
        }

        groupsByName.set(groupKey, {
          id: stableId(`swatch:${swatch.dimension}:${swatch.value}:${swatch.asin || ""}`),
          name: swatch.value,
          asin: swatch.asin,
          thumbUrl: swatch.thumbUrl,
          source: "swatch",
          images: [image]
        });
      });

    return Array.from(groupsByName.values());
  }

  function buildAsinNameMap(scriptData, swatches) {
    const map = new Map();

    swatches.forEach((swatch) => {
      if (swatch.asin && swatch.value) map.set(swatch.asin, swatch.value);
    });

    scriptData.dimensionValuesDisplayData.forEach((data) => {
      if (!isPlainObject(data)) return;
      Object.entries(data).forEach(([asin, values]) => {
        if (!Array.isArray(values)) return;
        const name = values.map(cleanText).filter(Boolean).join(" / ");
        if (name) map.set(asin, name);
      });
    });

    scriptData.colorToAsin.forEach((data) => {
      if (!isPlainObject(data)) return;
      Object.entries(data).forEach(([key, value]) => {
        if (typeof value === "string" && /^[A-Z0-9]{10}$/i.test(value)) {
          map.set(value.toUpperCase(), cleanText(key));
        } else if (isPlainObject(value)) {
          const asin = value.asin || value.ASIN || value.defaultAsin;
          const name = value.color_name || value.color || value.name || key;
          if (asin && name) map.set(String(asin).toUpperCase(), cleanText(name));
        }
      });
    });

    return map;
  }

  function collectCurrentGalleryImages() {
    const images = [];
    const roots = PRODUCT_CONTAINER_SELECTORS
      .map((selector) => document.querySelector(selector))
      .filter(Boolean);

    const uniqueRoots = roots.filter((root, index) => roots.indexOf(root) === index);
    uniqueRoots.forEach((root) => {
      Array.from(root.querySelectorAll(
        "img#landingImage, img#imgBlkFront, img[data-a-dynamic-image], img[data-old-hires], img[data-hires], img[data-large], img[data-src]"
      )).forEach((node) => {
        const candidates = extractImageCandidates(node);
        candidates.forEach((candidate) => {
          const image = buildImageRecord(candidate.url, candidate.thumbUrl, images.length, "gallery");
          if (image && isLikelyProductImage(image.url)) images.push(image);
        });
      });
    });

    const landingImage = document.querySelector("#landingImage, #imgBlkFront");
    extractImageCandidates(landingImage).forEach((candidate) => {
      const image = buildImageRecord(candidate.url, candidate.thumbUrl, images.length, "landing");
      if (image && isLikelyProductImage(image.url)) images.unshift(image);
    });

    return dedupeImages(images);
  }

  function normalizeImageList(value) {
    if (!Array.isArray(value)) return [];

    const images = value
      .flatMap((entry, index) => imageRecordsFromEmbeddedEntry(entry, index))
      .filter((image) => image && isLikelyProductImage(image.url));

    return dedupeImages(images).sort((a, b) => a.position - b.position);
  }

  function imageRecordsFromEmbeddedEntry(entry, index) {
    if (!entry) return [];
    if (typeof entry === "string") {
      const image = buildImageRecord(entry, entry, index, "embedded-url");
      return image ? [image] : [];
    }

    if (!isPlainObject(entry)) return [];

    const urls = [];
    const thumbUrl = normalizeImageUrl(entry.thumb || entry.thumbnail || entry.tiny || "");
    [
      entry.hiRes,
      entry.large,
      entry.mainUrl,
      entry.url,
      entry.lowRes,
      entry.thumb
    ].forEach((url) => {
      if (url) urls.push({ url, thumbUrl });
    });

    if (entry.main && isPlainObject(entry.main)) {
      Object.keys(entry.main).forEach((url) => urls.push({ url, thumbUrl }));
    }

    const records = urls
      .map((candidate) => buildImageRecord(candidate.url, candidate.thumbUrl, index, entry.variant || "embedded"))
      .filter(Boolean);

    const best = pickBestImageRecord(records);
    return best ? [best] : [];
  }

  function extractImageCandidates(node) {
    if (!node) return [];
    const candidates = [];
    const thumbUrl = normalizeImageUrl(node.currentSrc || node.src || node.getAttribute?.("src") || "");

    const dynamicImage = node.getAttribute?.("data-a-dynamic-image");
    if (dynamicImage) {
      const parsed = parseJsonish(dynamicImage.replace(/&quot;/g, '"'));
      if (isPlainObject(parsed)) {
        Object.keys(parsed).forEach((url) => candidates.push({ url, thumbUrl }));
      }
    }

    [
      "data-old-hires",
      "data-hires",
      "data-large",
      "data-src",
      "src"
    ].forEach((attr) => {
      const value = node.getAttribute?.(attr);
      if (value) candidates.push({ url: value, thumbUrl });
    });

    if (node.srcset) {
      parseSrcset(node.srcset).forEach((url) => candidates.push({ url, thumbUrl }));
    }

    return candidates;
  }

  function extractImageFromNode(node) {
    if (!node) return "";
    const img = node.matches?.("img") ? node : node.querySelector?.("img");
    if (!img) return "";

    const dynamic = img.getAttribute("data-a-dynamic-image");
    if (dynamic) {
      const parsed = parseJsonish(dynamic.replace(/&quot;/g, '"'));
      if (isPlainObject(parsed)) {
        const first = Object.keys(parsed).find(Boolean);
        if (first) return first;
      }
    }

    return img.getAttribute("data-old-hires") ||
      img.getAttribute("data-hires") ||
      img.currentSrc ||
      img.src ||
      img.getAttribute("src") ||
      "";
  }

  function buildImageRecord(rawUrl, rawThumbUrl, position, source) {
    const url = normalizeImageUrl(rawUrl);
    if (!url || !isLikelyProductImage(url)) return null;

    const thumbUrl = normalizeImageUrl(rawThumbUrl) || url;
    const contentKey = getAmazonImageContentKey(url);

    return {
      id: stableId(contentKey),
      url,
      thumbUrl,
      contentKey,
      position,
      order: position,
      source
    };
  }

  function normalizeImageUrl(rawUrl) {
    const cleaned = String(rawUrl || "").trim().replace(/&amp;/g, "&");
    if (!cleaned || cleaned.startsWith("data:") || cleaned.startsWith("blob:")) return "";

    let url;
    try {
      url = new URL(cleaned, window.location.href);
    } catch (_error) {
      return "";
    }

    if (!IMAGE_HOST_RE.test(url.hostname)) return "";

    url.protocol = "https:";
    url.hash = "";
    url.search = "";

    const parts = url.pathname.split("/");
    const fileName = parts.pop() || "";
    parts.push(stripAmazonImageTransform(fileName));
    url.pathname = parts.join("/");

    return url.href;
  }

  function stripAmazonImageTransform(fileName) {
    const decoded = decodeURIComponent(fileName);
    const match = decoded.match(/^(.+?)\._[^.]+_\.(jpg|jpeg|png|webp)$/i);
    if (match) return `${match[1]}.${match[2]}`;
    return decoded;
  }

  function isLikelyProductImage(rawUrl) {
    const url = String(rawUrl || "");
    if (!url || EXCLUDED_IMAGE_RE.test(url)) return false;
    if (!/\/images\/I\//i.test(url)) return false;
    return /\.(jpe?g|png|webp)(?:$|\?)/i.test(url);
  }

  function getAmazonImageContentKey(rawUrl) {
    try {
      const url = new URL(rawUrl);
      const filename = decodeURIComponent(url.pathname.split("/").pop() || "");
      return filename
        .replace(/\._[^.]+_\./, ".")
        .replace(/\.(jpe?g|png|webp)$/i, "")
        .toLowerCase();
    } catch (_error) {
      return String(rawUrl || "").toLowerCase();
    }
  }

  function finalizeGroups(groups) {
    return groups
      .map((group, groupIndex) => {
        const images = dedupeImages(group.images || [])
          .sort((a, b) => (a.order ?? a.position) - (b.order ?? b.position))
          .map((image, imageIndex) => ({
            ...image,
            id: stableId(`${group.name}:${image.contentKey}:${imageIndex}`),
            position: imageIndex + 1,
            selected: true
          }));

        return {
          id: group.id || stableId(`${group.name}:${groupIndex}`),
          name: cleanText(group.name) || `变体 ${groupIndex + 1}`,
          asin: group.asin || "",
          thumbUrl: group.thumbUrl || images[0]?.thumbUrl || images[0]?.url || "",
          source: group.source || "unknown",
          images
        };
      })
      .filter((group) => group.images.length)
      .sort((a, b) => {
        const aCurrent = /当前商品/.test(a.name) ? 0 : 1;
        const bCurrent = /当前商品/.test(b.name) ? 0 : 1;
        return aCurrent - bCurrent || a.name.localeCompare(b.name, "zh-CN");
      });
  }

  function mergeGroup(groups, incoming) {
    if (!incoming || !incoming.images?.length) return;

    const normalizedName = normalizeKey(incoming.name);
    const match = groups.find((group) => normalizeKey(group.name) === normalizedName || (incoming.asin && group.asin === incoming.asin));
    if (!match) {
      groups.push({
        ...incoming,
        images: dedupeImages(incoming.images || [])
      });
      return;
    }

    match.images = dedupeImages([...(match.images || []), ...(incoming.images || [])]);
    match.asin = match.asin || incoming.asin || "";
    match.thumbUrl = match.thumbUrl || incoming.thumbUrl || "";
  }

  function dedupeImages(images) {
    const bestByKey = new Map();

    images.forEach((image, index) => {
      const keys = getImageDedupeKeys(image);
      const key = keys.find(Boolean);
      if (!key) return;

      const candidate = {
        ...image,
        contentKey: key,
        order: Number.isFinite(image.order) ? image.order : (Number.isFinite(image.position) ? image.position : index)
      };

      const existing = keys.map((item) => bestByKey.get(item)).find(Boolean);
      if (!existing || scoreImageRecord(candidate) > scoreImageRecord(existing) || (
        scoreImageRecord(candidate) === scoreImageRecord(existing) &&
        (candidate.order ?? index) < (existing.order ?? index)
      )) {
        keys.forEach((item) => {
          if (item) bestByKey.set(item, candidate);
        });
      }
    });

    return Array.from(new Set(bestByKey.values()))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  function getImageDedupeKeys(image) {
    return dedupeBy([
      image?.contentKey,
      getAmazonImageContentKey(image?.url),
      getAmazonImageContentKey(image?.thumbUrl),
      normalizeImageUrl(image?.url),
      normalizeImageUrl(image?.thumbUrl)
    ].filter(Boolean), (key) => key);
  }

  function pickBestImageRecord(records) {
    return records.reduce((best, image) => {
      if (!best) return image;
      const imageScore = scoreImageRecord(image);
      const bestScore = scoreImageRecord(best);
      if (imageScore > bestScore) return image;
      if (imageScore === bestScore && String(image.url).length > String(best.url).length) return image;
      return best;
    }, null);
  }

  function scoreImageRecord(image) {
    let score = 0;
    const url = String(image?.url || "");

    if (image?.source === "embedded-colorImages") score += 60;
    else if (image?.source === "embedded-array") score += 55;
    else if (image?.source === "gallery") score += 45;
    else if (image?.source === "landing") score += 50;
    else if (image?.source === "swatch") score += 15;

    if (/\/images\/I\//i.test(url)) score += 10;
    if (!/_AC_|_SX|_SY|_SL|_UY|_US/i.test(url)) score += 6;
    if (image?.thumbUrl && image.thumbUrl !== image.url) score += 1;

    return score;
  }

  function dedupeBy(items, keyFn) {
    const seen = new Set();
    return items.filter((item) => {
      const key = keyFn(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function dedupeJsonValues(values) {
    return dedupeBy(values, (value) => {
      try {
        return JSON.stringify(value).slice(0, 2000);
      } catch (_error) {
        return String(value);
      }
    });
  }

  function extractVariantLabel(node) {
    if (!node) return "";
    if (node.matches?.("option")) return cleanText(node.textContent || node.label || "");

    const aria = cleanText(node.getAttribute?.("aria-label") || node.getAttribute?.("title") || "");
    if (aria) return cleanupVariantLabel(aria);

    const img = node.matches?.("img") ? node : node.querySelector?.("img");
    const imageLabel = cleanText(img?.getAttribute("alt") || img?.getAttribute("title") || "");
    if (imageLabel) return cleanupVariantLabel(imageLabel);

    const text = cleanText(node.querySelector?.(".a-button-text, .twisterTextDiv, .swatch-title-text-display")?.textContent || node.textContent || "");
    return cleanupVariantLabel(text);
  }

  function cleanupVariantLabel(text) {
    return cleanText(text)
      .replace(/^click to select\s+/i, "")
      .replace(/^selected\s+/i, "")
      .replace(/\s+selected$/i, "")
      .replace(/^currently selected\s*/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function extractAsinFromNode(node) {
    if (!node) return "";
    const attrs = [
      "data-defaultasin",
      "data-asin",
      "data-dp-url",
      "value"
    ];
    for (const attr of attrs) {
      const value = node.getAttribute?.(attr) || "";
      const match = value.match(/[A-Z0-9]{10}/i);
      if (match) return match[0].toUpperCase();
    }
    const link = node.querySelector?.("a[href*='/dp/'], a[href*='/gp/product/']");
    const href = link?.getAttribute("href") || "";
    const asin = extractAsin(href);
    return asin || "";
  }

  function isSelectedVariantNode(node) {
    if (!node) return false;
    if (node.matches?.("option")) return node.selected;
    return node.getAttribute?.("aria-checked") === "true" ||
      node.getAttribute?.("aria-selected") === "true" ||
      node.classList?.contains("swatchSelect") ||
      node.classList?.contains("selected") ||
      Boolean(node.querySelector?.(".a-button-selected"));
  }

  function joinVariantParts(parts) {
    return parts.map((part) => part.value).filter(Boolean).join(" / ");
  }

  function cleanText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function normalizeKey(text) {
    return cleanText(text).toLowerCase();
  }

  function parseSrcset(srcset) {
    return String(srcset || "")
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  function getInputValue(selector) {
    return document.querySelector(selector)?.value || "";
  }

  function isPlainObject(value) {
    return Boolean(value) && Object.prototype.toString.call(value) === "[object Object]";
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

  window.ProductImageAdapters = window.ProductImageAdapters || {};
  window.ProductImageAdapters.amazon = {
    canHandle,
    collect
  };
})();
