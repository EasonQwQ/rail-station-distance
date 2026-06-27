export type RawStation = {
  station_id: string;
  station_name: string;
  station_code: string;
  station_pinyin: string;
  station_short: string;
  station_index: string;
  code: string;
  city: string;
  r1: string;
  r2: string;
};

export type StationPoint = {
  name: string;
  code: string;
  city: string;
  lng: number;
  lat: number;
};

export type ModeDuration = {
  /** 公交综合换乘最慢方案（分钟，向上取整） */
  transitSlowMinutes: number | null;
  /** 骑行（分钟） */
  bicyclingMinutes: number | null;
  /** 驾车（分钟） */
  drivingMinutes: number | null;
};

export type StationPairDistance = {
  from: string;
  to: string;
  fromCode: string;
  toCode: string;
  straightLineMeters: number | null;
  duration: ModeDuration;
};

export type CityDistanceBundle = {
  city: string;
  stationCount: number;
  stations: StationPoint[];
  pairs: StationPairDistance[];
};

export type DistanceDataset = {
  version: 1;
  generatedAt: string;
  description: string;
  source: {
    stations: '12306 station_name.js';
    routing: 'amap-web-service';
  };
  filter: {
    minStationsPerCity: number;
    hsrOriented: boolean;
  };
  stats: {
    cityCount: number;
    stationCount: number;
    pairCount: number;
  };
  cities: CityDistanceBundle[];
};

export type GeocodeCache = Record<string, { lng: number; lat: number } | null>;

export type StationsByCityFile = {
  generatedAt: string;
  cityCount: number;
  stationCount: number;
  cities: Record<string, RawStation[]>;
};
