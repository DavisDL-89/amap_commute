"""从 HA 实体状态解析经纬度（高德 origin 格式：经度,纬度）."""

from __future__ import annotations

from homeassistant.core import State

# 用于配置向导中 API 试连：追踪器尚无 GPS 时的占位起点（上海附近）
FALLBACK_ORIGIN_FOR_API_TEST = "121.473701,31.230416"


def coordinates_string_from_state(state: State | None) -> str | None:
    """从 device_tracker / person 等状态解析出「经度,纬度」字符串；无则返回 None."""
    if state is None:
        return None
    lat = state.attributes.get("latitude")
    lng = state.attributes.get("longitude")
    if lat is None or lng is None:
        return None
    try:
        return f"{float(lng)},{float(lat)}"
    except (TypeError, ValueError):
        return None


def is_allowed_origin_entity_id(entity_id: str) -> bool:
    """仅允许从带经纬度的实体域作为动态起点."""
    if not entity_id or "." not in entity_id:
        return False
    domain = entity_id.split(".", 1)[0].lower()
    return domain in ("device_tracker", "person")
