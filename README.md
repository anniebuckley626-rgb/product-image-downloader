# 电商商品图片提取器

这是一个 Manifest V3 Chrome Extension，支持 Amazon、AliExpress、SHEIN 的商品详情页和搜索结果页。详情页会尽量提取商品 SKU/颜色图；搜索结果页会识别当前已加载的商品封面图，并允许在弹窗中勾选下载。

## 使用方式

1. 打开 Chrome 扩展管理页。
2. 启用“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本文件夹。
4. 打开 Amazon、AliExpress 或 SHEIN 的商品详情页/搜索结果页，点击扩展按钮。
5. 详情页可在弹窗中勾选 SKU/变体图片并下载。
6. 搜索结果页可在弹窗中勾选商品封面图后下载。

下载目录结构：

```text
Amazon/商品标题-变体名.jpg
Amazon/Search-搜索关键词-序号-ASIN.jpg
AliExpress/商品标题-SKU名.jpg
AliExpress/Search-搜索关键词-序号-商品ID.jpg
SHEIN/商品标题-SKU名.jpg
SHEIN/Search-搜索关键词-序号-商品ID.jpg
```

## 当前范围

- 支持 Amazon 商品详情页和搜索结果页。
- 支持 AliExpress 商品详情页和搜索结果页。
- 支持 SHEIN 商品详情页和搜索结果页。
- 搜索结果页只处理当前已加载商品，不自动翻页。
- 搜索结果页不自动打开详情页抓 SKU 图。
- 不处理评论页、店铺页。
- 不接入图片生成，只做识别、预览、下载。
- 读取不到完整变体数据时，会兜底显示当前商品主图区域中的疑似商品图。

## 文件结构

```text
manifest.json
amazonAdapter.js
amazonSearchAdapter.js
marketplaceAdapters.js
content.js
background.js
popup/
  popup.html
  popup.css
  popup.js
```

后续扩展其他平台时，可以新增 adapter，并在 `manifest.json` 中按顺序注入。
