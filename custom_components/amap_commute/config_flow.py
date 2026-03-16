"""Config Flow - UI 配置向导."""
from __future__ import annotations

import logging
import re
from typing import Any

import aiohttp
import async_timeout
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult

from .const import (
    DOMAIN,
    CONF_API_KEY,
    CONF_ORIGIN,
    CONF_DESTINATION,
    CONF_ORIGIN_NAME,
    CONF_DESTINATION_NAME,
    DEFAULT_ORIGIN_NAME,
    DEFAULT_DESTINATION_NAME,
    AMAP_DRIVING_URL,
    DEFAULT_PEAK_INTERVAL,
    DEFAULT_NORMAL_INTERVAL,
)

_LOGGER = logging.getLogger(__name__)

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


async def _validate_api_key(api_key: str, origin: str, destination: str) -> str | None:
    """验证高德API Key是否可用，返回错误信息或None."""
    try:
        params = {
            "key": api_key,
            "origin": origin,
            "destination": destination,
            "extensions": "base",
            "output": "json",
        }
        async with async_timeout.timeout(10):
            async with aiohttp.ClientSession() as session:
                async with session.get(AMAP_DRIVING_URL, params=params) as resp:
                    data = await resp.json()
                    if data.get("status") != "1":
                        info = data.get("info", "未知错误")
                        infocode = data.get("infocode", "")
                        if infocode in ("10001", "10002", "10003", "10005"):
                            return "invalid_api_key"
                        return "api_error"
    except Exception:  # noqa: BLE001
        return "cannot_connect"
    return None


class AmapCommuteConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """高德通勤集成配置流程."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """处理用户输入."""
        errors: dict[str, str] = {}

        if user_input is not None:
            # 验证坐标格式
            try:
                _validate_coord(user_input[CONF_ORIGIN])
                _validate_coord(user_input[CONF_DESTINATION])
            except vol.Invalid:
                errors["base"] = "invalid_coord"
            else:
                # 验证 API Key
                error = await _validate_api_key(
                    user_input[CONF_API_KEY],
                    user_input[CONF_ORIGIN],
                    user_input[CONF_DESTINATION],
                )
                if error:
                    errors["base"] = error
                else:
                    title = (
                        f"{user_input.get(CONF_ORIGIN_NAME, DEFAULT_ORIGIN_NAME)}"
                        f" → "
                        f"{user_input.get(CONF_DESTINATION_NAME, DEFAULT_DESTINATION_NAME)}"
                    )
                    return self.async_create_entry(title=title, data=user_input)

        schema = vol.Schema(
            {
                vol.Required(CONF_API_KEY): str,
                vol.Required(CONF_ORIGIN): str,
                vol.Required(CONF_DESTINATION): str,
                vol.Optional(CONF_ORIGIN_NAME, default=DEFAULT_ORIGIN_NAME): str,
                vol.Optional(
                    CONF_DESTINATION_NAME, default=DEFAULT_DESTINATION_NAME
                ): str,
            }
        )

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

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """选项入口."""
        errors: dict[str, str] = {}
        current = self.config_entry.data

        if user_input is not None:
            try:
                _validate_coord(user_input[CONF_ORIGIN])
                _validate_coord(user_input[CONF_DESTINATION])
            except vol.Invalid:
                errors["base"] = "invalid_coord"
            else:
                # 合并并重载
                new_data = {**current, **user_input}
                self.hass.config_entries.async_update_entry(
                    self.config_entry, data=new_data
                )
                return self.async_create_entry(title="", data={})

        schema = vol.Schema(
            {
                vol.Required(CONF_ORIGIN, default=current.get(CONF_ORIGIN, "")): str,
                vol.Required(
                    CONF_DESTINATION, default=current.get(CONF_DESTINATION, "")
                ): str,
                vol.Optional(
                    CONF_ORIGIN_NAME,
                    default=current.get(CONF_ORIGIN_NAME, DEFAULT_ORIGIN_NAME),
                ): str,
                vol.Optional(
                    CONF_DESTINATION_NAME,
                    default=current.get(
                        CONF_DESTINATION_NAME, DEFAULT_DESTINATION_NAME
                    ),
                ): str,
            }
        )

        return self.async_show_form(
            step_id="init",
            data_schema=schema,
            errors=errors,
            description_placeholders={
                "peak_interval": str(DEFAULT_PEAK_INTERVAL),
                "normal_interval": str(DEFAULT_NORMAL_INTERVAL),
            },
        )
