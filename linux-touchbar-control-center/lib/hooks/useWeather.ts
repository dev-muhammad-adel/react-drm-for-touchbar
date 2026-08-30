import { useEffect, useState } from 'react';

// Open-Meteo (api.open-meteo.com) — free, no API key. Location comes from a
// one-time IP geolocation lookup (ipwho.is, also free/no-key) rather than a
// config field: city-level accuracy is enough for a bar widget, and it means
// this widget works with zero setup instead of asking every user to go find
// their own coordinates. (ipapi.co was tried first but returns 403 from this
// network — no daily quota left on its free tier, or it blackholes datacenter
// IPs outright; ipwho.is has no such issue.)

const REFRESH_MS = 15 * 60 * 1000;

export interface WeatherState {
  tempC: number;
  code: number;
}

let locationPromise: Promise<{ latitude: number; longitude: number }> | null = null;

function resolveLocation(): Promise<{ latitude: number; longitude: number }> {
  if (!locationPromise) {
    // Un-cache on failure — otherwise a transient lookup failure (network
    // blip, rate limit) would wedge every future retry against the same
    // rejected promise for the rest of the process's life.
    locationPromise = fetch('https://ipwho.is/')
      .then(res => {
        if (!res.ok) throw new Error(`ipwho.is ${res.status}`);
        return res.json() as Promise<{ success: boolean; latitude: number; longitude: number }>;
      })
      .then(data => {
        if (!data.success) throw new Error('ipwho.is lookup failed');
        return { latitude: data.latitude, longitude: data.longitude };
      })
      .catch(err => { locationPromise = null; throw err; });
  }
  return locationPromise;
}

async function fetchWeather(): Promise<WeatherState> {
  const { latitude, longitude } = await resolveLocation();
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&temperature_unit=celsius`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const data = await res.json() as { current: { temperature_2m: number; weather_code: number } };
  return { tempC: data.current.temperature_2m, code: data.current.weather_code };
}

/** Returns the current weather, or null while loading / on failure. */
export function useWeather(): WeatherState | null {
  const [weather, setWeather] = useState<WeatherState | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      fetchWeather()
        .then(w => { if (alive) setWeather(w); })
        .catch(() => { /* keep showing the last good reading */ });
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return weather;
}
