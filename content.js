(function () {
  const MESSAGE_COLLECT = "PRODUCT_IMAGE_EXTRACTOR_COLLECT";

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== MESSAGE_COLLECT) return undefined;

    collectProductImages()
      .then((payload) => sendResponse(payload))
      .catch((error) => {
        sendResponse({
          supported: false,
          reason: error?.message || "读取页面数据失败。"
        });
      });

    return true;
  });

  async function collectProductImages() {
    const registry = window.ProductImageAdapters || {};
    const adapters = [
      registry.amazonSearch,
      registry.amazon,
      registry["aliexpress-search"],
      registry["aliexpress-product"],
      registry["shein-search"],
      registry["shein-product"],
      ...Object.values(registry)
    ].filter(Boolean);
    const adapter = adapters.find((item) => item?.canHandle?.(window.location.href));

    if (!adapter) {
      return {
        supported: false,
        reason: "当前页面暂不支持。请打开 Amazon、AliExpress 或 SHEIN 的商品详情页/搜索结果页后再点击插件。"
      };
    }

    return adapter.collect();
  }
})();
