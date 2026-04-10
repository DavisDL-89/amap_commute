# 高德通勤时间 · Home Assistant 自定义集成

实时查看两地之间的驾车通勤时间，并在仪表板展示带路况分段的地图路线卡片（Lovelace 自定义卡片）。

**当前版本**：`1.7.6`（见 `custom_components/amap_commute/manifest.json`）

---

## 效果预览

- 出发地 → 目的地名称，通勤时间、距离、红绿灯、路况摘要  
- 主卡片地图：按路况分色的路线折线 + 起终点标记  
- 点击时间：今日通勤历史折线图（平均 / 最快 / 最慢）  
- 点击距离或红绿灯：路线详情（多推荐线路切换、路况条、分路段导航、地图预览）  
- 详情与历史弹层挂在 **`document.body`**，与 HA 全屏遮罩同级，避免被卡片区域裁剪  

---

## 功能特性

| 能力 | 说明 |
|------|------|
| 路况与路径 | 高德驾车路径规划 REST API，支持多备选路径（`all_routes`） |
| 更新节奏 | 早高峰 07:00–09:00 每 **5** 分钟，其余时段每 **30** 分钟（可在 `const.py` 调整） |
| 出发地 | **固定经纬度**，或 **`device_tracker` / `person` 实体**（按调度刷新坐标） |
| 配置向导 | 分步：先选出发地类型，再填 Key、目的地与对应起点 |
| 前端卡片 | 独立 JS 资源；路线/历史弹窗样式与 HA 卡片主题变量一致 |
| 移动端 | 针对 iOS HA App / WebView 的地图容器尺寸与多次 `resize` 适配 |

### 路线策略（由集成侧请求参数决定）

与高德策略一致，例如：推荐、时间最短、距离最短、躲避拥堵、不走高速、避免收费、高速优先等（以传感器/实体实际输出为准）。

---

## 系统要求

- **Home Assistant**：`2021.12.0` 及以上（`manifest.json` 中 `homeassistant`）  
- **Python**：`aiohttp >= 3.8.0`（由 Home Assistant 提供）  
- **高德 Key**：需分别申请 **Web 服务 Key**（后端）与 **JS API Key**（前端地图）  

---

## 高德 Key 说明

| 用途 | Key 类型 | 说明 |
|------|----------|------|
| 集成后端 | **Web 服务 Key** | 配置在集成中，用于 REST 请求 |
| Lovelace 卡片 | **Web 端（JS API）Key** | 写在卡片 YAML 的 `amap_web_key`，需在开放平台绑定访问 HA 所用的 **域名或 IP** |

申请：<https://lbs.amap.com/dev/key/app>  

---

## 安装

### 1. 后端（自定义集成）

将本仓库中的目录复制到 HA 配置目录：

```text
/config/custom_components/amap_commute/
```

至少包含：`__init__.py`、`manifest.json`、`config_flow.py`、`sensor.py`、`const.py`、`helpers.py`、`strings.json`、`icon.svg`、`translations/` 下语言文件。

### 2. 前端卡片脚本

复制到：

```text
/config/www/amap-commute-card.js
```

（可选）将 `www/amap-commute-card-preview.html` 拷到本机浏览器打开，可静态预览卡片布局（需自行填入测试 Key）。

### 3. 注册资源

**设置 → 仪表板 → 资源** 添加：

- URL：`/local/amap-commute-card.js`  
- 类型：**JavaScript 模块**  

### 4. 重启 Home Assistant

修改自定义集成或新增 `www` 脚本后需重启（或按 HA 提示重载）。

---

## 集成配置向导

**设置 → 设备与服务 → 添加集成**，搜索「高德通勤」。

1. **出发地类型**  
   - 固定出发点：下一步填写 **经度,纬度**  
   - 设备 / 人员：下一步用 **实体选择器** 选择 `device_tracker` 或 `person`（无需手抄 entity id）  

2. **路线与 API**  
   - **高德 Web 服务 API Key**  
   - **目的地坐标**（经度,纬度）  
   - 展示用名称、以及上一步对应的固定起点坐标或追踪实体  

坐标示例：`116.397428,39.90923`（经度在前，纬度在后）。拾取工具：<https://lbs.amap.com/tools/picker>  

---

## Lovelace 卡片

```yaml
type: custom:amap-commute-card
entity: sensor.your_commute_sensor
amap_web_key: 你的高德_JS_API_Key
title: 今日通勤
```

- `entity`：绑定集成生成的通勤传感器（多路线时会有多个实体，择一即可）。  
- `amap_web_key`：**JS API Key**，与集成里的 Web 服务 Key 不同。  

---

## 交互说明

| 操作 | 行为 |
|------|------|
| 点击通勤时间 | 打开今日历史折线图（含统计摘要） |
| 点击距离 / 红绿灯 | 打开路线详情：推荐 1/2/3… 标签、路况条、地图、分路段列表 |
| 路线标签 | `type="button"`，仅切换当前弹窗内路线，不关闭弹窗 |

---

## 故障排查

| 现象 | 建议 |
|------|------|
| 传感器不可用 | 检查 Web 服务 Key、坐标格式、网络；查看日志中 `amap_commute` |
| 主地图灰底、只有线（尤其 iOS App） | 确认已用最新 `amap-commute-card.js`；检查 JS Key 与域名绑定；强刷前端缓存 |
| 路线弹窗里地图首次有灰边 | 切换其他推荐再切回或等待自动 `resize`；仍异常时可反馈 HA 与 App 版本 |
| 配置向导 Unknown error / 400 | 更新集成与 HA；若选「设备/人员」报错，查看日志栈迹并提 Issue |

---

## 仓库与协作

请将下方占位符换成你的 GitHub 用户或组织名：

- Issues：`https://github.com/<YOUR_GITHUB_USER>/amap_commute/issues`  
- Discussions（若开启）：`https://github.com/<YOUR_GITHUB_USER>/amap_commute/discussions`  

---

## 更新日志（摘要）

### v1.7.6

- 主卡片地图在 **iOS HA App** 上强化容器宽高、`getSize` / `resize`、延迟刷新与 `ResizeObserver`，减轻灰底问题  

### v1.7.5

- 路线弹窗首次打开地图灰边：`waitLayoutStable`、多次延迟与路线 `setFitView`  

### v1.7.4

- 弹窗样式注入 `document`（`acp-*`），与主题一致；配置流实体选择器兼容；路线 Tab 点击修复  

### 更早版本

- 多路径、`all_routes`、分步配置流、弹层挂载 `body`、历史图表与路况分段等（详见 `VERSION_NOTES.md`）。  

---

## 开源协议

MIT License
