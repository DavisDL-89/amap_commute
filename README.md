# 高德通勤时间 - Home Assistant 自定义集成

实时查看两地之间的驾车通勤时间，并在首页展示带路况颜色的地图路线卡片。

## 效果预览

卡片展示内容：
- 出发地 → 目的地 名称
- 通勤时间（大字显示）
- 距离 / 红绿灯数量 / 路况状态
- 地图路线（按路况分段着色：绿=畅通、橙=缓行、红=拥堵、深红=严重拥堵）
- 起终点标记

---

## 功能特性

### 核心功能
- ✅ **实时路况**：高德驾车路径规划 API，支持多策略路线
- ✅ **智能更新**：早高峰 07:00–09:00 每 5 分钟刷新，其他时段每 30 分钟
- ✅ **多路径切换**：推荐路线、时间最短、躲避拥堵、不走高速、避免收费等多种策略
- ✅ **历史图表**：查看过去 24 小时通勤时间趋势
- ✅ **路线详情**：分路段导航文字 + 路况分布条 + 地图预览
- ✅ **卡片内弹窗**：不依赖 fixed 定位，完美适配 HA Dashboard 环境

### 路线策略（高德 API）
| 策略 | 说明 |
|------|------|
| 默认推荐 | 躲避拥堵、路程较短、时间最短 |
| 时间最短 | 最快到达 |
| 距离最短 | 路程最短 |
| 躲避拥堵 | 优先避开拥堵路段 |
| 不走高速 | 避免高速公路 |
| 避免收费 | 优先走免费路段 |
| 高速优先 | 优先走高速公路 |

---

## 系统要求

### Home Assistant 版本
- **最低版本**：2021.12.0 或更高
- **推荐版本**：2024.12.0 或更高

### 依赖项
- Python `aiohttp >= 3.8.0`（HA 内置）
- 高德开放平台 API Key（免费）

---

## 准备工作：申请高德 API Key

本插件需要两种不同的高德 Key：

| 用途 | Key 类型 | 说明 |
|------|---------|------|
| 后端路况数据 | **Web 服务 Key** | 用于 Python 调用 REST API |
| 前端地图显示 | **Web 端（JS API）Key** | 用于浏览器渲染地图，需要绑定域名 |

