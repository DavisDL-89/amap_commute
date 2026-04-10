"""Config Flow - 符合 HA 习惯的分步配置.

- 添加集成：步骤 1 仅选择「出发地类型」；步骤 2 填写 API Key、目的地，
  并根据类型显示「固定经纬度」或「实体选择器」。
- 修改选项：单页 + 动态表单（随 origin_mode 切换字段），避免无关项堆叠。
"""
from __future__ import annotations

import logging
import re
from typing import Any

import async_timeout
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import HomeAssistant, callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import selector
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    DOMAIN,
    CONF_API_KEY,
    CONF_ORIGIN,
    CONF_DESTINATION,
    CONF_ORIGIN_NAME,
    CONF_DESTINATION_NAME,
    CONF_ORIGIN_MODE,
    CONF_ORIGIN_ENTITY,
    MODE_ORIGIN_STATIC,
    MODE_ORIGIN_DEVICE_TRACKER,
    DEFAULT_ORIGIN_NAME,
    DEFAULT_DESTINATION_NAME,
    AMAP_DRIVING_URL,
    DEFAULT_PEAK_INTERVAL,
    DEFAULT_NORMAL_INTERVAL,
)
from .helpers import (
    FALLBACK_ORIGIN_FOR_API_TEST,
    coordinates_string_from_state,
    is_allowed_origin_entity_id,
)

_LOGGER = logging.getLogger(__name__)


