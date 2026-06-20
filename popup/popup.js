const MESSAGE_COLLECT = "PRODUCT_IMAGE_EXTRACTOR_COLLECT";
const MESSAGE_DOWNLOAD = "PRODUCT_IMAGE_EXTRACTOR_DOWNLOAD";
const MESSAGE_DEDUPE = "PRODUCT_IMAGE_EXTRACTOR_DEDUPE";

const state = {
  tabId: null,
  product: null
};

const elements = {
  subtitle: document.querySelector("#subtitle"),
  status: document.querySelector("#status"),
  summary: document.querySelector("#summary"),
  selectAll: document.querySelector("#selectAll"),
  countText: document.querySelector("#countText"),
  groups: document.querySelector("#groups"),
  downloadButton: document.querySelector("#downloadButton"),
  refreshButton: document.querySelector("#refreshButton"),
  groupTemplate: document.querySelector("#groupTemplate"),
  imageTemplate: document.querySelector("#imageTemplate")
};

document.addEventListener("DOMContentLoaded", init);
elements.refreshButton.addEventListener("click", loadFromActiveTab);
elements.selectAll.addEventListener("change", () => setAllImages(elements.selectAll.checked));
elements.downloadButton.addEventListener("click", downloadSelected);

async function init() {
  await loadFromActiveTab();
}

async function loadFromActiveTab() {
  setLoading("正在读取当前页面...");
  state.product = null;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tabId = tab?.id || null;

    if (!tab?.url || !isSupportedPageUrl(tab.url)) {
      showUnsupported("请打开 Amazon、AliExpress 或 SHEIN 的商品详情页/搜索结果页后再点击插件。");
      return;
    }

    let product = await sendCollectMessage(tab.id);
    if (!product?.supported) {
      showUnsupported(product?.reason || "当前页面暂不支持。");
      return;
    }

    product = await dedupeForPreview(product);
    state.product = product;
    renderProduct(product);
  } catch (error) {
    showUnsupported(error?.message || "读取页面失败，请刷新页面后重试。");
  }
}

async function dedupeForPreview(product) {
  if (product?.mode === "search" || String(product?.adapter || "").endsWith("-search")) {
    return product;
  }

  const response = await chrome.runtime.sendMessage({
    type: MESSAGE_DEDUPE,
    payload: product
  });

  if (!response?.ok || !response.product) return product;
  return response.product;
}

function sendCollectMessage(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: MESSAGE_COLLECT }, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error("当前页面还没有准备好，请刷新页面后重试。"));
        return;
      }
      resolve(response);
    });
  });
}

function renderProduct(product) {
  elements.subtitle.textContent = product.title || "商品图片";
  elements.groups.textContent = "";
  elements.summary.classList.remove("hidden");
  elements.status.className = product.warnings?.length ? "status warning" : "status";
  elements.status.textContent = product.warnings?.[0] || "";

  const groups = product.groups || [];
  groups.forEach((group) => {
    const groupNode = elements.groupTemplate.content.firstElementChild.cloneNode(true);
    const groupCheckbox = groupNode.querySelector(".group-checkbox");
    const groupName = groupNode.querySelector(".group-name");
    const groupCount = groupNode.querySelector(".group-count");
    const grid = groupNode.querySelector(".image-grid");

    groupName.textContent = group.name || "默认变体";
    groupName.title = group.name || "默认变体";
    groupCount.textContent = `${group.images.length} 张`;
    groupNode.dataset.groupId = group.id;

    group.images.forEach((image, index) => {
      const imageNode = elements.imageTemplate.content.firstElementChild.cloneNode(true);
      const checkbox = imageNode.querySelector(".image-checkbox");
      const img = imageNode.querySelector("img");
      const imageIndex = imageNode.querySelector(".image-index");

      checkbox.dataset.groupId = group.id;
      checkbox.dataset.imageId = image.id;
      checkbox.checked = image.selected !== false;
      img.src = image.thumbUrl || image.url;
      img.alt = image.title || `${group.name || "变体"} 第 ${index + 1} 张`;
      imageNode.title = image.title || group.name || "";
      imageIndex.textContent = String(index + 1).padStart(2, "0");

      checkbox.addEventListener("change", () => {
        syncGroupCheckbox(groupNode);
        updateSelectedCount();
      });

      grid.append(imageNode);
    });

    groupCheckbox.addEventListener("change", () => {
      groupNode.querySelectorAll(".image-checkbox").forEach((checkbox) => {
        checkbox.checked = groupCheckbox.checked;
      });
      updateSelectedCount();
    });

    syncGroupCheckbox(groupNode);
    elements.groups.append(groupNode);
  });

  updateSelectedCount();
}

