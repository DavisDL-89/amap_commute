# iOS App WebView 地图修复 - v1.4.3

## 🐛 问题描述

在 Home Assistant iOS App 中查看卡片时，**地图只显示路线，不显示底图**，但浏览器端正常。

## 🔍 问题分析

### iOS WebView 的特殊性

1. **WebKit WebView 的渲染限制**
   - iOS App 使用 WebKit WebView 渲染网页
   - WebView 与独立浏览器的行为存在差异
   - 特别是在 Shadow DOM 和 CSS 布局方面

2. **容器尺寸问题**
   - iOS WebView 中，`width: 100%` 和 `height: 100%` 可能导致容器高度为 0
   - 高德地图 API 需要明确的容器尺寸才能正确渲染底图
   - 如果容器高度为 0，地图只会显示路线和标记（因为它们是绝对定位）

3. **Shadow DOM 的影响**
   - iOS WebView 对 Shadow DOM 的样式继承处理不同
   - 某些 CSS 属性在 Shadow DOM 内可能失效

### 验证方法

在 iOS App 中打开调试：
1. 连接 iOS 设备到 Mac
2. Safari → 开发 → [您的设备]
3. 查看 Web Inspector

**预期错误**：
```
[AmapCommuteCard] 容器尺寸：320 x 0
[AmapCommuteCard] 地图对象创建成功
[AmapCommuteCard] 地图层添加完成，折线数：1 标记数：2
```

注意：容器高度为 0！

---

## ✅ 修复方案

### 方案 1：强制设置容器尺寸（已采用）

**主地图容器**：
```css
#amap-entity_xxx {
  width:100%;
  height:100%;
  display:block;
  position:absolute;  /* ✅ 新增 */
  top:0;          /* ✅ 新增 */
  left:0;         /* ✅ 新增 */
  z-index:1;       /* ✅ 新增 */
}
```

**详情地图容器**：
```css
.detail-map-inner {
  width:100%;
  height:100%;
  display:block;
  position:absolute;  /* ✅ 新增 */
  top:0;          /* ✅ 新增 */
  left:0;         /* ✅ 新增 */
  z-index:1;       /* ✅ 新增 */
}
```

**说明**：
- 使用 `position: absolute` 配合 `top: 0; left: 0` 确保容器占满父元素
- `z-index: 1` 确保地图在正确的层级

---

### 方案 2：JavaScript 强制设置尺寸（已采用）

**在地图初始化前**：
```javascript
// iOS WebView 特定修复：强制容器尺寸
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
if (isIOS) {
  container.style.width = container.clientWidth + "px";
  container.style.height = container.clientHeight + "px";
  console.log("[AmapCommuteCard] iOS 设备，强制设置容器尺寸");
}
```

**说明**：
- 使用 JavaScript 强制设置容器的 `width` 和 `height` 为具体像素值
- 避免 iOS WebView 将百分比高度计算为 0
- `container.clientWidth` 和 `container.clientHeight` 获取实际尺寸

---

### 方案 3：多次刷新地图尺寸（已采用）

**iOS WebView 多次刷新策略**：
```javascript
// iOS WebView 额外优化：多次刷新确保地图正确显示
if (isIOS) {
  setTimeout(() => {
    console.log("[AmapCommuteCard] iOS 第一次尺寸刷新");
    this._map.getSize();
    this._map.setFitView();
  }, 100);
  setTimeout(() => {
    console.log("[AmapCommuteCard] iOS 第二次尺寸刷新");
    this._map.getSize();
    this._map.setFitView();
  }, 500);
  setTimeout(() => {
    console.log("[AmapCommuteCard] iOS 第三次尺寸刷新");
    this._map.getSize();
    this._map.setFitView();
  }, 1000);
}
```

**说明**：
- iOS WebView 的渲染是异步的，可能需要多次刷新才能正确计算尺寸
- 分别在 100ms、500ms、1000ms 时刷新
- 确保地图在各个阶段都能获取正确的容器尺寸

---

### 方案 4：添加 iOS 特定优化（已采用）

**详情地图容器**：
```css
.detail-map-wrap {
  /* ... 其他样式 ... */
  -webkit-overflow-scrolling:touch;  /* ✅ iOS 特定优化 */
}
```

**说明**：
- `-webkit-overflow-scrolling: touch` 是 iOS 特定的 CSS 属性
- 启用原生滚动体验，提升性能
- 帮助 WebView 正确处理触摸事件

---

## 📊 修复对比

### v1.4.2（iOS App 有问题）
```javascript
// ❌ 容器样式
#map-id {
  width:100%;
  height:100%;
  display:block;
}

// ❌ 没有强制尺寸
// ❌ 没有多次刷新
```

**iOS App 表现**：
- 容器高度：0
- 地图：只显示路线和标记
- 底图：不显示

