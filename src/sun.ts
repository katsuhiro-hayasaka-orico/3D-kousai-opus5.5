/**
 * 太陽位置（NOAA 簡易式）。麹町（北緯 35.685°, 東経 139.733°）、日本標準時。
 * 返り値の方位は北から時計回り（度）、高度は度。
 */
export function sunPosition(date: Date, lat = 35.685, lon = 139.733): { azimuth: number; elevation: number } {
  const rad = Math.PI / 180;
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = (gmst * 15 + lon) * rad;
  const ha = lst - ra;
  const phi = lat * rad;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return { azimuth: ((az / rad) + 360) % 360, elevation: el / rad };
}

/** 日本時間の年月日・時刻から Date を作る */
export function jst(y: number, m: number, d: number, hours: number): Date {
  const h = Math.floor(hours);
  const mi = Math.round((hours - h) * 60);
  return new Date(Date.UTC(y, m - 1, d, h - 9, mi));
}
