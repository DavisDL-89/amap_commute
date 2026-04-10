# v1.7.6 — 高德通勤（amap_commute）

## 摘要

- 集成与 Lovelace 卡片同步至 **manifest 版本 1.7.6**
- README 已更新为当前安装与配置说明

## 集成 / 后端

- 配置流：出发地类型分步、**device_tracker / person** 实体选择（`domain` 列表写法，减少向导 400/Unknown error）
- 实体选择返回值兼容 list / str

## Lovelace 卡片（`www/amap-commute-card.js`）

- 历史 / 路线弹层挂 `document.body`，样式 `acp-*` 注入全局，贴近 HA 卡片主题
- 路线推荐 Tab 切换与统计展示优化；详情弹窗首次地图灰边：`waitLayoutStable`、ResizeObserver、延迟 `getSize` + 路线 `setFitView`
- **iOS HA App** 主地图灰底：布局等待、像素宽高、`ResizeObserver`、多次刷新与 `resize` 尝试

## 升级说明

复制 `custom_components/amap_commute/` 与 `www/amap-commute-card.js` 到 HA 配置目录后 **重启**；仪表板资源仍指向 `/local/amap-commute-card.js`（建议强刷缓存）。
