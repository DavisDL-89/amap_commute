export function buildMapOverlays(AMap, map, attrs) {
  const polylines = [];
  const markers = [];
  const tmcs = attrs.tmcs || [];
  if (tmcs.length > 0) {
    tmcs.forEach((tmc) => {
      const pts = (tmc.polyline || []).map((p) => new AMap.LngLat(p[0], p[1]));
      if (pts.length < 2) return;
      polylines.push(new AMap.Polyline({
        path: pts,
        strokeColor: tmc.color || "#9E9E9E",
        strokeWeight: 6,
        strokeOpacity: 0.9,
        lineJoin: "round",
        lineCap: "round",
        zIndex: 50,
      }));
    });
  } else if ((attrs.polyline || []).length > 0) {
    polylines.push(new AMap.Polyline({
      path: attrs.polyline.map((p) => new AMap.LngLat(p[0], p[1])),
      strokeColor: "#2196F3",
      strokeWeight: 6,
      strokeOpacity: 0.85,
      lineJoin: "round",
      lineCap: "round",
      zIndex: 50,
    }));
  }
  [
    [attrs.origin, attrs.origin_name || "出发地", "https://webapi.amap.com/theme/v1.3/markers/n/start.png"],
    [attrs.destination, attrs.destination_name || "目的地", "https://webapi.amap.com/theme/v1.3/markers/n/end.png"],
  ].forEach(([coord, title, img]) => {
    if (!coord) return;
    const [lng, lat] = String(coord).split(",").map(Number);
    if (isNaN(lng) || isNaN(lat)) return;
    markers.push(new AMap.Marker({
      position: new AMap.LngLat(lng, lat),
      title,
      icon: new AMap.Icon({ size: new AMap.Size(25, 34), imageSize: new AMap.Size(25, 34), image: img }),
      offset: new AMap.Pixel(-12, -34),
      zIndex: 100,
    }));
  });
  map.add([...polylines, ...markers]);
  if (polylines.length || markers.length) {
    map.setFitView([...polylines, ...markers], false, [24, 24, 24, 24]);
  }
  return { polylines, markers };
}

export function clearMapOverlays(map, polylines, markers) {
  map.remove([...polylines, ...markers]);
}