### 申请步骤
1. 前往 [高德开放平台](https://lbs.amap.com/dev/key/app)
2. 创建应用（填写应用名称、选择"Web 服务"和"Web 端（JS API）"）
3. 分别添加两种 Key：
   - **Web 服务 Key**：用于后端（无需绑定域名）
   - **JS API Key**：前端，绑定你的 HA 域名（如 `192.168.1.100` 或 `homeassistant.local`）

> 💡 **域名绑定说明**：JS API Key 需要绑定你访问 HA 的域名或 IP，本地局域网可填写内网 IP（如 `192.168.1.100`）。

---

## 安装步骤

### 第一步：安装集成后端

将 `custom_components/amap_commute/` 整个文件夹复制到你的 HA 配置目录：

```
/config/custom_components/amap_commute/
```

目录结构应如下：
```
custom_components/
└── amap_commute/
    ├── __init__.py
    ├── manifest.json
    ├── config_flow.py
    ├── sensor.py
    ├── const.py
    ├── strings.json
    └── translations/
        ├── zh-Hans.json
        └── en.json
```

### 第二步：安装前端卡片

将 `www/amap-commute-card/` 整个文件夹复制到 HA 配置目录的 `www/` 文件夹：

```
/config/www/amap-commute-card/amap-commute-card.js
```

### 第三步：注册前端资源

在 HA 的 **设置 → 仪表板 → 资源** 中添加：

- URL：`/local/amap-commute-card/amap-commute-card.js`
- 类型：`JavaScript 模块`

或在 `configuration.yaml` 中添加（旧版方式）：

```yaml
lovelace:
  resources:
    - url: /local/amap-commute-card/amap-commute-card.js
      type: module
```

### 第四步：重启 Home Assistant

**必须重启**，以加载新的自定义集成和前端资源。

---

## 配置向导填写说明

重启后前往 **设置 → 设备与服务 → 添加集成**，搜索"高德通勤"并点击进入配置向导。

### 配置字段

| 字段 | 说明 | 示例 |
|------|------|------|
| 高德 Web API Key | Web 服务 Key（用于后端） | `abc123...` |
| 出发地坐标 | 格式：经度,纬度 | `116.397428,39.90923` |
| 目的地坐标 | 格式：经度,纬度 | `116.480053,39.987453` |
| 出发地名称 | 显示在卡片上 | `家` / `公司` |
| 目的地名称 | 显示在卡片上 | `公司` / `家` |

### 如何获取坐标

在 [高德坐标拾取工具](https://lbs.amap.com/tools/picker) 页面搜索地址，点击地图即可获取坐标。

---

## 更新频率说明

集成采用**智能时段策略**自动调整刷新频率，无需手动设置：

| 时段 | 时间范围 | 刷新间隔 | 说明 |
|------|----------|----------|------|
| 🚗 早高峰 | 07:00 – 09:00 | **每 5 分钟** | 路况变化快，高频刷新 |
| 🌙 普通时段 | 其他时间 | **每 30 分钟** | 路况相对稳定，降低 API 调用频次 |

> 💡 **自定义时段**：如需调整时段或间隔，修改 `custom_components/amap_commute/const.py` 中的 `PEAK_INTERVALS`、`DEFAULT_PEAK_INTERVAL`、`DEFAULT_NORMAL_INTERVAL` 三个常量即可，无需改动其他代码。

---

## 添加卡片到仪表板

在 Lovelace 仪表板编辑模式中，添加卡片，选择"手动"，填入：

```yaml
type: custom:amap-commute-card
entity: sensor.通勤时间_家_公司           # 推荐路线传感器
amap_web_key: 你的高德JS_API_Key         # 前端 JS Key（非 Web 服务 Key）
title: 今日通勤                          # 可选，卡片标题
```

### 多路线传感器说明

高德 API 返回多条备选路线时，集成会自动创建多个传感器实体（最多 3 条）：

| 传感器名称 | 说明 |
|-----------|------|
| `通勤时间 家 → 公司` | 推荐路线（默认路线）|
| `通勤时间 家 → 公司（时间最短）` | 时间最短路线 |
| `通勤时间 家 → 公司（躲避拥堵）` | 躲避拥堵路线 |

卡片绑定的 `entity` 决定显示哪条路线的数据。可在不同卡片中绑定不同传感器，同时查看多条路线。

---

## 卡片交互说明

### 点击交互
- **点击时间**：查看过去 24 小时通勤时间历史（折线图 + 路况色点）
- **点击距离 / 红绿灯**：查看路线详情（分路段导航 + 路况分布 + 地图预览）

### 路线详情弹窗
- **标签切换**：点击顶部标签切换不同路线（推荐路线、时间最短、躲避拥堵等）
- **分路段导航**：显示每段路的道路名称、距离、行驶指令
- **路况分布**：彩色条展示整条路线的路况分段
- **路线地图**：缩放预览整条路线的地图

---

## 故障排查

### 传感器显示"不可用"

**可能原因**：
- Web 服务 Key 错误或未启用
- 坐标格式错误（必须是：经度,纬度）
- 网络连接问题

**排查步骤**：
1. 检查 Web 服务 Key 是否正确（前往 [高德开放平台](https://lbs.amap.com/dev/key/app) 确认）
2. 检查坐标格式（如 `116.397428,39.90923`，不是 `39.90923,116.397428`）
3. 查看 HA 日志：`设置 → 系统 → 日志`，搜索 `amap_commute`

### 地图不显示 / 报错

**可能原因**：
- JS API Key 错误或未绑定域名
- 前端资源未正确注册
- 浏览器缓存问题

**排查步骤**：
1. 检查 JS API Key 是否绑定了正确的域名（填写 HA 的 IP 或域名）
2. 确认 `/local/amap-commute-card/amap-commute-card.js` 资源已正确注册
3. 打开浏览器开发者工具（F12）查看 Console 错误
4. 强制刷新页面（Ctrl+Shift+R）清除缓存

### 路况没有颜色

**可能原因**：
- 高德 API 返回的 `tmcs` 路况字段为空
- API 调用参数未设置 `extensions=all`

**排查步骤**：
- 高德免费版 API 包含 `tmcs` 路况字段，插件已默认开启 `extensions=all`
- 查看日志确认 API 返回数据结构是否正常

### 多路线传感器未生成

**可能原因**：
- 高德 API 只返回了 1 条路线（`strategy=0` 导致）
- 旧配置残留

**排查步骤**：
1. 查看日志中是否有"检测到旧配置中的 update_interval 字段"提示
2. 确认高德 API 返回的 `paths` 数组长度是否 > 1
3. 重启 HA 重新加载传感器

---

## 文件清单

```
custom_components/amap_commute/   ← 复制到 /config/custom_components/
├── __init__.py                # 主入口 + 数据协调器
├── manifest.json              # 集成元数据
├── config_flow.py              # UI 配置向导
├── sensor.py                  # 传感器实体（多路线）
├── const.py                  # 常量定义
├── strings.json               # 配置向导字符串
└── translations/
    ├── zh-Hans.json          # 中文翻译
    └── en.json              # 英文翻译

www/amap-commute-card/           ← 复制到 /config/www/
```

---

## 更新日志

### v1.5.0（当前版本）
- ✨ 配置流程升级为分步模式（先选出发地模式，再输入对应字段）
- ✨ 新增手机 GPS 出发地模式，支持从 HA 实体下拉选择并实时获取坐标
- ✨ Lovelace 卡片模块化拆分（`amap-commute-card/` 目录结构）
- ✨ 路线详情和历史统计弹出层升级为独立 Panel 风格
- 🐛 修复 iOS App 地图灰底兼容问题（iOS App 使用 JSAPI 1.4.15）
- 🐛 修复详情页地图在 Panel 中图层偏移问题

### v1.4.0
- ✨ 新增多路径支持（推荐路线、时间最短、躲避拥堵等）
- ✨ 智能时段更新策略（早高峰 5 分钟，普通时段 30 分钟）
- ✨ 卡片内弹窗（Inline Popover），不依赖 fixed 定位
- 🐛 修复高德 API `strategy` 字段类型兼容问题
- 🐛 修复旧配置 `update_interval` 字段清理问题
- 🐛 修复传感器名称使用高德实际路线标签

### v1.3.0
- 🐛 修复底部弹层在 HA Dashboard 内 fixed 定位失效问题

---

## 开源协议

MIT License

---

## 联系方式

- 问题反馈：[GitHub Issues](https://github.com/your-repo/amap_commute/issues)
- 功能建议：[GitHub Discussions](https://github.com/your-repo/amap_commute/discussions)
