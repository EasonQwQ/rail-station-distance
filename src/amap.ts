import axios from 'axios';
import { RateLimiter } from './rate-limiter.js';
import type { GeocodeCache, ModeDuration, StationPoint } from './types.js';

const BASE = 'https://restapi.amap.com';

/** 高德 QPS / 日配额类错误，短暂退避后重试 */
const RETRYABLE_INFO_CODES = new Set(['10021', '10022', '10003']);

class AmapRateLimitError extends Error {
  readonly infocode: string;

  constructor(infocode: string) {
    super(`高德 API 限流 (${infocode})`);
    this.infocode = infocode;
  }
}

function assertNotRateLimited(data: { status?: string; infocode?: string }): void {
  if (data.status === '0' && data.infocode && RETRYABLE_INFO_CODES.has(data.infocode)) {
    throw new AmapRateLimitError(data.infocode);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function haversineMeters(a: StationPoint, b: StationPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export type AmapClientOptions = {
  /** 每秒最多请求数，默认 3（高德 LBS 并发上限） */
  maxQps?: number;
  /** @deprecated 请用 maxQps；仍支持：maxQps = floor(1000 / intervalMs) */
  intervalMs?: number;
  maxRetries?: number;
};

export class AmapClient {
  private readonly key: string;
  private readonly limiter: RateLimiter;
  private readonly maxRetries: number;
  private readonly minIntervalMs: number;

  constructor(key: string, options: AmapClientOptions = {}) {
    this.key = key;
    const maxQps =
      options.maxQps ??
      (options.intervalMs ? Math.max(1, Math.floor(1000 / options.intervalMs)) : 3);
    this.limiter = new RateLimiter(maxQps);
    this.minIntervalMs = Math.ceil(1000 / maxQps);
    this.maxRetries = options.maxRetries ?? 3;
  }

  private async request<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.limiter.schedule(fn);
      } catch (error) {
        lastError = error;
        if (!this.isRetryable(error) || attempt >= this.maxRetries) {
          throw error;
        }
        const backoffMs = this.minIntervalMs * (attempt + 2);
        console.warn(`  ⚠ 高德限流，${backoffMs}ms 后重试 (${attempt + 1}/${this.maxRetries})`);
        await sleep(backoffMs);
      }
    }
    throw lastError;
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof AmapRateLimitError) {
      return true;
    }
    if (!axios.isAxiosError(error)) {
      return false;
    }
    if (error.response?.status === 429) {
      return true;
    }
    const infocode = String(error.response?.data?.infocode ?? '');
    return RETRYABLE_INFO_CODES.has(infocode);
  }

  async geocodeStation(
    name: string,
    city: string,
    cache: GeocodeCache,
  ): Promise<{ lng: number; lat: number } | null> {
    const cacheKey = `${city}::${name}`;
    if (cacheKey in cache) {
      return cache[cacheKey];
    }
    const address = name.endsWith('站') ? name : `${name}站`;
    const result = await this.request(async () => {
      const { data } = await axios.get<{
        status: string;
        infocode?: string;
        geocodes?: Array<{ location?: string }>;
      }>(`${BASE}/v3/geocode/geo`, {
        params: { key: this.key, address, city },
        timeout: 15_000,
      });
      if (data.status !== '1' || !data.geocodes?.[0]?.location) {
        assertNotRateLimited(data);
        return null;
      }
      const [lng, lat] = data.geocodes[0].location.split(',').map(Number);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return null;
      }
      return { lng, lat };
    });
    cache[cacheKey] = result;
    return result;
  }

  private async routeDriving(origin: StationPoint, dest: StationPoint): Promise<number | null> {
    return this.request(async () => {
      const { data } = await axios.get<{
        status: string;
        route?: { paths?: Array<{ duration?: string }> };
      }>(`${BASE}/v3/direction/driving`, {
        params: {
          key: this.key,
          origin: `${origin.lng},${origin.lat}`,
          destination: `${dest.lng},${dest.lat}`,
          strategy: 0,
        },
        timeout: 15_000,
      });
      assertNotRateLimited(data);
      const seconds = Number(data.route?.paths?.[0]?.duration);
      return Number.isFinite(seconds) ? Math.ceil(seconds / 60) : null;
    });
  }

  private async routeBicycling(origin: StationPoint, dest: StationPoint): Promise<number | null> {
    return this.request(async () => {
      const { data } = await axios.get<{
        errcode?: number;
        data?: { paths?: Array<{ duration?: number }> };
      }>(`${BASE}/v4/direction/bicycling`, {
        params: {
          key: this.key,
          origin: `${origin.lng},${origin.lat}`,
          destination: `${dest.lng},${dest.lat}`,
        },
        timeout: 15_000,
      });
      const seconds = data.data?.paths?.[0]?.duration;
      return typeof seconds === 'number' ? Math.ceil(seconds / 60) : null;
    });
  }

  /** 公交：取返回方案中最慢的一条（更保守，适合换乘间隙估算） */
  private async routeTransitSlowest(
    origin: StationPoint,
    dest: StationPoint,
    city: string,
  ): Promise<number | null> {
    return this.request(async () => {
      const { data } = await axios.get<{
        status: string;
        route?: { transits?: Array<{ duration?: string }> };
      }>(`${BASE}/v3/direction/transit/integrated`, {
        params: {
          key: this.key,
          origin: `${origin.lng},${origin.lat}`,
          destination: `${dest.lng},${dest.lat}`,
          city,
          cityd: city,
          strategy: 0,
          nightflag: 0,
        },
        timeout: 20_000,
      });
      const transits = data.route?.transits ?? [];
      assertNotRateLimited(data);
      if (!transits.length) {
        return null;
      }
      const minutes = transits
        .map((item) => Number(item.duration))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((sec) => Math.ceil(sec / 60));
      if (!minutes.length) {
        return null;
      }
      return Math.max(...minutes);
    });
  }

  async pairDuration(
    from: StationPoint,
    to: StationPoint,
    city: string,
  ): Promise<{ straightLineMeters: number; duration: ModeDuration }> {
    const transitSlowMinutes = await this.routeTransitSlowest(from, to, city);
    const bicyclingMinutes = await this.routeBicycling(from, to);
    const drivingMinutes = await this.routeDriving(from, to);
    return {
      straightLineMeters: haversineMeters(from, to),
      duration: {
        transitSlowMinutes,
        bicyclingMinutes,
        drivingMinutes,
      },
    };
  }
}
