"use client";
import { useState, useEffect } from "react";
import Autocomplete from '@/components/Autocomplete';
import RouteMap from '@/components/RouteMap';

export default function Home() {
  const [fare, setFare] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [startText, setStartText] = useState('');
  const [destinationText, setDestinationText] = useState('');
  const [startSel, setStartSel] = useState<any | null>(null);
  const [destSel, setDestSel] = useState<any | null>(null);
  const [response, setResponse] = useState<any | null>(null);
  const [routeData, setRouteData] = useState<any | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [isScotland, setIsScotland] = useState<boolean>(false);

  // small DOM cleanup: remove stray single-character leaf nodes that are just a hyphen
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        document.querySelectorAll('main *').forEach((el) => {
          if (el.childNodes.length === 1 && el.textContent && el.textContent.trim() === '-') {
            el.remove();
          }
        });
      } catch (e) {
        // ignore
      }
    }, 120);
    return () => clearTimeout(timer);
  }, []);

  async function calculateFare() {
    setLoading(true);
    setFare(null);
    setResponse(null);
    try {
      const base = process.env.NEXT_PUBLIC_API_BASE ?? '';
      const url = base ? `${base.replace(/\/$/, '')}/calculateFare` : '/api/calculateFare';
      const body = {
        start: startSel?.formatted ?? startText,
        destination: destSel?.formatted ?? destinationText,
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setResponse(data);
      // optionally attempt to fetch route info if we have coordinates
      // we won't block the UI — call getRouteInfo in background
      (async () => {
        setRouteError(null);
        try {
          const base = process.env.NEXT_PUBLIC_API_BASE ?? '';
          const routeUrl = base ? `${base.replace(/\/$/, '')}/getRouteInfo` : '/api/getRouteInfo';
          // prefer waypoints lat/lon if present in data
          const waypoints = data?.properties?.waypoints ?? data?.data?.properties?.waypoints ?? null;
          let body: any = {};
          if (Array.isArray(waypoints) && waypoints.length >= 2) {
            body = {
              start: { lat: waypoints[0].lat ?? waypoints[0]?.location?.[1], lon: waypoints[0].lon ?? waypoints[0]?.location?.[0] },
              end: { lat: waypoints[waypoints.length - 1].lat ?? waypoints[waypoints.length - 1]?.location?.[1], lon: waypoints[waypoints.length - 1].lon ?? waypoints[waypoints.length - 1]?.location?.[0] },
            };
          } else if (startSel?.lat && destSel?.lat) {
            body = { start: { lat: startSel.lat, lon: startSel.lon }, end: { lat: destSel.lat, lon: destSel.lon } };
          } else {
            body = { start: data?.start, end: data?.destination };
          }

          // debug: log route URL and body so we can inspect requests in console
          console.debug('getRouteInfo ->', { routeUrl, body });
          const rres = await fetch(routeUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          if (!rres.ok) {
            // read text body for debugging and surface the message
            let txt = '';
            try {
              txt = await rres.text();
            } catch (e) {
              txt = String(e);
            }
            console.error('Route fetch failed', rres.status, txt);
            setRouteError(`Route fetch failed: ${rres.status} ${txt}`);
            return;
          }
          console.debug('getRouteInfo response ok', rres.status);
          const rdata = await rres.json();
          // expect rdata.data as geojson-like
          setRouteData(rdata?.data ?? rdata);
          setRouteError(null);
        } catch (e) {
          console.error('getRouteInfo failed', e);
          setRouteError(String(e));
        }
      })();
      // try to parse estimatedFare into number for the small badge
      if (data && typeof data.estimatedFare === 'string') {
        const match = data.estimatedFare.match(/([0-9,.]+)/);
        if (match) {
          setFare(Number(match[1].replace(/,/g, '')));
        }
      }
      // detect Scotland from selected items or response fields (require BOTH start & dest in Scotland)
      try {
        const norm = (v: any) => (typeof v === 'string' ? v : (v == null ? '' : String(v)));
        const looksLikeScotland = (v: any) => {
          const s = norm(v).toLowerCase();
          return /scotland|\bsct\b/.test(s);
        };

        const extractCandidates = (obj: any) => {
          if (!obj) return [] as string[];
          return [obj.formatted, obj.display_name, obj.state, obj.country, obj.county, obj.region, obj.label, obj.name].map(norm).filter(Boolean) as string[];
        };

        const startCandidates = [
          ...extractCandidates(startSel),
          startText,
          response?.start,
          data?.start,
          (data?.properties?.waypoints?.[0]?.location?.join ? data?.properties?.waypoints?.[0]?.location.join(',') : '') || '',
        ].filter(Boolean);

        const destCandidates = [
          ...extractCandidates(destSel),
          destinationText,
          response?.destination,
          data?.destination,
          (data?.properties?.waypoints?.[1]?.location?.join ? data?.properties?.waypoints?.[1]?.location.join(',') : '') || '',
        ].filter(Boolean);

        const startIsScot = startCandidates.some((c) => looksLikeScotland(c));
        const destIsScot = destCandidates.some((c) => looksLikeScotland(c));

        // Only show Book Now when we independently detect Scotland for both origin and destination
        console.debug('Scotland detection candidates', { startCandidates, destCandidates, startIsScot, destIsScot });
        setIsScotland(Boolean(startIsScot && destIsScot));
      } catch (e) {
        // ignore detection errors
        setIsScotland(false);
      }
    } catch (err) {
      console.error('calculateFare error', err);
      setResponse({ error: String(err) });
    } finally {
      setLoading(false);
    }
  }

  return (
  <div className="relative flex min-h-screen items-center justify-center bg-linear-to-b from-yellow-50 via-white to-gray-50 font-sans">
      {/* decorative glow */}
      <div className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center">
        <div className="h-96 w-96 rounded-full bg-yellow-500/5 blur-3xl" />
      </div>

      <main className="w-full max-w-4xl px-6 py-20">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-6">
          <header className="text-center">
            {/* inline SVG taxi mark for crispness */}
            <div className="mb-3 inline-flex items-center justify-center rounded-full bg-transparent p-1">
              <div className="h-20 w-20 rounded-full bg-gradient-to-br from-yellow-400 to-yellow-500 flex items-center justify-center shadow-2xl transform-gpu transition-transform hover:scale-105 animate-pulse">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                  <rect x="3" y="7" width="18" height="10" rx="2" fill="#fff" />
                  <path d="M3 12h18" stroke="#b45309" strokeWidth="1.2" />
                  <circle cx="7.5" cy="16.2" r="1.5" fill="#111827" />
                  <circle cx="16.5" cy="16.2" r="1.5" fill="#111827" />
                </svg>
              </div>
            </div>

            <h1 className="text-3xl font-extrabold text-yellow-700 drop-shadow-sm sm:text-4xl">
              UK Taxi Fare Calculator
            </h1>
            <p className="mt-2 max-w-xl text-sm text-gray-600">
              Quick estimates for taxi journeys across the UK — instant, simple,
              and mobile-friendly.
            </p>
          </header>

          <section className="w-full max-w-3xl mx-auto rounded-3xl bg-white p-8 shadow-2xl ring-1 ring-gray-100">
            <form className="grid grid-cols-1 gap-4 sm:grid-cols-12 sm:items-end">
              <div className="sm:col-span-5">
                <label htmlFor="start" className="mb-2 inline-flex items-center gap-2 text-xs font-semibold text-yellow-300">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <path d="M12 2C8 2 5 5.5 5 9.2c0 5.2 7 12 7 12s7-6.8 7-12C19 5.5 16 2 12 2z" fill="#FBBF24" />
                  </svg>
                  Start Address
                </label>
                <div className="relative">
                  <Autocomplete id="start" name="start" placeholder="Enter pickup location" inputClassName={"h-14 w-full rounded-lg bg-gray-50 px-4 pr-12 text-sm text-gray-900 placeholder:text-gray-400 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-yellow-300 transition-shadow"} onSelect={(item) => {
                    setStartSel(item);
                    setStartText(item.formatted ?? item.display_name ?? '');
                  }} onChange={(v) => { setStartText(v); setStartSel(null); }} />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">⌕</span>
                </div>
              </div>

              <div className="sm:col-span-5">
                <label htmlFor="destination" className="mb-2 inline-flex items-center gap-2 text-xs font-semibold text-yellow-300">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <path d="M12 2a5 5 0 00-5 5c0 3.3 5 9 5 9s5-5.7 5-9a5 5 0 00-5-5z" fill="#F59E0B" />
                  </svg>
                  Destination Address
                </label>
                <div className="relative">
                  <Autocomplete id="destination" name="destination" placeholder="Enter drop-off location" inputClassName={"h-14 w-full rounded-lg bg-gray-50 px-4 pr-12 text-sm text-gray-900 placeholder:text-gray-400 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-yellow-300 transition-shadow"} onSelect={(item) => {
                    setDestSel(item);
                    setDestinationText(item.formatted ?? item.display_name ?? '');
                  }} onChange={(v) => { setDestinationText(v); setDestSel(null); }} />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">📍</span>
                </div>
              </div>

                <div className="sm:col-span-2 flex sm:justify-end">
                <button type="button" onClick={calculateFare} className="relative inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-yellow-400 to-yellow-500 px-6 text-sm font-semibold text-black shadow-2xl transform transition duration-150 hover:scale-105 active:scale-100 focus:outline-none focus:ring-4 focus:ring-yellow-200">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <path d="M3 6h18M7 6v12a1 1 0 001 1h8a1 1 0 001-1V6" stroke="#111827" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M9 10h6M9 14h6" stroke="#111827" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {loading ? 'Calculating...' : 'Calculate'}
                </button>
              </div>
            </form>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <p className="text-xs text-gray-600">Estimates are indicative. Taxes and tolls excluded.</p>
            </div>

            {/* Result card */}
            {response && (
              <div className="mt-6 rounded-lg bg-white p-4 ring-1 ring-gray-100 shadow-sm">
                {response.error ? (
                  <div className="text-sm text-red-500">{String(response.error)}</div>
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm text-gray-500">From</div>
                      <div className="text-base font-semibold text-gray-900">{response.start ?? startText}</div>
                      <div className="text-xs text-gray-500">{response.distance ?? ''} • {response.duration ?? ''}</div>
                    </div>

                    <div className="mt-3 sm:mt-0 text-right">
                      <div className="text-sm text-gray-500">Estimate</div>
                      <div className="text-2xl font-extrabold text-yellow-700">{response.estimatedFare ?? '—'}</div>
                      {response.rate && <div className="text-xs text-gray-500">{response.rate}</div>}
                    </div>
                  </div>
                )}
              </div>
            )}

            {isScotland && (
              <div className="mt-4 flex justify-center">
                <a href="https://www.dastaxis.co.uk/booking/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-md bg-yellow-500 px-4 py-2 text-sm font-semibold text-black hover:brightness-95">
                  Book Now
                </a>
              </div>
            )}

            {/* Route map: show only the map if routeData exists */}
            {routeError && (
              <div className="mt-4 rounded-md bg-red-900/30 p-3 text-sm text-red-300">{routeError}</div>
            )}
            {routeData && (
              <div className="mt-6">
                <RouteMap data={routeData} />
              </div>
            )}
          </section>

          <p className="mt-2 text-center text-xs text-gray-500">For accurate pricing, call your local licensed operator.</p>
        </div>
      </main>
    </div>
  );
}
