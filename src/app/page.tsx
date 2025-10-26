"use client";
import { useState, useEffect } from "react";
import Autocomplete from '@/components/Autocomplete';
import RouteMap from '@/components/RouteMap';
import Image from "next/image";

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
  const [routeLoading, setRouteLoading] = useState(false);
  const [isScotland, setIsScotland] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);
  const [startError, setStartError] = useState(false);
  const [destError, setDestError] = useState(false);
  const [showBookingDialog, setShowBookingDialog] = useState(false);

  // auto-dismiss toast after a short delay
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Handle booking dialog
  const handleBookingClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setShowBookingDialog(true);
  };

  const handleDialogCancel = () => {
    setShowBookingDialog(false);
  };

  const handleDialogConfirm = () => {
    window.open('https://www.dastaxis.co.uk/booking/', '_blank', 'noopener,noreferrer');
    setShowBookingDialog(false);
  };

  // Handle escape key to close dialog
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showBookingDialog) {
        setShowBookingDialog(false);
      }
    };
    
    if (showBookingDialog) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [showBookingDialog]);

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
    // require that user selected addresses from the autocomplete suggestions
    if (!startSel) {
      setStartError(true);
      setToast('Please select the pickup address from the suggestions.');
      return;
    }
    if (!destSel) {
      setDestError(true);
      setToast('Please select the drop-off address from the suggestions.');
      return;
    }

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
        setRouteLoading(true);
        setRouteData(null);
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
        finally {
          setRouteLoading(false);
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

      <main className="w-full max-w-4xl px-4 sm:px-6 py-10 sm:py-20">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-6">
          <header className="text-center">
            <div className="mb-3 inline-flex items-center justify-center rounded-full bg-transparent p-1">
              <Image src="/Das-Taxis-Logo-scaled.png" alt="Taxi mark" width={64} height={64} />
            </div>

            <h1 className="text-3xl font-extrabold text-yellow-700 drop-shadow-sm sm:text-4xl">
              UK Taxi Fare Calculator
            </h1>
            <p className="mt-2 max-w-xl text-sm text-gray-600">
              Quick estimates for taxi journeys across the UK — instant, simple,
              and mobile-friendly.
            </p>
          </header>

          <section className="w-full max-w-3xl mx-auto rounded-3xl bg-white sm:p-8 p-4 shadow-2xl ring-1 ring-gray-100 transform transition-all duration-300 hover:shadow-3xl">
            <form className="grid grid-cols-1 gap-4 sm:grid-cols-12 sm:items-end">
              <div className="sm:col-span-5">
                <label htmlFor="start" className="mb-2 inline-flex items-center gap-2 text-xs font-semibold text-yellow-600">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <path d="M12 2C8 2 5 5.5 5 9.2c0 4.5 6.5 10.8 6.8 11.1a1 1 0 0 0 1.4 0C12.5 20 19 13.7 19 9.2 19 5.5 16 2 12 2z" fill="#b45309" />
                    <circle cx="12" cy="9" r="2.2" fill="#fff" />
                  </svg>
                  Start Address
                </label>
                <div className="relative">
                  <Autocomplete id="start" name="start" placeholder="Enter pickup location" inputClassName={"h-14 w-full rounded-xl bg-linear-to-r from-gray-50 to-yellow-50 px-4 pr-12 text-sm text-gray-900 placeholder:text-gray-400 border-2 " + (startError ? 'border-red-400 ring-2 ring-red-100' : 'border-yellow-200') + " focus:outline-none focus:ring-4 focus:ring-yellow-300 focus:border-yellow-400 transition-all duration-200 shadow-sm hover:shadow-md"} onSelect={(item) => {
                    setStartSel(item);
                    setStartText(item.formatted ?? item.display_name ?? '');
                    setStartError(false);
                  }} onChange={(v) => { setStartText(v); setStartSel(null); }} />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">⌕</span>
                </div>
              </div>

              <div className="sm:col-span-5">
                <label htmlFor="destination" className="mb-2 inline-flex items-center gap-2 text-xs font-semibold text-yellow-600">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <path d="M12 2C8 2 5 5.5 5 9.2c0 4.5 6.5 10.8 6.8 11.1a1 1 0 0 0 1.4 0C12.5 20 19 13.7 19 9.2 19 5.5 16 2 12 2z" fill="#b45309" />
                    <circle cx="12" cy="9" r="2.2" fill="#fff" />
                  </svg>
                  Destination Address
                </label>
                <div className="relative">
                  <Autocomplete id="destination" name="destination" placeholder="Enter drop-off location" inputClassName={"h-14 w-full rounded-xl bg-linear-to-r from-gray-50 to-yellow-50 px-4 pr-12 text-sm text-gray-900 placeholder:text-gray-400 border-2 " + (destError ? 'border-red-400 ring-2 ring-red-100' : 'border-yellow-200') + " focus:outline-none focus:ring-4 focus:ring-yellow-300 focus:border-yellow-400 transition-all duration-200 shadow-sm hover:shadow-md"} onSelect={(item) => {
                    setDestSel(item);
                    setDestinationText(item.formatted ?? item.display_name ?? '');
                    setDestError(false);
                  }} onChange={(v) => { setDestinationText(v); setDestSel(null); }} />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">📍</span>
                </div>
              </div>

                <div className="sm:col-span-2 item-center flex sm:justify-end">
                <button type="button" onClick={calculateFare} className="relative inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-yellow-400 via-yellow-500 to-yellow-600 px-6 text-sm font-bold text-black shadow-2xl transform transition-all duration-200 hover:scale-105 hover:shadow-3xl active:scale-100 focus:outline-none focus:ring-4 focus:ring-yellow-300 hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-700">
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
              <div className="mt-6 rounded-xl bg-linear-to-br from-white to-yellow-50 p-6 ring-2 ring-yellow-200 shadow-xl transform transition-all duration-300 hover:shadow-2xl hover:scale-[1.02]">
                {response.error ? (
                  <div className="text-sm text-red-500">{String(response.error)}</div>
                ) : (
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-yellow-600 uppercase tracking-wide">From</div>
                      <div className="text-lg font-bold text-gray-900 bg-white/60 px-3 py-2 rounded-lg border border-yellow-200">{response.start ?? startText}</div>
                      <div className="text-sm  font-black bg-linear-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent drop-shadow-sm px-3 py-1 rounded-full inline-block">
                        {response.distance === '0.00 miles' || response.distance === '0 miles' || !response.distance ? 
                          'Same Location' : 
                          `${response.distance ?? ''} • ${response.duration ?? ''}`
                        }
                      </div>
                    </div>

                    <div className="mt-3 sm:mt-0 text-right space-y-2">
                      <div className="text-sm font-medium text-yellow-600 uppercase tracking-wide">Estimate</div>
                      <div className="text-4xl font-black bg-linear-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent drop-shadow-sm">
                        {response.estimatedFare === '£0.00' || response.estimatedFare === '£0' || !response.estimatedFare ? 
                          'Same Location' : 
                          response.estimatedFare ?? '—'
                        }
                      </div>
                      {response.rate && response.estimatedFare !== '£0.00' && response.estimatedFare !== '£0' && (
                        <div className="text-sm  font-black bg-linear-to-r from-yellow-400 to-yellow-600 bg-clip-text text-transparent drop-shadow-sm px-3 py-1 rounded-full inline-block">{response.rate}</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {isScotland && (
              <div className="mt-4 flex justify-center">
                <button onClick={handleBookingClick} className="inline-flex items-center gap-2 rounded-md bg-yellow-500 px-4 py-2 text-sm font-semibold text-black hover:brightness-95 transition-all duration-200 hover:scale-105">
                  Book Now
                </button>
              </div>
            )}

            {/* Route map: show only the map if routeData exists */}
            {routeError && (
              <div className="mt-4 rounded-md bg-red-900/30 p-3 text-sm text-red-300">{routeError}</div>
            )}

            {routeLoading && (
              <div className="mt-6 flex items-center justify-center">
                <div className="flex items-center gap-4 rounded-lg bg-white/90 px-6 py-4 shadow-lg">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-yellow-400 border-t-transparent" />
                  <div className="text-sm text-gray-700">Fetching route — hang tight, this may take a moment...</div>
                </div>
              </div>
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
      {/* toast */}
      {toast && (
        <div className="fixed left-1/2 bottom-10 z-100 -translate-x-1/2" role="status" aria-live="polite">
          <div className="max-w-xl w-full mx-auto px-4">
            <div className="inline-flex w-full items-center gap-3 rounded-xl bg-linear-to-r from-yellow-500 to-yellow-400 px-4 py-3 shadow-2xl text-sm font-medium text-black transform transition-all duration-300" data-toast>
              <svg className="h-5 w-5 shrink-0 text-black" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                <path d="M12 9v4" stroke="#111827" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M12 17h.01" stroke="#111827" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M21 12A9 9 0 1 1 3 12a9 9 0 0 1 18 0z" stroke="#111827" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="flex-1">{toast}</div>
              <button onClick={() => setToast(null)} aria-label="Dismiss" className="ml-2 rounded bg-black/10 px-2 py-1 text-xs text-black/80 hover:bg-black/20">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Booking Dialog */}
      {showBookingDialog && (
        <div 
          className="fixed inset-0 z-9999 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          style={{ zIndex: 9999 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowBookingDialog(false);
            }
          }}
        >
          <div className="w-full max-w-lg mx-auto bg-white rounded-2xl shadow-2xl transform transition-all duration-300 scale-100 overflow-hidden max-h-[90vh] overflow-y-auto">
            {/* Dialog Header */}
            <div className="px-6 py-5 border-b border-gray-200 bg-linear-to-r from-yellow-50 to-yellow-100">
              <h3 className="text-xl font-bold text-gray-900 text-center">🚕 Book Your Taxi</h3>
            </div>

            {/* Dialog Content */}
            <div className="px-6 py-6 bg-white">
              <div className="text-center space-y-5">
                <div className="text-base text-gray-700 font-medium">
                  If you want to go to these destinations, you can book by this website:
                </div>
                
                {/* Highlighted destinations */}
                <div className="bg-linear-to-r from-yellow-100 to-yellow-200 rounded-xl p-5 border-2 border-yellow-400 shadow-lg">
                  <div className="text-base font-bold text-yellow-900 mb-3">📍 Your Journey:</div>
                  <div className="text-sm font-bold text-gray-800 mb-2 bg-white/80 px-3 py-2 rounded-lg">
                    {response?.start || startText}
                  </div>
                  <div className="text-lg text-yellow-600 my-2">⬇️</div>
                  <div className="text-sm font-bold text-gray-800 bg-white/80 px-3 py-2 rounded-lg">
                    {response?.destination || destinationText}
                  </div>
                </div>

                <div className="text-sm text-gray-600 font-medium">
                  Click OK to open the booking website
                </div>
              </div>
            </div>

            {/* Dialog Buttons */}
            <div className="px-6 py-5 border-t border-gray-200 bg-gray-50 flex gap-4">
              <button
                onClick={handleDialogCancel}
                className="flex-1 px-6 py-3 text-base font-semibold text-gray-700 bg-white border-2 border-gray-300 rounded-xl hover:bg-gray-50 hover:border-gray-400 transition-all duration-200 shadow-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleDialogConfirm}
                className="flex-1 px-6 py-3 text-base font-semibold text-white bg-linear-to-r from-yellow-500 to-yellow-600 rounded-xl hover:from-yellow-600 hover:to-yellow-700 transition-all duration-200 transform hover:scale-105 shadow-lg"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
