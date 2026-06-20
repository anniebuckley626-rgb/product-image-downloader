(function () {
  const IMAGE_EXTENSION_RE = /\.(jpe?g|png|webp)(?:$|[?#])/i;
  const EXCLUDED_IMAGE_RE = /(sprite|transparent|loading|avatar|logo|icon|captcha|pixel|blank|placeholder)/i;

  registerAdapter(buildAliExpressSearchAdapter());
  registerAdapter(buildAliExpressProductAdapter());
  registerAdapter(buildSheinSearchAdapter());
  registerAdapter(buildSheinProductAdapter());

  function buildAliExpressSearchAdapter() {
    return {
      key: "aliexpress-search",
      canHandle(urlLike) {
        const url = parseUrl(urlLike);
        return Boolean(url) && isAliExpressHost(url.hostname) && (
          /^\/w\//i.test(url.pathname) ||
          /^\/wholesale/i.test(url.pathname) ||
          url.searchParams.has("SearchText") ||
          /\/category\//i.test(url.pathname)
        );
      },
      collect() {
        const items = collectSearchItems({
          platform: "AliExpress",
          itemUrlRe: /\/item\/(\d+)\.html/i,
          cardSelector: [
            "[data-product-id]",
            "[class*='search-card']",
            "[class*='product-card']",
            "[class*='manhattan--container']",
            "[class*='list--gallery']",
            "[class*='productContainer']"
          ].join(","),
          imageSelector: "img"
        });

        return buildSearchPayload({
          adapter: "aliexpress-search",
          platform: "AliExpress",
          keyword: getAliExpressKeyword(),
          items
        });
      }
    };
  }

  function buildAliExpressProductAdapter() {
    return {
      key: "aliexpress-product",
      canHandle(urlLike) {
        const url = parseUrl(urlLike);
        return Boolean(url) && isAliExpressHost(url.hostname) && /\/item\/\d+\.html/i.test(url.pathname);
      },
      collect() {
        const title = getTitle([
          "h1",
          "[class*='title--wrap']",
          "[class*='product-title']",
          "meta[property='og:title']"
        ], "AliExpress 商品");
        const productId = extractMatch(window.location.pathname, /\/item\/(\d+)\.html/i);
        const skuGroups = collectSkuImageGroups({
          platform: "AliExpress",
          scopeSelector: [
            "[class*='product']",
            "[class*='pdp']",
            "[class*='sku']"
          ].join(","),
          rootSelector: [
            "[class*='sku']",
            "[class*='Sku']",
            "[class*='product-prop']",
            "[class*='property']"
          ].join(","),
          imageSelector: "img",
          gallerySelector: [
            "[class*='image-view'] img",
            "[class*='slider'] img",
            "[class*='gallery'] img",
            "[class*='imageList'] img",
            "[class*='magnifier'] img"
          ].join(",")
        });

        return buildProductPayload({
          adapter: "aliexpress-product",
          platform: "AliExpress",
          title,
          productId,
          groups: skuGroups
        });
      }
    };
  }

  function buildSheinSearchAdapter() {
    return {
      key: "shein-search",
      canHandle(urlLike) {
        const url = parseUrl(urlLike);
        return Boolean(url) && isSheinHost(url.hostname) && (
          /\/pdsearch\//i.test(url.pathname) ||
          /\/search/i.test(url.pathname) ||
          url.searchParams.has("keyword")
        ) && !/-p-\d+\.html/i.test(url.pathname);
      },
      collect() {
        const items = collectSearchItems({
          platform: "SHEIN",
          itemUrlRe: /-p-(\d+)\.html/i,
          cardSelector: [
            "[class*='product-card']",
            "[class*='goods-item']",
            "[class*='S-product-item']",
            "[data-sku]",
            "[data-spu]"
          ].join(","),
          imageSelector: "img"
        });

        return buildSearchPayload({
          adapter: "shein-search",
          platform: "SHEIN",
          keyword: getSheinKeyword(),
          items
        });
      }
    };
  }

  function buildSheinProductAdapter() {
    return {
      key: "shein-product",
      canHandle(urlLike) {
        const url = parseUrl(urlLike);
        return Boolean(url) && isSheinHost(url.hostname) && /-p-\d+\.html/i.test(url.pathname);
      },
      collect() {
        const title = getTitle([
          ".product-intro__head-name",
          "[class*='product-intro__head-name']",
          "h1",
          "meta[property='og:title']"
        ], "SHEIN 商品");
        const productId = extractMatch(window.location.pathname, /-p-(\d+)\.html/i);
        const skuGroups = collectSkuImageGroups({
          platform: "SHEIN",
          scopeSelector: [
            "[class*='product-intro']",
            "[class*='goods-detailv2']",
            "[class*='product-detail']"
          ].join(","),
          rootSelector: [
            "[class*='color']",
            "[class*='Color']",
            "[class*='sku']",
            "[class*='goods-color']"
          ].join(","),
          imageSelector: "img",
          preferGalleryWhenSingleSku: true,
          gallerySelector: [
            ".product-intro__thumbs img",
            "[class*='product-intro__thumb'] img",
            "[class*='product-intro__main'] img",
            "[class*='goods-detailv2'] img",
            "[class*='swiper'] img"
          ].join(",")
        });

        return buildProductPayload({
          adapter: "shein-product",
          platform: "SHEIN",
          title,
          productId,
          groups: skuGroups
        });
      }
    };
  }

  function collectSearchItems(config) {
    const links = Array.from(document.querySelectorAll("a[href]"))
      .filter((link) => config.itemUrlRe.test(link.getAttribute("href") || ""));
    const items = [];

    links.forEach((link) => {
      const href = link.getAttribute("href") || "";
      const productUrl = absoluteUrl(href);
      const productId = extractMatch(productUrl, config.itemUrlRe);
      const card = findCard(link, config.cardSelector);
      const imageNode = pickBestImageNode(card || link, config.imageSelector);
      const url = normalizePlatformImageUrl(getBestImageUrl(imageNode), config.platform);
      if (!productUrl || !productId || !url || !isLikelyProductImage(url)) return;

      const title = getSearchItemTitle(card || link, imageNode) || productId;
      items.push({
        id: stableId(`${config.platform}:search:${productId}:${url}`),
        productId,
        title,
        name: title,
        productUrl,
        url,
        thumbUrl: normalizePlatformImageUrl(imageNode?.currentSrc || imageNode?.src || "", config.platform) || url,
        contentKey: productId || getImageContentKey(url),
        source: `${config.platform.toLowerCase()}-search`,
        selected: true
      });
    });

    return dedupeImages(items)
      .map((item, index) => ({
        ...item,
        id: item.id || stableId(`${config.platform}:search:${item.contentKey}:${index}`),
        position: index + 1,
        order: index
      }));
  }

  function collectSkuImageGroups(config) {
    const swatchGroups = collectDomSkuGroups(config);
    const groups = mergeGroups(swatchGroups);
    const fallbackImages = collectGalleryImages(config.gallerySelector, config.platform);

    if (config.preferGalleryWhenSingleSku && fallbackImages.length > countGroupImages(groups) && groups.length <= 1) {
      return buildGalleryFallbackGroups(config, fallbackImages);
    }

    if (groups.length) {
      return finalizeGroups(groups, config.platform);
    }

    if (!fallbackImages.length) return [];

    return buildGalleryFallbackGroups(config, fallbackImages);
  }

  function buildGalleryFallbackGroups(config, images) {
    return finalizeGroups([{
      id: stableId(`${config.platform}:gallery`),
      name: "商品主图",
      source: `${config.platform.toLowerCase()}-gallery`,
      images
    }], config.platform);
  }

  function countGroupImages(groups) {
    return groups.reduce((sum, group) => sum + (group.images?.length || 0), 0);
  }

  function collectDomSkuGroups(config) {
    const imageSelector = expandDescendantSelector(config.rootSelector, config.imageSelector);
    const backgroundSelector = [
      expandDescendantSelector(config.rootSelector, "[style*='url']"),
      expandDescendantSelector(config.rootSelector, "[data-image]"),
      expandDescendantSelector(config.rootSelector, "[data-img]"),
      expandDescendantSelector(config.rootSelector, "[data-image-url]")
    ].join(",");
    const roots = getScopeRoots(config.scopeSelector);
    const nodes = dedupeBy([
      ...roots.flatMap((root) => Array.from(root.querySelectorAll(imageSelector))),
      ...roots.flatMap((root) => Array.from(root.querySelectorAll(backgroundSelector))),
      ...roots.flatMap((root) => Array.from(root.querySelectorAll(config.rootSelector)))
    ], (node) => getBestImageUrl(node) || node.outerHTML || node.textContent || "");
    const groups = [];

    nodes.forEach((imageNode, index) => {
      const url = normalizePlatformImageUrl(getBestImageUrl(imageNode), config.platform);
      if (!url || !isLikelyProductImage(url)) return;

      const swatch = imageNode.closest?.("[aria-label], [title], [data-title], [data-sku-property-text], [data-attr_value], li, button, div") || imageNode;
      const name = cleanSkuName(
        swatch.getAttribute?.("aria-label") ||
        swatch.getAttribute?.("title") ||
        swatch.getAttribute?.("data-title") ||
        swatch.getAttribute?.("data-sku-property-text") ||
        swatch.getAttribute?.("data-attr_value") ||
        imageNode.getAttribute?.("alt") ||
        imageNode.getAttribute?.("title") ||
        swatch.textContent ||
        `SKU ${index + 1}`
      );

      groups.push({
        id: stableId(`${config.platform}:sku:${name}:${url}`),
        name: name || `SKU ${index + 1}`,
        source: `${config.platform.toLowerCase()}-sku`,
        thumbUrl: normalizePlatformImageUrl(imageNode.currentSrc || imageNode.src || getBestImageUrl(imageNode), config.platform) || url,
        images: [buildImageRecord(url, imageNode.currentSrc || imageNode.src || getBestImageUrl(imageNode), 0, `${config.platform.toLowerCase()}-sku`, config.platform)]
      });
    });

    return groups.filter((group) => group.images.length);
  }

  function getScopeRoots(scopeSelector) {
    if (!scopeSelector) return [document];

    const roots = Array.from(document.querySelectorAll(scopeSelector))
      .filter((node) => node.querySelector?.("img"));
    return roots.length ? roots : [document];
  }

  function expandDescendantSelector(rootSelector, childSelector) {
    return String(rootSelector || "")
      .split(",")
      .map((selector) => selector.trim())
      .filter(Boolean)
      .map((selector) => `${selector} ${childSelector}`)
      .join(",");
  }

  function collectEmbeddedSkuGroups(platform) {
    const groups = [];
    const text = Array.from(document.scripts)
      .map((script) => script.textContent || "")
      .filter((value) => /sku|image|color|goods|product/i.test(value))
      .join("\n");

    if (!text) return groups;

    const imageUrls = collectImageUrlsFromText(text, platform);
    const colorNames = collectLikelyNamesFromText(text);
    imageUrls.slice(0, 80).forEach((url, index) => {
      const name = cleanSkuName(colorNames[index] || `SKU ${index + 1}`);
      groups.push({
        id: stableId(`${platform}:embedded:${name}:${url}`),
        name,
        source: `${platform.toLowerCase()}-embedded`,
        images: [buildImageRecord(url, url, 0, `${platform.toLowerCase()}-embedded`, platform)]
      });
    });

    return groups.filter((group) => group.images.length);
  }

  function collectGalleryImages(selector, platform) {
    return dedupeImages(Array.from(document.querySelectorAll(selector))
      .map((node, index) => {
        const url = normalizePlatformImageUrl(getBestImageUrl(node), platform);
        return buildImageRecord(url, node.currentSrc || node.src || url, index, `${platform.toLowerCase()}-gallery`, platform);
      })
      .filter(Boolean));
  }

  function buildSearchPayload({ adapter, platform, keyword, items }) {
    const warnings = [];
    if (!items.length) {
      warnings.push(`没有识别到 ${platform} 搜索结果封面图。`);
    }

    return {
      supported: true,
      adapter,
      mode: "search",
      platform,
      title: keyword ? `${platform} 搜索 - ${keyword}` : `${platform} 搜索结果`,
      searchKeyword: keyword,
      pageUrl: window.location.href,
      collectedAt: new Date().toISOString(),
      totalCount: items.length,
      selectedCount: items.length,
      groups: [{
        id: `${adapter}-results`,
        name: keyword ? `搜索结果：${keyword}` : "搜索结果",
        source: adapter,
        images: items
      }],
      warnings
    };
  }

  function buildProductPayload({ adapter, platform, title, productId, groups }) {
    const normalizedGroups = finalizeGroups(groups, platform);
    const warnings = [];
    if (!normalizedGroups.length) {
      warnings.push(`没有识别到 ${platform} 商品详情页中的 SKU 图片。`);
    }

    return {
      supported: true,
      adapter,
      mode: "product",
      platform,
      productId,
      title,
      pageUrl: window.location.href,
      collectedAt: new Date().toISOString(),
      groups: normalizedGroups,
      warnings
    };
  }

  function finalizeGroups(groups, platform) {
    return mergeGroups(groups)
      .map((group, groupIndex) => {
        const images = dedupeImages(group.images || [])
          .map((image, imageIndex) => ({
            ...image,
            id: image.id || stableId(`${group.name}:${image.contentKey || image.url}:${imageIndex}`),
            position: imageIndex + 1,
            order: imageIndex,
            selected: image.selected !== false
          }));

        return {
          id: group.id || stableId(`${platform}:group:${group.name}:${groupIndex}`),
          name: cleanSkuName(group.name) || `SKU ${groupIndex + 1}`,
          thumbUrl: group.thumbUrl || images[0]?.thumbUrl || images[0]?.url || "",
          source: group.source || `${platform.toLowerCase()}-unknown`,
          images
        };
      })
      .filter((group) => group.images.length);
  }

  function mergeGroups(groups) {
    const byName = new Map();

    groups.forEach((group) => {
      if (!group?.images?.length) return;
      const name = cleanSkuName(group.name || "");
      const key = normalizeKey(name || group.images[0]?.contentKey || group.images[0]?.url);
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, {
          ...group,
          name: name || group.name,
          images: dedupeImages(group.images)
        });
        return;
      }

      existing.images = dedupeImages([...(existing.images || []), ...(group.images || [])]);
      existing.thumbUrl = existing.thumbUrl || group.thumbUrl || "";
    });

    return Array.from(byName.values());
  }

  function buildImageRecord(rawUrl, rawThumbUrl, position, source, platform) {
    const url = normalizePlatformImageUrl(rawUrl, platform);
    if (!url || !isLikelyProductImage(url)) return null;

    const thumbUrl = normalizePlatformImageUrl(rawThumbUrl, platform) || url;
    const contentKey = getImageContentKey(url);
    return {
      id: stableId(`${source}:${contentKey}:${position}`),
      url,
      thumbUrl,
      contentKey,
      position,
      order: position,
      source
    };
  }

  function findCard(link, selector) {
    let node = link;
    for (let i = 0; node && i < 8; i += 1) {
      if (node.matches?.(selector)) return node;
      node = node.parentElement;
    }
    return link.closest(selector) || link.parentElement;
  }

  function pickBestImageNode(root, selector) {
    if (!root) return null;
    const images = Array.from(root.querySelectorAll?.(selector) || []);
    if (root.matches?.(selector)) images.unshift(root);
    return images
      .filter((node) => getBestImageUrl(node))
      .sort((a, b) => scoreImageNode(b) - scoreImageNode(a))[0] || null;
  }

  function getBestImageUrl(imageNode) {
    if (!imageNode) return "";
    const candidates = [];
    if (imageNode.srcset) candidates.push(...parseSrcset(imageNode.srcset));

    [
      "data-image",
      "data-img",
      "data-image-url",
      "data-large",
      "data-url",
      "data-src",
      "data-lazy-src",
      "data-original",
      "data-main-img",
      "data-before-crop-src",
      "data-design-src",
      "src",
      "currentSrc"
    ].forEach((attr) => {
      const value = attr === "currentSrc" ? imageNode.currentSrc : imageNode.getAttribute?.(attr);
      if (value) candidates.push(value);
    });

    const styleText = imageNode.getAttribute?.("style") || "";
    const backgroundMatch = styleText.match(/url\((['"]?)(.*?)\1\)/i);
    if (backgroundMatch?.[2]) candidates.push(backgroundMatch[2]);

    return candidates.filter(Boolean).sort((a, b) => String(b).length - String(a).length)[0] || "";
  }

  function normalizePlatformImageUrl(rawUrl, platform) {
    const absolute = absoluteUrl(rawUrl);
    if (!absolute) return "";

    let url;
    try {
      url = new URL(absolute);
    } catch (_error) {
      return "";
    }

    if (!isAllowedImageHost(url.hostname, platform)) return "";

    url.protocol = "https:";
    url.hash = "";
    url.search = "";
    url.pathname = cleanImagePath(url.pathname, platform);
    return url.href;
  }

  function cleanImagePath(pathname, platform) {
    let path = decodeURIComponent(pathname);

    if (platform === "AliExpress") {
      path = path
        .replace(/(\.(?:jpe?g|png|webp))_[^/]*?\.webp$/i, "$1")
        .replace(/(\.(?:jpe?g|png|webp))_[^/]*$/i, "$1");
    }

    if (platform === "SHEIN") {
      path = path
        .replace(/_thumbnail_\d+x\d+(?=\.(?:jpe?g|png|webp)$)/i, "")
        .replace(/_crop_\d+x\d+(?=\.(?:jpe?g|png|webp)$)/i, "")
        .replace(/_square(?=\.(?:jpe?g|png|webp)$)/i, "");
    }

    return path;
  }

  function isAllowedImageHost(hostname, platform) {
    const host = String(hostname || "").toLowerCase();
    if (platform === "AliExpress") {
      return /alicdn\.com$|aliexpress-media\.com$|aliexpress\.com$/i.test(host);
    }
    if (platform === "SHEIN") {
      return /ltwebstatic\.com$|shein\.com$|shein\.com\./i.test(host);
    }
    return true;
  }

  function isLikelyProductImage(rawUrl) {
    const url = String(rawUrl || "");
    return Boolean(url) && IMAGE_EXTENSION_RE.test(url) && !EXCLUDED_IMAGE_RE.test(url);
  }

  function getSearchItemTitle(root, imageNode) {
    return cleanText(
      imageNode?.getAttribute("alt") ||
      root?.querySelector?.("[title]")?.getAttribute("title") ||
      root?.querySelector?.("h3, h2, [class*='title'], [class*='name']")?.textContent ||
      root?.textContent ||
      ""
    ).slice(0, 180);
  }

  function getTitle(selectors, fallback) {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const text = node?.tagName === "META" ? node.content : node?.textContent;
      const title = cleanText(text || "");
      if (title) return title.replace(/\s*-\s*(AliExpress|SHEIN).*$/i, "");
    }

    const ogTitle = cleanText(document.querySelector("meta[property='og:title']")?.content || "");
    if (ogTitle) return ogTitle.replace(/\s*-\s*(AliExpress|SHEIN).*$/i, "");
    return cleanText(document.title).replace(/\s*-\s*(AliExpress|SHEIN).*$/i, "") || fallback;
  }

  function getAliExpressKeyword() {
    const url = parseUrl(window.location.href);
    const fromParam = cleanText(url?.searchParams.get("SearchText") || "");
    if (fromParam) return fromParam;

    const wholesale = decodeURIComponent(extractMatch(window.location.pathname, /\/w\/wholesale-(.+?)\.html/i) || "");
    if (wholesale) return wholesale.replace(/[-+]+/g, " ");

    return cleanText(document.querySelector("input[type='search'], input[name='SearchText']")?.value || "");
  }

  function getSheinKeyword() {
    const url = parseUrl(window.location.href);
    const fromParam = cleanText(url?.searchParams.get("keyword") || "");
    if (fromParam) return fromParam;

    const pathKeyword = decodeURIComponent(extractMatch(window.location.pathname, /\/pdsearch\/([^/?#]+)/i) || "");
    if (pathKeyword) return pathKeyword.replace(/[-+]+/g, " ");

    return cleanText(document.querySelector("input[type='search'], input[aria-label*='Search' i]")?.value || "");
  }

  function collectImageUrlsFromText(text, platform) {
    const urls = [];
    const urlPattern = /(?:https?:)?\/\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp)(?:_[^"'\\\s<>]+?)?/gi;
    let match;
    while ((match = urlPattern.exec(text))) {
      const url = normalizePlatformImageUrl(match[0], platform);
      if (url && isLikelyProductImage(url)) urls.push(url);
    }
    return dedupeBy(urls, (url) => getImageContentKey(url));
  }

  function collectLikelyNamesFromText(text) {
    const names = [];
    const patterns = [
      /"skuPropertyValue"\s*:\s*"([^"]+)"/gi,
      /"propertyValueName"\s*:\s*"([^"]+)"/gi,
      /"attr_value_name"\s*:\s*"([^"]+)"/gi,
      /"goods_attr_value_name"\s*:\s*"([^"]+)"/gi,
      /"color"\s*:\s*"([^"]+)"/gi
    ];

    patterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(text))) {
        const name = cleanSkuName(match[1]);
        if (name) names.push(name);
      }
    });

    return dedupeBy(names, normalizeKey);
  }

  function dedupeImages(images) {
    const bestByKey = new Map();

    images.forEach((image, index) => {
      if (!image?.url) return;
      const key = image.contentKey || getImageContentKey(image.url);
      if (!key) return;

      const candidate = {
        ...image,
        contentKey: key,
        order: Number.isFinite(image.order) ? image.order : index
      };
      const existing = bestByKey.get(key);
      if (!existing || scoreImageUrl(candidate.url) > scoreImageUrl(existing.url)) {
        bestByKey.set(key, candidate);
      }
    });

    return Array.from(bestByKey.values()).sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  function getImageContentKey(rawUrl) {
    try {
      const url = new URL(rawUrl);
      return decodeURIComponent(url.pathname.split("/").pop() || rawUrl)
        .replace(/_thumbnail_\d+x\d+/i, "")
        .replace(/(\.(?:jpe?g|png|webp))_[^/]+$/i, "$1")
        .replace(/\.(jpe?g|png|webp)$/i, "")
        .toLowerCase();
    } catch (_error) {
      return String(rawUrl || "").toLowerCase();
    }
  }

  function scoreImageNode(node) {
    const url = getBestImageUrl(node);
    const width = Number(node?.naturalWidth || node?.width || 0);
    const height = Number(node?.naturalHeight || node?.height || 0);
    return scoreImageUrl(url) + Math.min(width * height, 1000000);
  }

  function scoreImageUrl(rawUrl) {
    const url = String(rawUrl || "");
    let score = url.length;
    if (/thumbnail|_\d+x\d+|\.webp$/i.test(url)) score -= 20;
    return score;
  }

  function parseSrcset(srcset) {
    return String(srcset || "")
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean);
  }

  function absoluteUrl(rawUrl) {
    const text = String(rawUrl || "").trim().replace(/&amp;/g, "&");
    if (!text || text.startsWith("data:") || text.startsWith("blob:")) return "";
    try {
      if (text.startsWith("//")) return `https:${text}`;
      return new URL(text, window.location.href).href;
    } catch (_error) {
      return "";
    }
  }

  function parseUrl(urlLike) {
    try {
      return new URL(urlLike || window.location.href);
    } catch (_error) {
      return null;
    }
  }

  function extractMatch(text, pattern) {
    const match = String(text || "").match(pattern);
    return match ? match[1] : "";
  }

  function isAliExpressHost(hostname) {
    return /(^|\.)aliexpress\.com$/i.test(hostname || "");
  }

  function isSheinHost(hostname) {
    return /(^|\.)shein\.com$/i.test(hostname || "");
  }

  function cleanSkuName(text) {
    return cleanText(text)
      .replace(/^(color|colour|style type|style|size)\s*[:：]\s*/i, "")
      .replace(/\b(selected|select|choose)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  }

  function cleanText(text) {
    return String(text || "").replace(/\\u002F/g, "/").replace(/\s+/g, " ").trim();
  }

  function normalizeKey(text) {
    return cleanText(text).toLowerCase();
  }

  function dedupeBy(items, keyFn) {
    const seen = new Set();
    return items.filter((item) => {
      const key = keyFn(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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

  function registerAdapter(adapter) {
    window.ProductImageAdapters = window.ProductImageAdapters || {};
    window.ProductImageAdapters[adapter.key] = adapter;
  }
})();
