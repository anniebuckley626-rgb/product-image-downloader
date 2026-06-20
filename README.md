# Product Image Downloader

商品图片下载助手是一个 Manifest V3 Chrome 扩展，用于帮助电商卖家、运营人员和个人店主更方便地下载自己的商品图片。

它的目标很简单：在商品详情页或搜索结果页中识别可下载的商品图片，提供预览、勾选和批量下载能力，减少手动右键保存图片的重复操作。

## 项目价值

- 快速整理自己的商品图片素材。
- 批量下载商品主图、SKU 图或搜索结果页封面图。
- 支持在下载前预览和勾选图片，避免保存无关图片。
- 适合商品上架、素材归档、店铺运营日常整理等轻量场景。

## 当前支持

- Amazon 商品详情页
- Amazon 搜索结果页
- AliExpress 商品详情页
- AliExpress 搜索结果页
- SHEIN 商品详情页
- SHEIN 搜索结果页

## 功能特点

- 商品详情页：尽量识别商品主图和 SKU/变体图片。
- 搜索结果页：识别当前页面已经加载出来的商品封面图。
- 支持图片预览、单选、全选和清空。
- 支持批量下载选中的图片。
- 下载文件会按平台和商品信息进行命名，方便后续整理。

## 安装方式

### 从 GitHub Release 安装

1. 打开本项目的 GitHub Releases 页面。
2. 下载最新版本的 zip 文件。
3. 解压 zip 文件到本地文件夹。
4. 打开 Chrome，进入 `chrome://extensions/`。
5. 开启右上角的“开发者模式”。
6. 点击“加载已解压的扩展程序”。
7. 选择刚刚解压出来的文件夹。

### 从源码安装

1. 下载或克隆本仓库。
2. 打开 Chrome，进入 `chrome://extensions/`。
3. 开启右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择本项目根目录。

## 使用方式

1. 打开支持的平台页面，例如 Amazon 商品详情页或搜索结果页。
2. 点击浏览器工具栏中的扩展图标。
3. 在弹窗中查看识别到的图片。
4. 勾选需要下载的图片。
5. 点击“下载选中图片”。

在 Amazon 搜索结果页中，页面上也会显示可勾选的小框，方便直接选择当前页商品封面图。

## 下载目录示例

```text
Amazon/商品标题-变体名.jpg
Amazon/Search-搜索关键词-序号-ASIN.jpg
AliExpress/商品标题-SKU名.jpg
AliExpress/Search-搜索关键词-序号-商品ID.jpg
SHEIN/商品标题-SKU名.jpg
SHEIN/Search-搜索关键词-序号-商品ID.jpg
```

## 项目范围

这个项目保持轻量，不计划做成复杂的运营系统。

当前不包含：

- 自动翻页
- 自动打开商品详情页
- 评论图片下载
- 店铺整站下载
- 数据分析报表
- 图片生成或图片编辑

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
icons/
```

## 合规说明

本工具仅用于下载和整理你有权使用的商品图片，例如自己的商品图片、已授权素材或个人学习研究场景。请遵守相关平台的服务条款、版权政策和当地法律法规。

## License

MIT License
