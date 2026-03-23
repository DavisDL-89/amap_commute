"""Config Flow - UI 配置向导."""
from __future__ import annotations

import re
from typing import Any

import aiohttp
import async_timeout
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers import selector

from .const import (
    DOMAIN,
    CONF_API_KEY,
    CONF_ORIGIN,
    CONF_DESTINATION,
    CONF_ORIGIN_NAME,
    CONF_DESTINATION_NAME,
    CONF_USE_MOBILE_ORIGIN,
    CONF_MOBILE_TRACKER_ENTITY,
    CONF_ORIGIN_MODE,
    ORIGIN_MODE_MANUAL,
    ORIGIN_MODE_MOBILE,
    DEFAULT_ORIGIN_NAME,
    DEFAULT_DESTINATION_NAME,
    AMAP_DRIVING_URL,
    DEFAULT_PEAK_INTERVAL,
    DEFAULT_NORMAL_INTERVAL,
)

# 坐标格式验证：经度,纬度
COORD_PATTERN = re.compile(
    r"^-?(?:1[0-7]\d|[1-9]\d|\d)\.\d+,-?(?:[1-8]\d|\d)\.\d+$"
)


def _validate_coord(value: str) -> str:
    """验证坐标格式."""
    value = value.strip()
    if not COORD_PATTERN.match(value):
        raise vol.Invalid(
            "坐标格式错误，请输入：经度,纬度（例如：116.397428,39.90923）"
        )
    return value


async def _validate_api_key(hass, api_key: str, origin: str, destination: str) -> str | None:
    """验证高德API Key是否可用，返回错误信息或None."""
    try:
        params = {
            "key": api_key,
            "origin": origin,
            "destination": destination,
            "extensions": "base",
            "output": "json",
        }
        session = async_get_clientsession(hass)
        async with async_timeout.timeout(10):
            async with session.get(AMAP_DRIVING_URL, params=params) as resp:
                data = await resp.json()
                if data.get("status") != "1":
                    infocode = data.get("infocode", "")
                    if infocode in ("10001", "10002", "10003", "10005"):
                        return "invalid_api_key"
                    return "api_error"
    except (aiohttp.ClientError, TimeoutError, ValueError):
        return "cannot_connect"
    return None


def _build_unique_id(data: dict[str, Any]) -> str:
    """构建配置唯一ID."""
    mode = data.get(CONF_ORIGIN_MODE)
    use_mobile = mode == ORIGIN_MODE_MOBILE or bool(data.get(CONF_USE_MOBILE_ORIGIN))
    destination = data.get(CONF_DESTINATION, "").strip()
    if use_mobile:
        mobile_entity = data.get(CONF_MOBILE_TRACKER_ENTITY, "").strip()
        return f"mobile:{mobile_entity}->{destination}"
    origin = data.get(CONF_ORIGIN, "").strip()
    return f"manual:{origin}->{destination}"


def _get_origin_mode(data: dict[str, Any]) -> str:
    """从配置数据中读取出发地模式（兼容旧字段）."""
    if data.get(CONF_ORIGIN_MODE) in (ORIGIN_MODE_MANUAL, ORIGIN_MODE_MOBILE):
        return data[CONF_ORIGIN_MODE]
    return ORIGIN_MODE_MOBILE if data.get(CONF_USE_MOBILE_ORIGIN) else ORIGIN_MODE_MANUAL


class AmapCommuteConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """高德通勤集成配置流程."""

    VERSION = 1

    def __init__(self) -> None:
        """初始化配置流程状态."""
        self._user_mode = ORIGIN_MODE_MANUAL
        self._base_user_input: dict[str, Any] = {}

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """第一步：基础信息 + 出发地模式."""
        errors: dict[str, str] = {}
        schema = vol.Schema(
            {
                vol.Required(CONF_API_KEY): str,
                vol.Required(CONF_ORIGIN_MODE, default=ORIGIN_MODE_MANUAL): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=[
                            selector.SelectOptionDict(value=ORIGIN_MODE_MANUAL, label="手动"),
                            selector.SelectOptionDict(value=ORIGIN_MODE_MOBILE, label="手机GPS定位"),
                        ],
                        mode=selector.SelectSelectorMode.LIST,
                    )
                ),
            }
        )

        if user_input is not None:
            self._base_user_input = dict(user_input)
            self._user_mode = user_input.get(CONF_ORIGIN_MODE, ORIGIN_MODE_MANUAL)
            if self._user_mode == ORIGIN_MODE_MOBILE:
                return await self.async_step_mobile_origin()
            return await self.async_step_manual_origin()

        return self.async_show_form(
            step_id="user",
            data_schema=schema,
            errors=errors,
            description_placeholders={
                "coord_example": "116.397428,39.90923",
                "peak_interval": str(DEFAULT_PEAK_INTERVAL),
                "normal_interval": str(DEFAULT_NORMAL_INTERVAL),
            },
        )

    async def async_step_manual_origin(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """第二步（手动）：填写出发地坐标."""
        errors: dict[str, str] = {}
        schema = vol.Schema(
            {
                vol.Required(CONF_ORIGIN): str,
                vol.Optional(CONF_ORIGIN_NAME, default=DEFAULT_ORIGIN_NAME): str,
                vol.Required(CONF_DESTINATION): str,
                vol.Optional(CONF_DESTINATION_NAME, default=DEFAULT_DESTINATION_NAME): str,
            }
        )
        if user_input is not None:
            try:
                _validate_coord(user_input[CONF_ORIGIN])
                _validate_coord(user_input[CONF_DESTINATION])
            except vol.Invalid:
                errors["base"] = "invalid_coord"
            else:
                final_data = {**self._base_user_input, **user_input}
                final_data[CONF_USE_MOBILE_ORIGIN] = False
                final_data[CONF_MOBILE_TRACKER_ENTITY] = ""
                route_unique_id = _build_unique_id(final_data)
                await self.async_set_unique_id(route_unique_id)
                self._abort_if_unique_id_configured()
                error = await _validate_api_key(
                    self.hass,
                    final_data[CONF_API_KEY],
                    final_data[CONF_ORIGIN],
                    final_data[CONF_DESTINATION],
                )
                if error:
                    errors["base"] = error
                else:
                    title = (
                        f"{final_data.get(CONF_ORIGIN_NAME, DEFAULT_ORIGIN_NAME)}"
                        f" → "
                        f"{final_data.get(CONF_DESTINATION_NAME, DEFAULT_DESTINATION_NAME)}"
                    )
                    return self.async_create_entry(title=title, data=final_data)

        return self.async_show_form(step_id="manual_origin", data_schema=schema, errors=errors)

    async def async_step_mobile_origin(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """第二步（手机）：选择 HA 实体."""
        errors: dict[str, str] = {}
        schema = vol.Schema(
            {
                vol.Required(CONF_MOBILE_TRACKER_ENTITY): selector.EntitySelector(
                    selector.EntitySelectorConfig()
                ),
                vol.Optional(CONF_ORIGIN_NAME, default=DEFAULT_ORIGIN_NAME): str,
                vol.Required(CONF_DESTINATION): str,
                vol.Optional(CONF_DESTINATION_NAME, default=DEFAULT_DESTINATION_NAME): str,
            }
        )
        if user_input is not None:
            tracker_entity = user_input.get(CONF_MOBILE_TRACKER_ENTITY)
            tracker_state = self.hass.states.get(tracker_entity) if tracker_entity else None
            if not tracker_entity or tracker_state is None:
                errors["base"] = "invalid_mobile_entity"
            else:
                lat = tracker_state.attributes.get("latitude")
                lon = tracker_state.attributes.get("longitude")
                if lat is None or lon is None:
                    errors["base"] = "invalid_mobile_entity_state"
                else:
                    try:
                        _validate_coord(user_input[CONF_DESTINATION])
                    except vol.Invalid:
                        errors["base"] = "invalid_coord"
                    else:
                        final_data = {**self._base_user_input, **user_input}
                        final_data[CONF_USE_MOBILE_ORIGIN] = True
                        final_data[CONF_ORIGIN] = f"{float(lon):.6f},{float(lat):.6f}"
                        route_unique_id = _build_unique_id(final_data)
                        await self.async_set_unique_id(route_unique_id)
                        self._abort_if_unique_id_configured()
                        error = await _validate_api_key(
                            self.hass,
                            final_data[CONF_API_KEY],
                            final_data[CONF_ORIGIN],
                            final_data[CONF_DESTINATION],
                        )
                        if error:
                            errors["base"] = error
                        else:
                            title = (
                                f"{final_data.get(CONF_ORIGIN_NAME, DEFAULT_ORIGIN_NAME)}"
                                f" → "
                                f"{final_data.get(CONF_DESTINATION_NAME, DEFAULT_DESTINATION_NAME)}"
                            )
                            return self.async_create_entry(title=title, data=final_data)

        return self.async_show_form(step_id="mobile_origin", data_schema=schema, errors=errors)

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> AmapCommuteOptionsFlow:
        """返回选项流程."""
        return AmapCommuteOptionsFlow(config_entry)


class AmapCommuteOptionsFlow(config_entries.OptionsFlow):
    """高德通勤选项流程（用于修改已有配置）."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        """初始化."""
        self.config_entry = config_entry
        self._mode = _get_origin_mode(config_entry.data)
        self._base_options_input: dict[str, Any] = {}

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """选项第一步：基础信息 + 出发地模式."""
        errors: dict[str, str] = {}
        current = self.config_entry.data
        mode = _get_origin_mode(current)
        schema = vol.Schema(
            {
                vol.Required(
                    CONF_ORIGIN_MODE,
                    default=mode,
                ): selector.SelectSelector(
                    selector.SelectSelectorConfig(
                        options=[
                            selector.SelectOptionDict(value=ORIGIN_MODE_MANUAL, label="手动"),
                            selector.SelectOptionDict(value=ORIGIN_MODE_MOBILE, label="手机GPS定位"),
                        ],
                        mode=selector.SelectSelectorMode.LIST,
                    )
                ),
            }
        )

        if user_input is not None:
            self._base_options_input = dict(user_input)
            self._mode = user_input.get(CONF_ORIGIN_MODE, mode)
            if self._mode == ORIGIN_MODE_MOBILE:
                return await self.async_step_options_mobile_origin()
            return await self.async_step_options_manual_origin()

        return self.async_show_form(
            step_id="init",
            data_schema=schema,
            errors=errors,
            description_placeholders={
                "peak_interval": str(DEFAULT_PEAK_INTERVAL),
                "normal_interval": str(DEFAULT_NORMAL_INTERVAL),
            },
        )

    async def async_step_options_manual_origin(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """选项第二步（手动）：填写出发地坐标."""
        errors: dict[str, str] = {}
        schema = vol.Schema(
            {
                vol.Required(CONF_ORIGIN, default=self.config_entry.data.get(CONF_ORIGIN, "")): str,
                vol.Optional(
                    CONF_ORIGIN_NAME,
                    default=self.config_entry.data.get(CONF_ORIGIN_NAME, DEFAULT_ORIGIN_NAME),
                ): str,
                vol.Required(
                    CONF_DESTINATION,
                    default=self.config_entry.data.get(CONF_DESTINATION, ""),
                ): str,
                vol.Optional(
                    CONF_DESTINATION_NAME,
                    default=self.config_entry.data.get(CONF_DESTINATION_NAME, DEFAULT_DESTINATION_NAME),
                ): str,
            }
        )
        if user_input is not None:
            try:
                _validate_coord(user_input[CONF_ORIGIN])
                _validate_coord(user_input[CONF_DESTINATION])
            except vol.Invalid:
                errors["base"] = "invalid_coord"
            else:
                new_data = {**self.config_entry.data, **self._base_options_input, **user_input}
                new_data[CONF_USE_MOBILE_ORIGIN] = False
                new_data[CONF_MOBILE_TRACKER_ENTITY] = ""
                self.hass.config_entries.async_update_entry(self.config_entry, data=new_data)
                return self.async_create_entry(title="", data={})
        return self.async_show_form(step_id="options_manual_origin", data_schema=schema, errors=errors)

    async def async_step_options_mobile_origin(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """选项第二步（手机）：选择 HA 实体."""
        errors: dict[str, str] = {}
        schema = vol.Schema(
            {
                vol.Required(
                    CONF_MOBILE_TRACKER_ENTITY,
                    default=self.config_entry.data.get(CONF_MOBILE_TRACKER_ENTITY, ""),
                ): selector.EntitySelector(selector.EntitySelectorConfig()),
                vol.Optional(
                    CONF_ORIGIN_NAME,
                    default=self.config_entry.data.get(CONF_ORIGIN_NAME, DEFAULT_ORIGIN_NAME),
                ): str,
                vol.Required(
                    CONF_DESTINATION,
                    default=self.config_entry.data.get(CONF_DESTINATION, ""),
                ): str,
                vol.Optional(
                    CONF_DESTINATION_NAME,
                    default=self.config_entry.data.get(CONF_DESTINATION_NAME, DEFAULT_DESTINATION_NAME),
                ): str,
            }
        )
        if user_input is not None:
            tracker_entity = user_input.get(CONF_MOBILE_TRACKER_ENTITY)
            tracker_state = self.hass.states.get(tracker_entity) if tracker_entity else None
            if not tracker_entity or tracker_state is None:
                errors["base"] = "invalid_mobile_entity"
            else:
                lat = tracker_state.attributes.get("latitude")
                lon = tracker_state.attributes.get("longitude")
                if lat is None or lon is None:
                    errors["base"] = "invalid_mobile_entity_state"
                else:
                    try:
                        _validate_coord(user_input[CONF_DESTINATION])
                    except vol.Invalid:
                        errors["base"] = "invalid_coord"
                    else:
                        new_data = {**self.config_entry.data, **self._base_options_input, **user_input}
                        new_data[CONF_USE_MOBILE_ORIGIN] = True
                        new_data[CONF_ORIGIN] = f"{float(lon):.6f},{float(lat):.6f}"
                        self.hass.config_entries.async_update_entry(self.config_entry, data=new_data)
                        return self.async_create_entry(title="", data={})
        return self.async_show_form(step_id="options_mobile_origin", data_schema=schema, errors=errors)
