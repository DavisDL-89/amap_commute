"""常量定义."""

DOMAIN = "amap_commute"

# 配置项 Key
CONF_API_KEY = "api_key"
CONF_ORIGIN = "origin"
CONF_DESTINATION = "destination"
CONF_ORIGIN_NAME = "origin_name"
CONF_DESTINATION_NAME = "destination_name"
CONF_UPDATE_INTERVAL = "update_interval"

# 默认值（已废弃手动设置间隔，改为自动时段策略）
DEFAULT_UPDATE_INTERVAL = 5  # 保留兼容，实际不使用
DEFAULT_ORIGIN_NAME = "出发地"
DEFAULT_DESTINATION_NAME = "目的地"

# 智能更新间隔策略
# 早高峰 07:00-09:00 → 每 5 分钟
# 其他时段         → 每 30 分钟
PEAK_INTERVALS: list[tuple[tuple[int, int], tuple[int, int], int]] = [
    ((7, 0), (9, 0), 5),    # 早高峰：07:00-09:00，5 分钟
]
DEFAULT_PEAK_INTERVAL = 5    # 高峰期更新间隔（分钟）
DEFAULT_NORMAL_INTERVAL = 30  # 普通时段更新间隔（分钟）

# 高德 API
AMAP_DRIVING_URL = "https://restapi.amap.com/v3/direction/driving"
AMAP_GEO_URL = "https://restapi.amap.com/v3/geocode/geo"

# 路况状态 -> 颜色映射
TRAFFIC_STATUS_COLORS = {
    "畅通": "#00C851",
    "缓行": "#FF8800",
    "拥堵": "#FF4444",
    "严重拥堵": "#CC0000",
    "未知": "#9E9E9E",
}

# 传感器属性
ATTR_DURATION_MINUTES = "duration_minutes"
ATTR_DISTANCE_KM = "distance_km"
ATTR_ORIGIN = "origin"
ATTR_DESTINATION = "destination"
ATTR_ORIGIN_NAME = "origin_name"
ATTR_DESTINATION_NAME = "destination_name"
ATTR_POLYLINE = "polyline"
ATTR_TMCS = "tmcs"
ATTR_TRAFFIC_LIGHTS = "traffic_lights"
ATTR_TOLLS = "tolls"