### v1.4.3（已修复）
```javascript
// ✅ 容器样式
#map-id {
  width:100%;
  height:100%;
  display:block;
  position:absolute;  // 新增
  top:0;          // 新增
  left:0;         // 新增
  z-index:1;       // 新增
}

// ✅ 强制尺寸
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
if (isIOS) {
  container.style.width = container.clientWidth + "px";
  container.style.height = container.clientHeight + "px";
}

// ✅ 多次刷新
if (isIOS) {
  setTimeout(() => { ... }, 100);
  setTimeout(() => { ... }, 500);
  setTimeout(() => { ... }, 1000);
}
```

**iOS App 表现**：
- 容器高度：正确的像素值（如 180px）
- 地图：完整显示（底图 + 路线 + 标记）
- 交互：正常

---

## 🧪 测试验证

### 测试步骤

1. **更新文件**
   ```
   将 www/amap-commute-card.js 上传到 /config/www/
   ```

2. **清除缓存**
   - iOS App：双击 Home 键，上滑关闭 App
   - 重新打开 Home Assistant App

3. **测试地图**
   - 打开包含卡片的仪表板
   - 应该能看到：
     - ✅ 完整的地图底图（道路、建筑等）
     - ✅ 蓝色的路线
     - ✅ 起点和终点标记
   - 测试地图缩放和拖动

4. **打开调试**
   - 连接 iOS 设备到 Mac
   - Safari → 开发 → [您的设备]
   - 查看 Web Inspector 的 Console
   - 应该看到：
     ```
     [AmapCommuteCard] 初始化地图，容器：...
     [AmapCommuteCard] 容器尺寸：320 x 180
     [AmapCommuteCard] 高德地图脚本加载成功
     [AmapCommuteCard] 移动设备检测：true iOS：true
     [AmapCommuteCard] 地图对象创建成功
     [AmapCommuteCard] 地图加载完成
     [AmapCommuteCard] 地图层添加完成，折线数：1 标记数：2
     [AmapCommuteCard] iOS 第一次尺寸刷新
     [AmapCommuteCard] iOS 第二次尺寸刷新
     [AmapCommuteCard] iOS 第三次尺寸刷新
     ```

---

## 🔍 调试日志说明

### v1.4.3 新增的日志

```
[AmapCommuteCard] iOS 设备，强制设置容器尺寸
```
- 确认检测到 iOS 设备
- 确认已强制设置容器尺寸

```
[AmapCommuteCard] 移动设备检测：true iOS：true
```
- 确认设备类型
- 确认 iOS 检测结果

```
[AmapCommuteCard] iOS 第一次尺寸刷新
[AmapCommuteCard] iOS 第二次尺寸刷新
[AmapCommuteCard] iOS 第三次尺寸刷新
```
- 确认多次刷新执行
- 每次刷新都应该成功

---

## 🎯 核心修复点

### 1. CSS 绝对定位
```css
position:absolute;
top:0;
left:0;
z-index:1;
```
**作用**：确保容器占满父元素，避免高度为 0

### 2. JavaScript 强制尺寸
```javascript
container.style.width = container.clientWidth + "px";
container.style.height = container.clientHeight + "px";
```
**作用**：使用具体像素值代替百分比，避免 iOS WebView 计算错误

### 3. 多次刷新
```javascript
setTimeout(() => { ... }, 100);
setTimeout(() => { ... }, 500);
setTimeout(() => { ... }, 1000);
```
**作用**：在多个时间点刷新，确保地图在各个阶段都能获取正确尺寸

### 4. iOS 特定优化
```css
-webkit-overflow-scrolling:touch;
```
**作用**：启用 iOS 原生滚动，提升 WebView 性能

---

## 📝 已知限制

### 1. 首次加载延迟
- **原因**：多次刷新导致地图初始化延迟约 1 秒
- **影响**：轻微，但确保地图正确显示
- **缓解**：显示加载提示

### 2. iOS 设备检测
- **方法**：`/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream`
- **局限**：无法识别所有 iOS 设备（如 iPadOS）
- **缓解**：如遇到问题，请手动添加 iOS 检测

---

## 🔮 后续优化方向

### 1. 更精确的 iOS 检测
```javascript
const isIOS = [
  'iPad Simulator',
  'iPhone Simulator',
  'iPod Simulator',
  'iPad',
  'iPhone',
  'iPod'
].includes(navigator.platform)
|| (navigator.userAgent.includes("Mac") && "ontouchend" in document);
```

### 2. 减少刷新次数
- 使用 `requestAnimationFrame` 代替 `setTimeout`
- 监听 DOM 更新事件

### 3. 添加 iOS 特定样式
```css
@supports (-webkit-touch-callout: none) {
  /* iOS 特定样式 */
}
```

---

## 📞 问题反馈

如果 v1.4.3 仍然无法解决 iOS App 的问题，请提供：

1. **设备信息**
   - iOS 版本
   - Home Assistant App 版本
   - iPad 还是 iPhone

2. **调试日志**
   - 完整复制控制台中 `[AmapCommuteCard]` 开头的日志
   - 特别注意容器尺寸和 iOS 检测结果

3. **截图**
   - 卡片显示情况
   - Web Inspector 中的容器尺寸
   - Network 标签中的地图资源加载情况

---

**版本**：v1.4.3
**更新日期**：2026年3月16日
**修复状态**：✅ 针对 iOS WebView 优化
