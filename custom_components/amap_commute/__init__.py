"""高德通勤时间 - Home Assistant 自定义集成."""
from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from typing import Any

import aiohttp
import async_timeout

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import dt as dt_util

from .const import (
    DOMAIN,
    CONF_API_KEY,
    CONF_ORIGIN,
    CONF_DESTINATION,
    CONF_ORIGIN_NAME,
    CONF_DESTINATION_NAME,
    CONF_UPDATE_INTERVAL,
    CONF_ORIGIN_MODE,
    CONF_ORIGIN_ENTITY,
    MODE_ORIGIN_STATIC,
    MODE_ORIGIN_DEVICE_TRACKER,
    AMAP_DRIVING_URL,
    PEAK_INTERVALS,
    DEFAULT_PEAK_INTERVAL,
    DEFAULT_NORMAL_INTERVAL,
)
from .helpers import coordinates_string_from_state

_LOGGER = logging.getLogger(__name__)

PLATFORMS = ["sensor"]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """设置集成入口."""
    hass.data.setdefault(DOMAIN, {})

    # 清理旧配置中不再使用的 update_interval 字段（迁移到智能时段策略后废弃）
    if CONF_UPDATE_INTERVAL in entry.data:
        _LOGGER.info("检测到旧配置中的 update_interval 字段，已自动清理（现已采用智能时段策略）")
        data = {**entry.data}
        data.pop(CONF_UPDATE_INTERVAL, None)
        hass.config_entries.async_update_entry(entry, data=data)

    # 旧配置无 origin_mode 时视为固定坐标起点
    if CONF_ORIGIN_MODE not in entry.data:
        hass.config_entries.async_update_entry(
            entry,
            data={**entry.data, CONF_ORIGIN_MODE: MODE_ORIGIN_STATIC},
        )

    coordinator = AmapCommuteCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()

    hass.data[DOMAIN][entry.entry_id] = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # 注册更新监听
    entry.async_on_unload(entry.add_update_listener(async_update_options))

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """卸载集成."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)
    return unload_ok


async def async_update_options(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """处理选项更新."""
    await hass.config_entries.async_reload(entry.entry_id)


def _get_interval_minutes() -> int:
    """根据当前本地时间返回应使用的更新间隔（分钟）。

    规则：
    - 早高峰 07:00–09:00 → 5 分钟
    - 其他时段           → 30 分钟
    可在 const.PEAK_INTERVALS 中自由增减时段。
    """
    now = dt_util.now()
    h, m = now.hour, now.minute
    current_minutes = h * 60 + m
    for (sh, sm), (eh, em), interval in PEAK_INTERVALS:
        start = sh * 60 + sm
        end = eh * 60 + em
        if start <= current_minutes < end:
            _LOGGER.debug(
                "当前 %02d:%02d 处于高峰时段 %02d:%02d-%02d:%02d，使用 %d 分钟间隔",
                h, m, sh, sm, eh, em, interval,
            )
            return interval
    _LOGGER.debug("当前 %02d:%02d 为普通时段，使用 %d 分钟间隔", h, m, DEFAULT_NORMAL_INTERVAL)
    return DEFAULT_NORMAL_INTERVAL


class AmapCommuteCoordinator(DataUpdateCoordinator):
    """高德通勤数据协调器（智能时段更新）."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """初始化协调器，以当前时段决定首次更新间隔."""
        self.entry = entry
        self.api_key = entry.data[CONF_API_KEY]
        self.origin_name = entry.data.get(CONF_ORIGIN_NAME, "出发地")
        self.destination_name = entry.data.get(CONF_DESTINATION_NAME, "目的地")

        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(minutes=_get_interval_minutes()),
        )

    async def _async_update_data(self) -> dict:
        """从高德API获取通勤数据，并在返回前动态调整下次更新间隔."""
        try:
            async with async_timeout.timeout(15):
                result = await self._fetch_route_data()
        except asyncio.TimeoutError as err:
            raise UpdateFailed("请求高德API超时") from err
        except aiohttp.ClientError as err:
            raise UpdateFailed(f"网络请求错误: {err}") from err

        # 每次拉取完数据后，重新计算下次间隔
        new_interval = timedelta(minutes=_get_interval_minutes())
        if self.update_interval != new_interval:
            _LOGGER.info(
                "通勤时间间隔调整：%s → %s",
                self.update_interval,
                new_interval,
            )
            self.update_interval = new_interval

        return result

    def _resolve_origin_string(self) -> str:
        """当前起点坐标（固定配置或 device_tracker/person 最新经纬度）."""
        data = self.entry.data
        mode = data.get(CONF_ORIGIN_MODE, MODE_ORIGIN_STATIC)
        if mode != MODE_ORIGIN_DEVICE_TRACKER:
            return data[CONF_ORIGIN].strip()

        entity_id = (data.get(CONF_ORIGIN_ENTITY) or "").strip()
        if not entity_id:
            raise UpdateFailed("未配置出发地追踪实体")

        state = self.hass.states.get(entity_id)
        coord = coordinates_string_from_state(state)
        if coord is None:
            raise UpdateFailed(
                f"无法从 {entity_id} 读取经纬度，请确认设备已上报 GPS"
            )
        return coord

    async def _fetch_route_data(self) -> dict:
        """请求高德驾车路径规划API.

        strategy=10：高德推荐策略，会在 paths 中返回多条备选路线
        （包含速度最快、距离最短、躲避拥堵等），是 v3 接口获得多条
        路线结果的唯一正确方式；strategy=0 只返回单条路线。
        """
        origin_str = self._resolve_origin_string()
        dest_str = self.entry.data[CONF_DESTINATION].strip()

        params = {
            "key": self.api_key,
            "origin": origin_str,
            "destination": dest_str,
            "extensions": "all",
            "strategy": "10",  # 必须用 10，才能返回多条备选路线
            "output": "json",
        }

        session = async_get_clientsession(self.hass)
        async with session.get(AMAP_DRIVING_URL, params=params) as resp:
            if resp.status != 200:
                raise UpdateFailed(f"高德API返回HTTP {resp.status}")
            data = await resp.json()

        if data.get("status") != "1":
            info = data.get("info", "未知错误")
            infocode = data.get("infocode", "")
            raise UpdateFailed(f"高德API错误: {info} (code: {infocode})")

        route = data.get("route", {})
        paths = route.get("paths", [])
        if not paths:
            raise UpdateFailed("高德API未返回路径数据")

        all_routes = [
            self._parse_single_amap_path(idx, path)
            for idx, path in enumerate(paths[:3])
        ]

        # 默认展示第一条路线的关键字段（保持向后兼容）
        best = all_routes[0]
        data_entry = self.entry.data
        mode = data_entry.get(CONF_ORIGIN_MODE, MODE_ORIGIN_STATIC)
        out: dict[str, Any] = {
            # ── 当前路线关键字段（向后兼容） ──
            "duration_seconds": best["duration_seconds"],
            "duration_minutes": best["duration_minutes"],
            "distance_meters":  best["distance_meters"],
            "distance_km":      best["distance_km"],
            "origin":           origin_str,
            "destination":      dest_str,
            "origin_name":      self.origin_name,
            "destination_name": self.destination_name,
            "polyline":         best["polyline"],
            "tmcs":             best["tmcs"],
            "steps":            best["steps"],
            "traffic_lights":   best["traffic_lights"],
            "tolls":            best["tolls"],
            # ── 全部备选路线（供前端多路径切换） ──
            "all_routes":       all_routes,
            "origin_mode":      mode,
        }
        if mode == MODE_ORIGIN_DEVICE_TRACKER:
            eid = (data_entry.get(CONF_ORIGIN_ENTITY) or "").strip()
            if eid:
                out["origin_entity_id"] = eid
        return out

    def _parse_single_amap_path(self, idx: int, path: dict[str, Any]) -> dict[str, Any]:
        """将高德 API 单条 path 转为内部路线结构（含 polyline、路况分段、导航步骤）."""
        _LOGGER.debug(
            "路线 %d strategy=%r",
            idx,
            path.get("strategy"),
        )
        duration_seconds = int(path.get("duration", 0))
        distance_meters = int(path.get("distance", 0))

        polylines: list[list[float]] = []
        tmcs: list[dict[str, Any]] = []
        steps_data: list[dict[str, Any]] = []

        for step in path.get("steps", []):
            raw_polyline = step.get("polyline", "")
            if raw_polyline:
                polylines.extend(self._parse_polyline(raw_polyline))

            for tmc in step.get("tmcs", []):
                tmc_polyline = tmc.get("polyline", "")
                tmc_points = self._parse_polyline(tmc_polyline) if tmc_polyline else []
                tmcs.append({
                    "status": tmc.get("status", "未知"),
                    "distance": int(tmc.get("distance", 0)),
                    "polyline": tmc_points,
                })

            steps_data.append({
                "road": step.get("road", ""),
                "distance": int(step.get("distance", 0)),
                "instruction": step.get("instruction", ""),
            })

        route_label = f"推荐{idx + 1}"
        return {
            "index": idx,
            "label": route_label,
            "duration_seconds": duration_seconds,
            "duration_minutes": round(duration_seconds / 60, 1),
            "distance_meters": distance_meters,
            "distance_km": round(distance_meters / 1000, 2),
            "traffic_lights": int(path.get("traffic_lights", 0)),
            "tolls": int(path.get("tolls", 0)),
            "polyline": polylines,
            "tmcs": tmcs,
            "steps": steps_data,
        }

    @staticmethod
    def _parse_polyline(raw: str) -> list[list[float]]:
        """解析高德坐标串为 [[lng, lat], ...] 列表."""
        points = []
        for pair in raw.split(";"):
            pair = pair.strip()
            if "," in pair:
                try:
                    lng, lat = pair.split(",")
                    points.append([float(lng), float(lat)])
                except ValueError:
                    continue
        return points
