import axios from 'axios';
import type { RawStation } from './types.js';

const STATION_KEYS: (keyof RawStation)[] = [
  'station_id',
  'station_name',
  'station_code',
  'station_pinyin',
  'station_short',
  'station_index',
  'code',
  'city',
  'r1',
  'r2',
];

const WEB_URL = 'https://www.12306.cn/index/';
const FALLBACK_JS = 'https://kyfw.12306.cn/otn/resources/js/framework/station_name.js';

function parseStationJs(rawJs: string): string {
  const match = rawJs.match(/var\s+station_names\s*=\s*'([\s\S]*)'\s*;?/);
  if (match?.[1]) {
    return match[1];
  }
  return rawJs.replace(/^var station_names\s*=\s*'/, '').replace(/';?\s*$/, '');
}

async function fetchStationRaw(): Promise<string> {
  const html = await axios.get<string>(WEB_URL, { timeout: 20_000 });
  const match = html.data.match(/(\/script\/core\/common\/station_name[^"']+\.js)/);
  if (match) {
    const jsUrl = new URL(match[1], WEB_URL).toString();
    const js = await axios.get<string>(jsUrl, { timeout: 20_000 });
    if (js.data.includes('station_names')) {
      return parseStationJs(js.data);
    }
  }
  const fallback = await axios.get<string>(FALLBACK_JS, { timeout: 20_000 });
  return parseStationJs(fallback.data);
}

export function parseStations(raw: string): RawStation[] {
  const chunks = raw.split('|');
  const list: RawStation[] = [];
  for (let i = 0; i < Math.floor(chunks.length / 10); i += 1) {
    const group = chunks.slice(i * 10, i * 10 + 10);
    const row = {} as RawStation;
    STATION_KEYS.forEach((key, index) => {
      row[key] = group[index] ?? '';
    });
    if (row.station_code) {
      list.push(row);
    }
  }
  return list;
}

/** 偏向高铁站/客运大站：名称含方位或「虹桥」等，或 r1/r2 标记含 G/D/C 能力（12306 编码） */
export function isHsrOrientedStation(station: RawStation): boolean {
  const name = station.station_name;
  if (/东|南|西|北|虹桥|金山|城际|高铁/.test(name)) {
    return true;
  }
  // 12306 r1/r2 部分版本表示停靠车次类型，含 G/D 视为高铁相关
  if (/[GDC]/i.test(`${station.r1}${station.r2}`)) {
    return true;
  }
  // 保留同城主站名与 city 完全一致的情况（如「嘉兴」「上海」）
  if (name === station.city || name === `${station.city}站`) {
    return true;
  }
  return false;
}

export function groupByCity(stations: RawStation[], hsrOnly = true): Record<string, RawStation[]> {
  const map: Record<string, RawStation[]> = {};
  for (const station of stations) {
    if (hsrOnly && !isHsrOrientedStation(station)) {
      continue;
    }
    const city = station.city.trim();
    if (!city) {
      continue;
    }
    if (!map[city]) {
      map[city] = [];
    }
    map[city].push(station);
  }
  for (const city of Object.keys(map)) {
    const dedup = new Map<string, RawStation>();
    map[city].forEach((s) => dedup.set(s.station_code, s));
    map[city] = [...dedup.values()].sort((a, b) => a.station_name.localeCompare(b.station_name, 'zh'));
  }
  return map;
}

export async function load12306Stations(): Promise<RawStation[]> {
  const raw = await fetchStationRaw();
  return parseStations(raw);
}