function syncGroupCheckbox(groupNode) {
  const groupCheckbox = groupNode.querySelector(".group-checkbox");
  const imageCheckboxes = Array.from(groupNode.querySelectorAll(".image-checkbox"));
  const checkedCount = imageCheckboxes.filter((checkbox) => checkbox.checked).length;

  groupCheckbox.checked = checkedCount === imageCheckboxes.length;
  groupCheckbox.indeterminate = checkedCount > 0 && checkedCount < imageCheckboxes.length;
}

function setAllImages(checked) {
  document.querySelectorAll(".image-checkbox, .group-checkbox").forEach((checkbox) => {
    checkbox.checked = checked;
    checkbox.indeterminate = false;
  });
  updateSelectedCount();
}

function updateSelectedCount() {
  const imageCheckboxes = Array.from(document.querySelectorAll(".image-checkbox"));
  const selectedCount = imageCheckboxes.filter((checkbox) => checkbox.checked).length;

  elements.selectAll.checked = selectedCount === imageCheckboxes.length && imageCheckboxes.length > 0;
  elements.selectAll.indeterminate = selectedCount > 0 && selectedCount < imageCheckboxes.length;
  elements.countText.textContent = `${selectedCount} / ${imageCheckboxes.length} 张已选`;
  elements.downloadButton.disabled = selectedCount === 0;
}

async function downloadSelected() {
  if (!state.product) return;

  const selectedGroups = buildSelectedGroups();
  if (!selectedGroups.length) return;

  elements.downloadButton.disabled = true;
  elements.downloadButton.textContent = "正在开始下载...";

  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_DOWNLOAD,
      payload: {
        title: state.product.title,
        mode: state.product.mode,
        adapter: state.product.adapter,
        platform: state.product.platform,
        searchKeyword: state.product.searchKeyword,
        groups: selectedGroups
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "下载失败。");
    }

    elements.status.className = "status";
    elements.status.textContent = `已提交 ${response.count} 张图片下载。`;
  } catch (error) {
    elements.status.className = "status error";
    elements.status.textContent = error?.message || "下载失败。";
  } finally {
    elements.downloadButton.textContent = "下载选中图片";
    updateSelectedCount();
  }
}

function buildSelectedGroups() {
  const selected = new Set(
    Array.from(document.querySelectorAll(".image-checkbox:checked"))
      .map((checkbox) => `${checkbox.dataset.groupId}:${checkbox.dataset.imageId}`)
  );

  return (state.product.groups || [])
    .map((group) => ({
      id: group.id,
      name: group.name,
      images: (group.images || []).filter((image) => selected.has(`${group.id}:${image.id}`))
    }))
    .filter((group) => group.images.length);
}

function setLoading(message) {
  elements.subtitle.textContent = message;
  elements.status.className = "status";
  elements.status.textContent = message;
  elements.summary.classList.add("hidden");
  elements.groups.textContent = "";
  elements.downloadButton.disabled = true;
}

function showUnsupported(message) {
  elements.subtitle.textContent = "支持 Amazon、AliExpress、SHEIN";
  elements.status.className = "status error";
  elements.status.textContent = message;
  elements.summary.classList.add("hidden");
  elements.groups.textContent = "";
  elements.downloadButton.disabled = true;
}

function isSupportedPageUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname;
    const path = url.pathname.replace(/\/$/, "");

    if (/(^|\.)amazon\.com$/i.test(host)) {
      const isProductPage =
        /(?:\/dp\/|\/gp\/product\/|\/product\/)[A-Z0-9]{10}(?:[/?#]|$)/i.test(url.pathname);
      const isSearchPage = /^\/s(?:\/|$)/.test(path) && (
        url.searchParams.has("k") ||
        url.searchParams.has("field-keywords") ||
        url.searchParams.has("rh")
      );
      return isProductPage || isSearchPage;
    }

    if (/(^|\.)aliexpress\.com$/i.test(host)) {
      return /\/item\/\d+\.html/i.test(path) ||
        /^\/w\//i.test(path) ||
        /^\/wholesale/i.test(path) ||
        url.searchParams.has("SearchText");
    }

    if (/(^|\.)shein\.com$/i.test(host)) {
      return /-p-\d+\.html/i.test(path) ||
        /\/pdsearch\//i.test(path) ||
        /\/search/i.test(path) ||
        url.searchParams.has("keyword");
    }

    return false;
  } catch (_error) {
    return false;
  }
}
