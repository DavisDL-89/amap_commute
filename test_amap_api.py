"""高德路径规划测试脚本.

测试坐标：
- 起点：109.043635,34.231694
- 终点：109.016775,34.185509

使用方法：
python test_amap_api.py
"""
import json
import asyncio
import aiohttp
from datetime import datetime


async def test_amap_driving(api_key: str, strategy: int = 10):
    """测试高德驾车路径规划 API."""

    # 测试坐标
    origin = "109.043635,34.231694"
    destination = "109.016775,34.185509"

    # API URL
    url = "https://restapi.amap.com/v3/direction/driving"

    # 请求参数
    params = {
        "key": api_key,
        "origin": origin,
        "destination": destination,
        "strategy": str(strategy),  # 10 = 默认推荐（多路径）
        "extensions": "all",  # 返回详细信息
        "output": "json",
    }

    print("=" * 80)
    print("高德驾车路径规划 API 测试")
    print("=" * 80)
    print(f"起点坐标: {origin}")
    print(f"终点坐标: {destination}")
    print(f"策略参数: {strategy} (默认推荐 - 多路径)")
    print(f"测试时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 80)
    print()

    async with aiohttp.ClientSession() as session:
        async with session.get(url, params=params) as resp:
            if resp.status != 200:
                print(f"❌ HTTP 错误: {resp.status}")
                return

            data = await resp.json()

            # 检查 API 响应状态
            if data.get("status") != "1":
                info = data.get("info", "未知错误")
                infocode = data.get("infocode", "")
                print(f"❌ API 错误: {info} (code: {infocode})")
                print(f"   原始响应: {json.dumps(data, ensure_ascii=False, indent=2)}")
                return

            # 解析返回数据
            route = data.get("route", {})
            paths = route.get("paths", [])

            if not paths:
                print("❌ 高德 API 未返回路径数据")
                return

            # 显示路径数量
            print(f"✅ 成功返回 {len(paths)} 条路径")
            print()

            # 详细显示每条路径的信息
            for idx, path in enumerate(paths):
                print(f"{'─' * 80}")
                print(f"路径 {idx + 1}")
                print(f"{'─' * 80}")

                # 获取 strategy 值（关键信息）
                raw_strategy = path.get("strategy", -1)
                print(f"📍 Strategy 原始值: {raw_strategy} (类型: {type(raw_strategy).__name__})")

                # 尝试转换为数字
                try:
                    path_strategy = int(raw_strategy)
                    print(f"   Strategy 数字值: {path_strategy}")
                except (ValueError, TypeError):
                    print(f"   Strategy 字符串值: '{raw_strategy}'")

                print()

                # 其他路径信息
                duration_seconds = int(path.get("duration", 0))
                distance_meters = int(path.get("distance", 0))

                print(f"⏱️  预计用时: {duration_seconds // 60} 分钟 {duration_seconds % 60} 秒")
                print(f"📏 总距离: {distance_meters / 1000:.2f} 公里")
                print(f"🚦 红绿灯: {path.get('traffic_lights', 0)} 个")
                print(f"💰 收费: {path.get('tolls', 0)} 元")
                print(f"🛣️  路段数: {len(path.get('steps', []))} 个")

                # 路况统计
                tmcs = path.get("tmcs", [])
                if tmcs:
                    print(f"🚗 路况分段: {len(tmcs)} 段")

                    # 统计各路况状态
                    status_count = {}
                    for tmc in tmcs:
                        status = tmc.get("status", "未知")
                        status_count[status] = status_count.get(status, 0) + 1

                    print(f"   路况统计:")
                    for status, count in status_count.items():
                        distance = sum(t.get("distance", 0) for t in tmcs if t.get("status") == status)
                        print(f"   - {status}: {count} 段, {distance / 1000:.2f} 公里")

                print()

                # 前3个路段示例
                steps = path.get("steps", [])
                if steps:
                    print(f"📝 前3个路段:")
                    for i, step in enumerate(steps[:3]):
                        road = step.get("road", "无名路")
                        distance = step.get("distance", 0)
                        instruction = step.get("instruction", "")
                        print(f"   {i + 1}. {road} - {distance} 米")
                        if instruction:
                            print(f"      {instruction}")
                    if len(steps) > 3:
                        print(f"   ... 还有 {len(steps) - 3} 个路段")

                print()

            # 策略对照表
            print("=" * 80)
            print("策略对照表（高德 API v3 多路径策略）")
            print("=" * 80)
            strategy_labels = {
                10: "默认推荐（躲避拥堵、路程较短、时间最短）",
                11: "时间最短（包含时间最短、距离最短、躲避拥堵三个结果）",
                12: "躲避拥堵",
                13: "不走高速",
                14: "避免收费",
                15: "躲避拥堵且不走高速",
                16: "避免收费且不走高速",
                17: "躲避拥堵且避免收费",
                18: "躲避拥堵且避免收费且不走高速",
                19: "高速优先",
                20: "躲避拥堵且高速优先",
            }

            for idx, path in enumerate(paths):
                raw_strategy = path.get("strategy", -1)
                try:
                    path_strategy = int(raw_strategy)
                except (ValueError, TypeError):
                    path_strategy = -1

                label = strategy_labels.get(path_strategy, "未知策略")
                print(f"路径 {idx + 1}: Strategy={raw_strategy} → {label}")

            print("=" * 80)

            # 保存完整响应到文件
            output_file = "amap_api_response.json"
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"💾 完整 API 响应已保存到: {output_file}")
            print()


async def main():
    """主函数."""
    api_key = "7c1d9e06bf08bd2c6f06d52e6435b521"
    await test_amap_driving(api_key)


if __name__ == "__main__":
    asyncio.run(main())
