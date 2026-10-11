import { existsSync } from 'node:fs';
import maxmind, { type CityResponse, type Reader } from 'maxmind';

export interface Geo {
  country: string;
  region: string;
  city: string;
}

const EMPTY: Geo = { country: '', region: '', city: '' };

/**
 * IP → country/region/city. The IP is only used in memory for this lookup and is never written
 * anywhere. Sources, in order: local mmdb (DB-IP City Lite or MaxMind GeoLite2), then CDN headers.
 */
export class GeoResolver {
  private reader: Reader<CityResponse> | undefined;

  static async create(dbPath: string): Promise<GeoResolver> {
    const g = new GeoResolver();
    if (dbPath && existsSync(dbPath)) g.reader = await maxmind.open<CityResponse>(dbPath);
    return g;
  }

  get hasDatabase(): boolean {
    return !!this.reader;
  }

  lookup(ip: string, headers: Record<string, string | string[] | undefined>): Geo {
    const h = (k: string): string => {
      const v = headers[k];
      return (Array.isArray(v) ? v[0] : v) ?? '';
    };
    if (this.reader && ip && maxmind.validate(ip)) {
      const r = this.reader.get(ip);
      if (r) {
        return {
          country: r.country?.iso_code ?? '',
          region: r.subdivisions?.[0]?.names?.en ?? '',
          city: r.city?.names?.en ?? '',
        };
      }
    }
    const country = (h('cf-ipcountry') || h('cloudfront-viewer-country') || h('x-vercel-ip-country') || h('x-country-code')).toUpperCase();
    if (!country || country === 'XX' || country === 'T1') return EMPTY;
    return {
      country: country.slice(0, 2),
      region: decodeSafe(h('x-vercel-ip-country-region') || h('cf-region')),
      city: decodeSafe(h('cf-ipcity') || h('x-vercel-ip-city') || h('cloudfront-viewer-city')),
    };
  }
}

function decodeSafe(v: string): string {
  try {
    return decodeURIComponent(v).slice(0, 128);
  } catch {
    return v.slice(0, 128);
  }
}
