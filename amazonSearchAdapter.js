(function () {
  const AMAZON_HOST_RE = /(^|\.)amazon\.com$/i;
  const SEARCH_RESULT_SELECTOR = '[data-component-type="s-search-result"][data-asin]';
  const IMAGE_HOST_RE = /(?:^|\.)media-amazon\.com$|^images-na\.ssl-images-amazon\.com$/i;
  const EXCLUDED_IMAGE_RE = /(sprite|transparent|grey-pixel|play-button|loading|nav-|beacon|pixel|captcha|stars?|badge|logo|icon|avatar|profile)/i;
  const MESSAGE_DOWNLOAD = "PRODUCT_IMAGE_EXTRACTOR_DOWNLOAD";
  const STYLE_ID = "product-image-extractor-search-style";
  const TOOLBAR_ID = "product-image-extractor-search-toolbar";
  const CHECKBOX_HIT_TARGET_CLASS = "product-image-extractor-search-checkbox-hit-target";
  const CHECKBOX_CLASS = "product-image-extractor-search-checkbox";
  const ENHANCED_CLASS = "product-image-extractor-search-enhanced";

  let selectedIds = new Set(readStoredSelection());
  let observer = null;
  let booted = false;
  let enhanceScheduled = false;

  function canHandle(urlLike) {
    try {
      const url = new URL(urlLike || window.location.href);
      const path = url.pathname.replace(/\/$/, "");
      return AMAZON_HOST_RE.test(url.hostname) && /^\/s(?:\/|$)/.test(path) && (
        url.searchParams.has("k") ||
        url.searchParams.has("field-keywords") ||
        url.searchParams.has("rh")
      );
    } catch (_error) {
      return false;
    }
  }

  async function collect() {
    if (!canHandle(window.location.href)) {
      return {
        supported: false,
        reason: "当前页面不是 Amazon 搜索结果页。"
      };
    }

    ensureSelectionUi();
    const items = collectSearchItems();
    const selectedCount = items.filter((item) => item.selected).length;
    const keyword = getSearchKeyword();
    const warnings = [];

    if (!items.length) {
      warnings.push("没有识别到可下载的搜索结果主图。");
    } else if (!selectedCount) {
      warnings.push("搜索结果页已识别，请在页面或弹窗中勾选要下载的商品主图。");
    }

    return {
      supported: true,
      adapter: "amazon-search",
      mode: "search",
      platform: "Amazon Search",
      title: keyword ? `Amazon 搜索 - ${keyword}` : "Amazon 搜索结果",
      searchKeyword: keyword,
      pageUrl: window.location.href,
      collectedAt: new Date().toISOString(),
      totalCount: items.length,
      selectedCount,
      groups: [{
        id: "amazon-search-results",
        name: keyword ? `搜索结果：${keyword}` : "搜索结果",
        source: "amazon-search",
        images: items
      }],
      warnings
    };
  }

  function ensureSelectionUi() {
    if (!canHandle(window.location.href)) return;

    injectStyle();
    enhanceVisibleCards();
    ensureToolbar();
    updateToolbar();

    if (!observer) {
      observer = new MutationObserver((mutations) => {
        if (!shouldHandleMutations(mutations)) return;
        scheduleEnhance();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    booted = true;
  }

  function enhanceVisibleCards() {
    getResultCards().forEach((card) => {
      if (card.classList.contains(ENHANCED_CLASS)) return;

      const item = readItemFromCard(card);
      if (!item) return;

      card.classList.add(ENHANCED_CLASS);
      card.dataset.productImageExtractorId = item.id;

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = CHECKBOX_CLASS;
      checkbox.checked = selectedIds.has(item.id);
      checkbox.title = "选择下载这张商品主图";
      checkbox.setAttribute("aria-label", "选择下载这张商品主图");

      const hitTarget = document.createElement("div");
      hitTarget.className = CHECKBOX_HIT_TARGET_CLASS;
      hitTarget.title = checkbox.title;
      hitTarget.tabIndex = 0;
      hitTarget.setAttribute("role", "checkbox");
      hitTarget.setAttribute("aria-label", checkbox.getAttribute("aria-label"));
      hitTarget.setAttribute("aria-checked", String(checkbox.checked));

      hitTarget.addEventListener("click", (event) => {
        toggleSearchItemSelection(event, item.id);
      }, true);
      hitTarget.addEventListener("keydown", (event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        toggleSearchItemSelection(event, item.id);
      });
      ["pointerdown", "mousedown", "mouseup", "dblclick"].forEach((eventName) => {
        hitTarget.addEventListener(eventName, (event) => {
          event.stopPropagation();
          event.stopImmediatePropagation?.();
        }, true);
      });

      hitTarget.append(checkbox);
      card.prepend(hitTarget);
      card.classList.toggle("product-image-extractor-search-selected", checkbox.checked);
    });
  }

  function toggleSearchItemSelection(event, id) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    setItemSelected(id, !selectedIds.has(id));
  }

  function ensureToolbar() {
    if (document.getElementById(TOOLBAR_ID)) return;

    const toolbar = document.createElement("div");
    toolbar.id = TOOLBAR_ID;
    toolbar.innerHTML = [
      '<span class="pie-search-count">已选 0 个</span>',
      '<button type="button" data-action="select-visible">全选当前页</button>',
      '<button type="button" data-action="clear">清空</button>',
      '<button type="button" class="pie-search-primary" data-action="download">下载选中</button>'
    ].join("");

    toolbar.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;

      const action = button.dataset.action;
      if (action === "select-visible") {
        selectVisibleItems();
      } else if (action === "clear") {
        clearSelection();
      } else if (action === "download") {
        await downloadSelectedFromPage(button);
      }
    });

    document.body.append(toolbar);
  }

  function shouldHandleMutations(mutations) {
    return mutations.some((mutation) => {
      const target = mutation.target;
      if (!target || target.nodeType !== Node.ELEMENT_NODE) return true;
      if (target.closest?.(`#${TOOLBAR_ID}, #${STYLE_ID}, .${CHECKBOX_HIT_TARGET_CLASS}, .${CHECKBOX_CLASS}`)) return false;

      return Array.from(mutation.addedNodes || []).some((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return false;
        if (node.closest?.(`#${TOOLBAR_ID}, #${STYLE_ID}, .${CHECKBOX_HIT_TARGET_CLASS}, .${CHECKBOX_CLASS}`)) return false;
        return node.matches?.(SEARCH_RESULT_SELECTOR) || Boolean(node.querySelector?.(SEARCH_RESULT_SELECTOR));
      });
    });
  }

  function scheduleEnhance() {
    if (enhanceScheduled) return;
    enhanceScheduled = true;

    const run = () => {
      enhanceScheduled = false;
      enhanceVisibleCards();
      updateToolbar();
    };

    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(run);
    } else {
      window.setTimeout(run, 80);
    }
  }

  async function downloadSelectedFromPage(button) {
    const product = await collect();
    const selectedImages = (product.groups?.[0]?.images || []).filter((image) => image.selected !== false);

    if (!selectedImages.length) {
      setToolbarMessage("请先选择商品");
      return;
    }

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "下载中...";

    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_DOWNLOAD,
        payload: {
          ...product,
          groups: [{
            ...product.groups[0],
            images: selectedImages
          }]
        }
      });

      if (!response?.ok) {
        throw new Error(response?.error || "下载失败。");
      }

      setToolbarMessage(`已提交 ${response.count} 张`);
    } catch (error) {
      setToolbarMessage(error?.message || "下载失败");
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function selectVisibleItems() {
    collectSearchItems().forEach((item) => selectedIds.add(item.id));
    persistSelection();
    syncCheckboxes();
    updateToolbar();
  }

  function clearSelection() {
    selectedIds = new Set();
    persistSelection();
    syncCheckboxes();
    updateToolbar();
  }

  function setItemSelected(id, selected) {
    if (selected) selectedIds.add(id);
    else selectedIds.delete(id);

    persistSelection();
    syncCheckboxes();
    updateToolbar();
  }

  function syncCheckboxes() {
    document.querySelectorAll(`.${CHECKBOX_CLASS}`).forEach((checkbox) => {
      const card = checkbox.closest(SEARCH_RESULT_SELECTOR);
      const id = card?.dataset.productImageExtractorId;
      const checked = Boolean(id && selectedIds.has(id));
      checkbox.checked = checked;
      checkbox.closest(`.${CHECKBOX_HIT_TARGET_CLASS}`)?.setAttribute("aria-checked", String(checked));
      card?.classList.toggle("product-image-extractor-search-selected", checked);
    });
  }

  function updateToolbar() {
    const toolbar = document.getElementById(TOOLBAR_ID);
    if (!toolbar) return;

    const total = collectSearchItems().length;
    const selected = Array.from(selectedIds).filter((id) => {
      return Boolean(document.querySelector(`${SEARCH_RESULT_SELECTOR}[data-product-image-extractor-id="${cssEscape(id)}"]`));
    }).length;

    const count = toolbar.querySelector(".pie-search-count");
    const nextText = `已选 ${selected} / ${total} 个`;
    if (count && count.textContent !== nextText) count.textContent = nextText;

    const downloadButton = toolbar.querySelector('[data-action="download"]');
    if (downloadButton && downloadButton.disabled !== (selected === 0)) {
      downloadButton.disabled = selected === 0;
    }
  }

  function setToolbarMessage(text) {
    const toolbar = document.getElementById(TOOLBAR_ID);
    const count = toolbar?.querySelector(".pie-search-count");
    if (!count) return;

    if (count.textContent !== text) count.textContent = text;
    window.setTimeout(updateToolbar, 1800);
  }

  function collectSearchItems() {
    return dedupeBy(
      getResultCards()
        .map(readItemFromCard)
        .filter(Boolean)
        .map((item, index) => ({
          ...item,
          position: index + 1,
          order: index,
          selected: selectedIds.has(item.id)
        })),
      (item) => item.asin || item.contentKey || item.url
    );
  }

  function getResultCards() {
    return Array.from(document.querySelectorAll(SEARCH_RESULT_SELECTOR))
      .filter((card) => {
        const asin = cleanText(card.getAttribute("data-asin") || "");
        return asin && !card.closest("[data-component-type='s-widget']");
      });
  }

  function readItemFromCard(card) {
    if (!card) return null;

    const asin = cleanText(card.getAttribute("data-asin") || "");
    const imageNode = card.querySelector("img.s-image");
    const title = getCardTitle(card, imageNode);
    const rawUrl = getBestImageUrl(imageNode);
    const url = normalizeImageUrl(rawUrl);
    if (!asin || !url || !isLikelyProductImage(url)) return null;

    const productUrl = normalizeProductUrl(card);
    const contentKey = asin || getAmazonImageContentKey(url);

    return {
      id: stableId(`amazon-search:${asin}:${contentKey}`),
      asin,
      title: title || asin,
      name: title || asin,
      productUrl,
      url,
      thumbUrl: normalizeImageUrl(imageNode?.currentSrc || imageNode?.src || rawUrl) || url,
      contentKey,
      source: isSponsored(card) ? "amazon-search-sponsored" : "amazon-search"
    };
  }

  function getCardTitle(card, imageNode) {
    const titleNode = card.querySelector("h2 span, h2 a span, [data-cy='title-recipe'] span");
    const visibleTitle = cleanText(titleNode?.textContent || "");
    if (visibleTitle) return visibleTitle;

    const imageAlt = cleanText(imageNode?.getAttribute("alt") || "");
    if (imageAlt) return imageAlt;

    return cleanText(card.querySelector("h2")?.textContent || "");
  }

  function getBestImageUrl(imageNode) {
    if (!imageNode) return "";

    const candidates = [];
    if (imageNode.srcset) candidates.push(...parseSrcset(imageNode.srcset));
    [
      imageNode.getAttribute("data-old-hires"),
      imageNode.getAttribute("data-hires"),
      imageNode.currentSrc,
      imageNode.src,
      imageNode.getAttribute("src")
    ].forEach((url) => {
      if (url) candidates.push(url);
    });

    return candidates
      .map(normalizeImageUrl)
      .filter(Boolean)
      .sort((a, b) => scoreImageUrl(b) - scoreImageUrl(a))[0] || "";
  }

  function normalizeProductUrl(card) {
    const link = card.querySelector("a.a-link-normal.s-no-outline, h2 a, a[href*='/dp/']");
    const href = link?.getAttribute("href") || "";
    if (!href) return "";

    try {
      const url = new URL(href, window.location.href);
      url.hash = "";
      return url.href;
    } catch (_error) {
      return "";
    }
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

  function scoreImageUrl(rawUrl) {
    const url = String(rawUrl || "");
    let score = url.length;
    if (!/_AC_|_SX|_SY|_SL|_UY|_US|_UL/i.test(url)) score += 1000;
    if (/\.webp$/i.test(url)) score -= 20;
    return score;
  }

  function getSearchKeyword() {
    try {
      const url = new URL(window.location.href);
      return cleanText(url.searchParams.get("k") || url.searchParams.get("field-keywords") || "");
    } catch (_error) {
      return "";
    }
  }

  function isSponsored(card) {
    return /sponsored/i.test(card.textContent || "");
  }

  function getStorageKey() {
    try {
      const url = new URL(window.location.href);
      return `product-image-extractor:amazon-search:${url.pathname}:${url.searchParams.get("k") || url.searchParams.get("field-keywords") || url.search}`;
    } catch (_error) {
      return "product-image-extractor:amazon-search";
    }
  }

  function readStoredSelection() {
    try {
      const raw = sessionStorage.getItem(getStorageKey());
      const values = JSON.parse(raw || "[]");
      return Array.isArray(values) ? values : [];
    } catch (_error) {
      return [];
    }
  }

  function persistSelection() {
    try {
      sessionStorage.setItem(getStorageKey(), JSON.stringify(Array.from(selectedIds)));
    } catch (_error) {
      // Selection persistence is a convenience only.
    }
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      ${SEARCH_RESULT_SELECTOR}.${ENHANCED_CLASS} {
        position: relative !important;
      }

      .${CHECKBOX_HIT_TARGET_CLASS} {
        position: absolute !important;
        z-index: 2147483646 !important;
        top: 0 !important;
        left: 0 !important;
        width: 92px !important;
        height: 72px !important;
        margin: 0 !important;
        display: block !important;
        background: transparent !important;
        cursor: pointer !important;
        pointer-events: auto !important;
      }

      .${CHECKBOX_CLASS} {
        position: absolute !important;
        top: 10px !important;
        left: 10px !important;
        width: 22px !important;
        height: 22px !important;
        margin: 0 !important;
        accent-color: #2563eb !important;
        cursor: pointer !important;
        pointer-events: none !important;
        appearance: auto !important;
        filter: drop-shadow(0 1px 3px rgba(15, 23, 42, 0.35));
      }

      ${SEARCH_RESULT_SELECTOR}.product-image-extractor-search-selected {
        outline: 3px solid #2563eb !important;
        outline-offset: -3px !important;
      }

      #${TOOLBAR_ID} {
        position: fixed !important;
        right: 18px !important;
        bottom: 18px !important;
        z-index: 2147483647 !important;
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        padding: 10px !important;
        border: 1px solid #d7dde5 !important;
        border-radius: 8px !important;
        background: #ffffff !important;
        color: #111827 !important;
        box-shadow: 0 12px 34px rgba(15, 23, 42, 0.22) !important;
        font: 13px/1.4 Arial, sans-serif !important;
      }

      #${TOOLBAR_ID} .pie-search-count {
        min-width: 96px !important;
        font-weight: 700 !important;
        white-space: nowrap !important;
      }

      #${TOOLBAR_ID} button {
        height: 30px !important;
        padding: 0 10px !important;
        border: 1px solid #d7dde5 !important;
        border-radius: 6px !important;
        background: #ffffff !important;
        color: #111827 !important;
        cursor: pointer !important;
        font: inherit !important;
      }

      #${TOOLBAR_ID} button:hover:not(:disabled) {
        border-color: #94a3b8 !important;
      }

      #${TOOLBAR_ID} button.pie-search-primary {
        border-color: #2563eb !important;
        background: #2563eb !important;
        color: #ffffff !important;
        font-weight: 700 !important;
      }

      #${TOOLBAR_ID} button:disabled {
        opacity: 0.55 !important;
        cursor: not-allowed !important;
      }
    `;

    document.documentElement.append(style);
  }

  function cleanText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function parseSrcset(srcset) {
    return String(srcset || "")
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean);
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

  function cssEscape(value) {
    if (window.CSS?.escape) return window.CSS.escape(value);
    return String(value || "").replace(/["\\]/g, "\\$&");
  }

  function bootWhenReady() {
    if (booted || !canHandle(window.location.href)) return;

    if (document.body) {
      ensureSelectionUi();
      return;
    }

    window.addEventListener("DOMContentLoaded", ensureSelectionUi, { once: true });
  }

  window.ProductImageAdapters = window.ProductImageAdapters || {};
  window.ProductImageAdapters.amazonSearch = {
    canHandle,
    collect,
    ensureSelectionUi
  };

  bootWhenReady();
})();
