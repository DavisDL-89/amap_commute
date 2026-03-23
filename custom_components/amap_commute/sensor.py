"""传感器实体 - 通勤时间."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.sensor import (
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import AmapCommuteCoordinator
from .const import (
    DOMAIN,
    ATTR_DURATION_MINUTES,
    ATTR_DISTANCE_KM,
    ATTR_ORIGIN,
    ATTR_DESTINATION,
    ATTR_ORIGIN_NAME,
    ATTR_DESTINATION_NAME,
    ATTR_POLYLINE,
    ATTR_TMCS,
    ATTR_TRAFFIC_LIGHTS,
    ATTR_TOLLS,
    TRAFFIC_STATUS_COLORS,
)

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """设置传感器."""
    coordinator: AmapCommuteCoordinator = hass.data[DOMAIN][entry.entry_id]

    # 根据返回的路线数量创建对应数量的传感器实体（最多 3 条）
    data = coordinator.data
    if data is None or not data.get("all_routes"):
        # 数据未就绪时先创建默认传感器（路线 0）
        async_add_entities([AmapCommuteSensor(coordinator, entry, route_index=0)])
        return

    all_routes = data.get("all_routes", [])
    entities = []
    for route in all_routes:
        route_index = route["index"]
        route_label = route.get("label", "")
        entities.append(AmapCommuteSensor(coordinator, entry, route_index=route_index, route_label=route_label))

    async_add_entities(entities)


class AmapCommuteSensor(CoordinatorEntity, SensorEntity):
    """高德通勤时间传感器（支持多路线）."""

    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "分钟"
    _attr_icon = "mdi:map-marker-path"

    def __init__(
        self,
        coordinator: AmapCommuteCoordinator,
        entry: ConfigEntry,
        route_index: int = 0,
        route_label: str | None = None,
    ) -> None:
        """初始化传感器.

        Args:
            coordinator: 数据协调器
            entry: 配置条目
            route_index: 路线索引（0=推荐路线, 1=第二条, 2=第三条）
            route_label: 路线标签（如"推荐路线"、"时间最短"），数据加载后传入
        """
        super().__init__(coordinator)
        self._entry = entry
        self._route_index = route_index
        self._attr_unique_id = f"{DOMAIN}_{entry.entry_id}_route_{route_index}"

        origin_name = coordinator.origin_name
        dest_name = coordinator.destination_name

        # 根据实际路线标签生成可读名称
        if route_label:
            # 有标签则用标签（如"推荐1"、"推荐2"、"推荐3"）
            # 第一条路线（推荐1）显示为"推荐路线"
            if route_index == 0 and "推荐" in route_label:
                # 第一条路线：显示为"推荐路线"而不是"推荐1"
                self._attr_name = f"通勤时间 {origin_name} → {dest_name} 推荐路线"
            else:
                # 其他路线：直接使用标签（推荐2、推荐3）
                self._attr_name = f"通勤时间 {origin_name} → {dest_name} {route_label}"
        else:
            # 降级到默认命名（数据未加载时）
            self._attr_name = f"通勤时间 {origin_name} → {dest_name}"

    @property
    def native_value(self) -> float | None:
        """返回通勤时间（分钟）."""
        data = self.coordinator.data
        if data is None:
            return None

        # 从 all_routes 中找到对应的路线
        all_routes = data.get("all_routes", [])
        for route in all_routes:
            if route["index"] == self._route_index:
                return route.get("duration_minutes")

        # 降级到单条路线模式（向后兼容）
        if self._route_index == 0:
            return data.get("duration_minutes")
        return None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """返回附加属性（供前端卡片使用）."""
        data = self.coordinator.data
        if data is None:
            return {}

        # 先从 all_routes 找到当前传感器对应的路线
        current_route = None
        all_routes = data.get("all_routes", [])
        for route in all_routes:
            if route["index"] == self._route_index:
                current_route = route
                break

        # 找不到则降级到单条路线模式（向后兼容）
        if current_route is None and self._route_index == 0:
            current_route = {
                "polyline": data.get("polyline", []),
                "tmcs": data.get("tmcs", []),
                "distance_km": data.get("distance_km"),
                "distance_meters": data.get("distance_meters"),
                "traffic_lights": data.get("traffic_lights", 0),
                "tolls": data.get("tolls", 0),
                "steps": data.get("steps", []),
                "duration_seconds": data.get("duration_seconds"),
                "duration_minutes": data.get("duration_minutes"),
            }

        if current_route is None:
            return {}

        # 构建当前路线的路况数据（带颜色）
        tmcs_with_color = []
        for tmc in current_route.get("tmcs", []):
            status = tmc.get("status", "未知")
            tmcs_with_color.append({
                "status": status,
                "color": TRAFFIC_STATUS_COLORS.get(status, "#9E9E9E"),
                "distance": tmc.get("distance", 0),
                "polyline": tmc.get("polyline", []),
            })

        # 为 all_routes 中的 tmcs 也补充颜色（保持前端多路径切换功能）
        all_routes_with_color = []
        for route in all_routes:
            route_tmcs = []
            for tmc in route.get("tmcs", []):
                status = tmc.get("status", "未知")
                route_tmcs.append({
                    **tmc,
                    "color": TRAFFIC_STATUS_COLORS.get(status, "#9E9E9E"),
                })
            all_routes_with_color.append({**route, "tmcs": route_tmcs})

        return {
            ATTR_DURATION_MINUTES: current_route.get("duration_minutes"),
            ATTR_DISTANCE_KM: current_route.get("distance_km"),
            ATTR_ORIGIN: data.get("origin"),
            ATTR_DESTINATION: data.get("destination"),
            ATTR_ORIGIN_NAME: data.get("origin_name"),
            ATTR_DESTINATION_NAME: data.get("destination_name"),
            ATTR_POLYLINE: current_route.get("polyline", []),
            ATTR_TMCS: tmcs_with_color,
            ATTR_TRAFFIC_LIGHTS: current_route.get("traffic_lights", 0),
            ATTR_TOLLS: current_route.get("tolls", 0),
            "steps": current_route.get("steps", []),
            "all_routes": all_routes_with_color,
            "duration_seconds": current_route.get("duration_seconds"),
            "distance_meters": current_route.get("distance_meters"),
            # 额外标注当前路线索引，方便前端卡片识别
            "route_index": self._route_index,
        }

    @property
    def available(self) -> bool:
        """传感器是否可用."""
        return self.coordinator.last_update_success
