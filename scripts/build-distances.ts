#!/usr/bin/env tsx
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AmapClient } from '../src/amap.js';
import type {
  CityDistanceBundle,
  DistanceDataset,
  GeocodeCache,
  StationPairDistance,
  StationPoint,
  StationsByCityFile,
} from '../src/types.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stationsPath = join(root, 'data/stations-by-city.json');
const geocodeCachePath = join(root, 'data/geocode-cache.json');
const progressPath = join(root, 'data/progress.json');
const outPath = join(root, 'data/output/intra-city-distances.json');

function parseArgs(): {
  cities: string[];
  minStations: number;
  limitCities?: number;
  full: boolean;
} {
  const cities: string[] = [];
  let minStations = 2;
  let limitCities: number | undefined;
  let full = false;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--city' && argv[i + 1]) {
      cities.push(argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--min-stations' && argv[i + 1]) {
      minStations = Number(argv[i + 1]) || 2;
      i += 1;
    } else if (argv[i] === '--limit-cities' && argv[i + 1]) {
      limitCities = Number(argv[i + 1]) || undefined;
      i += 1;
    } else if (argv[i] === '--full') {
      full = true;
    }
  }
  return { cities, minStations, limitCities, full };
}

function resolveMaxQps(): number {
  const fromEnv = process.env.AMAP_MAX_QPS?.trim();
  if (fromEnv) {
    const qps = Number(fromEnv);
    if (Number.isFinite(qps) && qps > 0) {
      return qps;
    }
  }
  const intervalMs = Number(process.env.AMAP_REQUEST_INTERVAL_MS);
  if (Number.isFinite(intervalMs) && intervalMs > 0) {
    return Math.max(1, Math.floor(1000 / intervalMs));
  }
  return 3;
}

function loadJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) {
    return fallback;
  }
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

async function geocodeCityStations(
  client: AmapClient,
  city: string,
  stations: StationsByCityFile['cities'][string],
  cache: GeocodeCache,
): Promise<StationPoint[]> {
  const points: StationPoint[] = [];
  for (const station of stations) {
    const geo = await client.geocodeStation(station.station_name, city, cache);
    if (!geo) {
      console.warn(`  ⚠ 无法地理编码: ${city} ${station.station_name}`);
      continue;
    }
    points.push({
      name: station.station_name,
      code: station.station_code,
      city,
      lng: geo.lng,
      lat: geo.lat,
    });
  }
  return points;
}

async function buildCityPairs(
  client: AmapClient,
  city: string,
  points: StationPoint[],
): Promise<StationPairDistance[]> {
  const pairs: StationPairDistance[] = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const a = points[i];
      const b = points[j];
      console.log(`  · ${a.name} ↔ ${b.name}`);
      const ab = await client.pairDuration(a, b, city);
      pairs.push({
        from: a.name,
        to: b.name,
        fromCode: a.code,
        toCode: b.code,
        straightLineMeters: ab.straightLineMeters,
        duration: ab.duration,
      });
      const ba = await client.pairDuration(b, a, city);
      pairs.push({
        from: b.name,
        to: a.name,
        fromCode: b.code,
        toCode: a.code,
        straightLineMeters: ba.straightLineMeters,
        duration: ba.duration,
      });
    }
  }
  return pairs;
}

async function main() {
  const key = process.env.AMAP_KEY?.trim();
  if (!key) {
    console.error('请配置 AMAP_KEY，复制 .env.example 为 .env 并填入高德 Web 服务 Key');
    process.exit(1);
  }
  if (!existsSync(stationsPath)) {
    console.error('请先运行: pnpm run build:stations');
    process.exit(1);
  }

  const { cities: cityFilter, minStations, limitCities, full } = parseArgs();
  const maxQps = resolveMaxQps();
  const stationsFile = loadJson<StationsByCityFile>(
    stationsPath,
    { generatedAt: '', cityCount: 0, stationCount: 0, cities: {} },
  );
  const cache = loadJson<GeocodeCache>(geocodeCachePath, {});
  const progress = loadJson<{ doneCities: string[] }>(progressPath, { doneCities: [] });
  const doneSet = new Set(progress.doneCities);

  let cityEntries = Object.entries(stationsFile.cities).filter(([, list]) => list.length >= minStations);
  if (cityFilter.length) {
    cityEntries = cityEntries.filter(([city]) => cityFilter.includes(city));
  }
  cityEntries = cityEntries.filter(([city]) => !doneSet.has(city));
  cityEntries.sort((a, b) => a[0].localeCompare(b[0], 'zh'));
  if (limitCities && !full) {
    cityEntries = cityEntries.slice(0, limitCities);
  }

  const client = new AmapClient(key, { maxQps });
  const existing = loadJson<DistanceDataset | null>(outPath, null);
  const bundles: CityDistanceBundle[] = existing?.cities ?? [];

  if (full) {
    console.log(`全量模式：待处理 ${cityEntries.length} 城，API 限速 ${maxQps} 次/秒（断点续跑已启用）`);
  } else {
    console.log(`待处理城市: ${cityEntries.length}，API 限速 ${maxQps} 次/秒`);
  }

  for (const [city, stations] of cityEntries) {
    console.log(`\n[${city}] ${stations.length} 站`);
    const points = await geocodeCityStations(client, city, stations, cache);
    if (points.length < 2) {
      console.warn(`  跳过（有效坐标不足 2 个）`);
      continue;
    }
    const pairs = await buildCityPairs(client, city, points);
    bundles.push({
      city,
      stationCount: points.length,
      stations: points,
      pairs,
    });
    doneSet.add(city);
    writeFileSync(geocodeCachePath, JSON.stringify(cache, null, 2), 'utf8');
    writeFileSync(progressPath, JSON.stringify({ doneCities: [...doneSet] }, null, 2), 'utf8');

    const dataset: DistanceDataset = {
      version: 1,
      generatedAt: new Date().toISOString(),
      description: '同城铁路站点两两之间的直线距离与公交(最慢)/骑行/驾车耗时，供异站换乘间隙估算',
      source: {
        stations: '12306 station_name.js',
        routing: 'amap-web-service',
      },
      filter: {
        minStationsPerCity: minStations,
        hsrOriented: true,
      },
      stats: {
        cityCount: bundles.length,
        stationCount: bundles.reduce((sum, item) => sum + item.stationCount, 0),
        pairCount: bundles.reduce((sum, item) => sum + item.pairs.length, 0),
      },
      cities: bundles.sort((a, b) => a.city.localeCompare(b.city, 'zh')),
    };
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(dataset, null, 2), 'utf8');
    console.log(`  ✓ 已增量写入 ${outPath}`);
  }

  console.log('\n完成');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
