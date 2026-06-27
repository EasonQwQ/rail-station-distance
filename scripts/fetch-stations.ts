#!/usr/bin/env tsx
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupByCity, load12306Stations } from '../src/stations.js';
import type { StationsByCityFile } from '../src/types.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'data/stations-by-city.json');

async function main() {
  const hsrOnly = !process.argv.includes('--all-stations');
  console.log('正在从 12306 拉取站名数据…');
  const stations = await load12306Stations();
  const cities = groupByCity(stations, hsrOnly);
  const multi = Object.entries(cities).filter(([, list]) => list.length >= 2);
  const payload: StationsByCityFile = {
    generatedAt: new Date().toISOString(),
    cityCount: multi.length,
    stationCount: multi.reduce((sum, [, list]) => sum + list.length, 0),
    cities: Object.fromEntries(multi),
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`已写入 ${outPath}`);
  console.log(`同城多站城市: ${payload.cityCount}，站点合计: ${payload.stationCount}`);
  console.log(`筛选模式: ${hsrOnly ? '高铁/客运导向' : '全部站点'}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
