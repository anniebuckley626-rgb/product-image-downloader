# Release Guide

本项目推荐把扩展安装包作为 GitHub Release 附件发布，而不是提交 zip 文件到仓库。

## 发布前检查

1. 确认 `manifest.json` 中的 `version` 已更新。
2. 在 `chrome://extensions/` 重新加载扩展。
3. 至少测试一个商品详情页和一个搜索结果页。
4. 确认批量下载功能正常。

## 打包文件

建议 zip 中只包含扩展运行需要的文件：

```text
manifest.json
amazonAdapter.js
amazonSearchAdapter.js
marketplaceAdapters.js
content.js
background.js
popup/
icons/
README.md
LICENSE
```

不要把 `.git/`、开发缓存、临时文件或未使用的大文件放进发布 zip。

## GitHub Release 建议

Release 标题示例：

```text
Product Image Downloader v0.2.0
```

Release 描述示例：

```text
## Highlights

- 支持 Amazon、AliExpress、SHEIN 商品图片下载。
- 支持商品详情页和搜索结果页图片选择。
- 优化 Amazon 搜索页复选框点击体验。

## Install

1. Download the zip file.
2. Unzip it locally.
3. Open chrome://extensions/.
4. Enable Developer mode.
5. Click "Load unpacked" and select the unzipped folder.
```