def _origin_entity_selector() -> selector.EntitySelector:
    """device_tracker / person 实体下拉。

    使用顶层 legacy ``domain``（列表），避免部分 HA 版本对 ``filter`` 元组/多段 filter 序列化异常导致第二步表单 400 / Unknown error。
    """
    return selector.EntitySelector(
        selector.EntitySelectorConfig(
            domain=["device_tracker", "person"],
        )
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


def _build_entry_data(user_input: dict[str, Any]) -> dict[str, Any]:
    """统一写入 config entry data（固定起点 / 追踪器起点互斥字段）."""
    mode = user_input[CONF_ORIGIN_MODE]
    data: dict[str, Any] = {
        CONF_API_KEY: user_input[CONF_API_KEY].strip(),
        CONF_ORIGIN_MODE: mode,
        CONF_DESTINATION: user_input[CONF_DESTINATION].strip(),
        CONF_ORIGIN_NAME: user_input.get(CONF_ORIGIN_NAME, DEFAULT_ORIGIN_NAME).strip()
        or DEFAULT_ORIGIN_NAME,
        CONF_DESTINATION_NAME: user_input.get(
            CONF_DESTINATION_NAME, DEFAULT_DESTINATION_NAME
        ).strip()
        or DEFAULT_DESTINATION_NAME,
    }
    if mode == MODE_ORIGIN_STATIC:
        data[CONF_ORIGIN] = user_input[CONF_ORIGIN].strip()
        data[CONF_ORIGIN_ENTITY] = ""
    else:
        ent = user_input.get(CONF_ORIGIN_ENTITY) or ""
        if isinstance(ent, list):
            ent = ent[0] if ent else ""
        data[CONF_ORIGIN_ENTITY] = str(ent).strip() if ent else ""
        data[CONF_ORIGIN] = ""
    return data


def _origin_mode_select_schema(default: str = MODE_ORIGIN_STATIC) -> vol.Schema:
    """出发地类型：使用 vol.In（与各版本 HA 前端兼容，避免 SelectSelector 序列化 400）。"""
    return vol.Schema(
        {
            vol.Required(CONF_ORIGIN_MODE, default=default): vol.In(
                [MODE_ORIGIN_STATIC, MODE_ORIGIN_DEVICE_TRACKER]
            ),
        }
    )


def _route_detail_schema(
    mode: str,
    defaults: dict[str, Any],
) -> vol.Schema:
    """第二步：API Key、目的地、名称 + 按模式切换起点字段."""
    fields: dict[vol.Marker, Any] = {
        vol.Required(
            CONF_API_KEY,
            default=defaults.get(CONF_API_KEY, ""),
        ): str,
        vol.Required(
            CONF_DESTINATION,
            default=defaults.get(CONF_DESTINATION, ""),
        ): str,
        vol.Optional(
            CONF_ORIGIN_NAME,
            default=defaults.get(CONF_ORIGIN_NAME, DEFAULT_ORIGIN_NAME),
        ): str,
        vol.Optional(
            CONF_DESTINATION_NAME,
            default=defaults.get(CONF_DESTINATION_NAME, DEFAULT_DESTINATION_NAME),
        ): str,
    }
    if mode == MODE_ORIGIN_STATIC:
        fields[
            vol.Required(CONF_ORIGIN, default=defaults.get(CONF_ORIGIN, ""))
        ] = str
    else:
        ent_sel = _origin_entity_selector()
        ent_def = defaults.get(CONF_ORIGIN_ENTITY)
        if ent_def:
            fields[vol.Required(CONF_ORIGIN_ENTITY, default=ent_def)] = ent_sel
        else:
            fields[vol.Required(CONF_ORIGIN_ENTITY)] = ent_sel

    return vol.Schema(fields)


def _options_schema(
    mode: str, current: dict[str, Any], last_input: dict[str, Any] | None
) -> vol.Schema:
    """修改选项：单页动态字段（无 API Key 字段，合并时从 current 带入）."""
    base_defaults = {**current, **(last_input or {})}
    resolved_mode = base_defaults.get(CONF_ORIGIN_MODE, mode)

    fields: dict[vol.Marker, Any] = {
        vol.Required(
            CONF_ORIGIN_MODE,
            default=resolved_mode,
        ): vol.In([MODE_ORIGIN_STATIC, MODE_ORIGIN_DEVICE_TRACKER]),
        vol.Required(
            CONF_DESTINATION,
            default=base_defaults.get(CONF_DESTINATION, ""),
        ): str,
        vol.Optional(
            CONF_ORIGIN_NAME,
            default=base_defaults.get(CONF_ORIGIN_NAME, DEFAULT_ORIGIN_NAME),
        ): str,
        vol.Optional(
            CONF_DESTINATION_NAME,
            default=base_defaults.get(CONF_DESTINATION_NAME, DEFAULT_DESTINATION_NAME),
        ): str,
    }
    if resolved_mode == MODE_ORIGIN_STATIC:
        fields[
            vol.Required(CONF_ORIGIN, default=base_defaults.get(CONF_ORIGIN, ""))
        ] = str
    else:
        ent_sel = _origin_entity_selector()
        ent_def = base_defaults.get(CONF_ORIGIN_ENTITY)
        if ent_def:
            fields[vol.Required(CONF_ORIGIN_ENTITY, default=ent_def)] = ent_sel
        else:
            fields[vol.Required(CONF_ORIGIN_ENTITY)] = ent_sel
    return vol.Schema(fields)


async def _validate_api_key(
    hass: HomeAssistant,
    api_key: str,
    origin: str,
    destination: str,
) -> str | None:
    """验证高德 API Key 是否可用，返回错误码或 None."""
    params = {
        "key": api_key,
        "origin": origin,
        "destination": destination,
        "extensions": "base",
        "output": "json",
    }
    try:
        async with async_timeout.timeout(10):
            session = async_get_clientsession(hass)
            async with session.get(AMAP_DRIVING_URL, params=params) as resp:
                data = await resp.json()
                if data.get("status") != "1":
                    infocode = data.get("infocode", "")
                    if infocode in ("10001", "10002", "10003", "10005"):
                        return "invalid_api_key"
                    return "api_error"
    except Exception:  # noqa: BLE001
        return "cannot_connect"
    return None


def _validate_route_inputs(
    hass: HomeAssistant,
    mode: str,
    user_input: dict[str, Any],
) -> dict[str, str]:
    """校验第二步 / 选项提交；返回 errors 字典."""
    errors: dict[str, str] = {}
    try:
        _validate_coord(user_input[CONF_DESTINATION])
    except vol.Invalid:
        errors["base"] = "invalid_coord"
        return errors

    if mode == MODE_ORIGIN_STATIC:
        try:
            _validate_coord(user_input[CONF_ORIGIN])
        except vol.Invalid:
            errors["base"] = "invalid_coord"
    else:
        raw_ent = user_input.get(CONF_ORIGIN_ENTITY)
        if isinstance(raw_ent, list):
            eid = (raw_ent[0] if raw_ent else "") or ""
        else:
            eid = str(raw_ent or "").strip()
        if not is_allowed_origin_entity_id(eid):
            errors["base"] = "invalid_entity"
        elif hass.states.get(eid) is None:
            errors["base"] = "unknown_entity"

    return errors


def _origin_for_api_test(
    hass: HomeAssistant,
    mode: str,
    user_input: dict[str, Any],
) -> str:
    """试连高德用的起点坐标."""
    if mode == MODE_ORIGIN_STATIC:
        return user_input[CONF_ORIGIN].strip()
    raw_ent = user_input.get(CONF_ORIGIN_ENTITY)
    if isinstance(raw_ent, list):
        eid = (raw_ent[0] if raw_ent else "") or ""
    else:
        eid = str(raw_ent or "").strip()
    st = hass.states.get(eid)
    return coordinates_string_from_state(st) or FALLBACK_ORIGIN_FOR_API_TEST


class AmapCommuteConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """高德通勤：先选出发地类型，再填写路线详情."""

    VERSION = 1

    def __init__(self) -> None:
        """多步流程中暂存用户选择的出发地类型."""
        super().__init__()
        self._origin_mode: str | None = None

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """步骤 1：仅选择出发地类型（与目的地拆分，避免单页混杂）。"""
        if user_input is not None:
            self._origin_mode = user_input[CONF_ORIGIN_MODE]
            return await self.async_step_route()

        return self.async_show_form(
            step_id="user",
            data_schema=_origin_mode_select_schema(),
            description_placeholders={
                "peak_interval": str(DEFAULT_PEAK_INTERVAL),
                "normal_interval": str(DEFAULT_NORMAL_INTERVAL),
            },
        )

    async def async_step_route(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """步骤 2：API Key、目的地、起点（坐标或实体）。"""
        if self._origin_mode is None:
            return await self.async_step_user()

        mode = self._origin_mode
        errors: dict[str, str] = {}
        defaults: dict[str, Any] = dict(user_input) if user_input else {}

        if user_input is not None:
            merged = {**user_input, CONF_ORIGIN_MODE: mode}
            errors = _validate_route_inputs(self.hass, mode, merged)
            if not errors:
                origin_for_api = _origin_for_api_test(self.hass, mode, merged)
                err = await _validate_api_key(
                    self.hass,
                    merged[CONF_API_KEY].strip(),
                    origin_for_api,
                    merged[CONF_DESTINATION].strip(),
                )
                if err:
                    errors["base"] = err
                else:
                    data = _build_entry_data(merged)
                    title = f"{data[CONF_ORIGIN_NAME]} → {data[CONF_DESTINATION_NAME]}"
                    return self.async_create_entry(title=title, data=data)

        schema = _route_detail_schema(mode, defaults)
        return self.async_show_form(
            step_id="route",
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
    """修改路线：单页动态 schema（出发地类型切换后字段随之变化）。"""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        """初始化."""
        self.config_entry = config_entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """选项入口."""
        errors: dict[str, str] = {}
        current = self.config_entry.data
        last_input = user_input

        mode_for_schema = current.get(CONF_ORIGIN_MODE, MODE_ORIGIN_STATIC)
        if user_input is not None:
            mode_for_schema = user_input.get(
                CONF_ORIGIN_MODE, mode_for_schema
            )

        if user_input is not None:
            merged = {**current, **user_input}
            mode = merged.get(CONF_ORIGIN_MODE, MODE_ORIGIN_STATIC)
            errors = _validate_route_inputs(self.hass, mode, merged)
            if not errors:
                new_data = _build_entry_data(merged)
                self.hass.config_entries.async_update_entry(
                    self.config_entry, data=new_data
                )
                return self.async_create_entry(title="", data={})

        schema = _options_schema(mode_for_schema, current, last_input)

        return self.async_show_form(
            step_id="init",
            data_schema=schema,
            errors=errors,
            description_placeholders={
                "peak_interval": str(DEFAULT_PEAK_INTERVAL),
                "normal_interval": str(DEFAULT_NORMAL_INTERVAL),
            },
        )
