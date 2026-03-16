"""简单的高德API测试"""
import urllib.request
import json

# API 参数
api_key = "7c1d9e06bf08bd2c6f06d52e6435b521"
origin = "109.043635,34.231694"
destination = "109.016775,34.185509"

# 构建URL
url = f"https://restapi.amap.com/v3/direction/driving?key={api_key}&origin={origin}&destination={destination}&strategy=10&extensions=all&output=json"

print("=" * 80)
print("高德驾车路径规划 API 测试")
print("=" * 80)
print(f"起点坐标: {origin}")
print(f"终点坐标: {destination}")
print("=" * 80)
print()

try:
    # 发送请求
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode('utf-8'))

    # 检查状态
    if data.get("status") != "1":
        print(f"API 错误: {data.get('info')} (code: {data.get('infocode')})")
        exit(1)

    # 解析路径
    route = data.get("route", {})
    paths = route.get("paths", [])

    print(f"成功返回 {len(paths)} 条路径")
    print()

    # 策略对照表
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

    # 显示每条路径
    for idx, path in enumerate(paths):
        print("-" * 80)
        print(f"路径 {idx + 1}")
        print("-" * 80)

        # Strategy 值（关键）
        raw_strategy = path.get("strategy", -1)
        print(f"Strategy 原始值: {raw_strategy} (类型: {type(raw_strategy).__name__})")

        # 尝试转换为数字
        try:
            path_strategy = int(raw_strategy)
            print(f"Strategy 数字值: {path_strategy}")
            label = strategy_labels.get(path_strategy, "未知策略")
            print(f"策略说明: {label}")
        except (ValueError, TypeError):
            print(f"Strategy 字符串值: '{raw_strategy}'")

        # 其他信息
        duration_seconds = int(path.get("duration", 0))
        distance_meters = int(path.get("distance", 0))

        minutes = duration_seconds // 60
        seconds = duration_seconds % 60

        print(f"预计用时: {minutes} 分钟 {seconds} 秒")
        print(f"总距离: {distance_meters / 1000:.2f} 公里")
        print(f"红绿灯: {path.get('traffic_lights', 0)} 个")
        print(f"收费: {path.get('tolls', 0)} 元")
        print(f"路段数: {len(path.get('steps', []))} 个")
        print()

    # 总结
    print("=" * 80)
    print("策略对照总结")
    print("=" * 80)
    for idx, path in enumerate(paths):
        raw_strategy = path.get("strategy", -1)
        try:
            path_strategy = int(raw_strategy)
            label = strategy_labels.get(path_strategy, "未知策略")
        except (ValueError, TypeError):
            path_strategy = -1
            label = f"未知策略（字符串: '{raw_strategy}'）"
        print(f"路径 {idx + 1}: Strategy={raw_strategy} → {label}")
    print("=" * 80)

    # 保存完整响应
    with open("amap_api_response.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print("完整 API 响应已保存到: amap_api_response.json")

except Exception as e:
    print(f"请求失败: {e}")
    import traceback
    traceback.print_exc()
