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

          <section className="w-full max-w-4xl mx-auto rounded-3xl bg-white sm:p-8 p-4 shadow-2xl ring-1 ring-gray-100 transform transition-all duration-300 hover:shadow-3xl">
            <form className="grid grid-cols-1 gap-4 sm:grid-cols-12 sm:items-end">
              <div className="sm:col-span-4">
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

              <div className="sm:col-span-4">
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

                <div className="sm:col-span-4 item-center flex sm:justify-end">
                <button type="button" onClick={calculateFare} className="relative inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-yellow-400 via-yellow-500 to-yellow-600 px-4 sm:px-6 text-sm font-bold text-black shadow-2xl transform transition-all duration-200 hover:scale-105 hover:shadow-3xl active:scale-100 focus:outline-none focus:ring-4 focus:ring-yellow-300 hover:from-yellow-500 hover:via-yellow-600 hover:to-yellow-700 whitespace-nowrap">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <path d="M3 6h18M7 6v12a1 1 0 001 1h8a1 1 0 001-1V6" stroke="#111827" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M9 10h6M9 14h6" stroke="#111827" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {loading ? 'Calculating...' : 'Get My Fare Estimate'}
                </button>
              </div>
            </form>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <p className="text-xs text-gray-600">Estimates are indicative. Taxes and tolls excluded.</p>
            </div>

            {/* Result card - Enhanced Modern Design with 3-Device Responsive */}
            {response && (
              <div className="mt-4 sm:mt-6 lg:mt-8 rounded-xl sm:rounded-2xl bg-gradient-to-br from-white via-yellow-50/30 to-orange-50/20 p-4 sm:p-6 lg:p-8 ring-1 ring-yellow-200/50 shadow-xl sm:shadow-2xl backdrop-blur-sm transform transition-all duration-500 hover:shadow-2xl sm:hover:shadow-3xl hover:scale-[1.005] sm:hover:scale-[1.01] hover:ring-yellow-300/60">
                {response.error ? (
                  <div className="text-xs sm:text-sm text-red-500 bg-red-50 p-3 sm:p-4 rounded-lg sm:rounded-xl border border-red-200">{String(response.error)}</div>
                ) : (
                  <div className="space-y-4 sm:space-y-6 lg:space-y-8">
                  

                    {/* Enhanced Location cards - Mobile First Responsive */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 lg:gap-6">
                      {/* Pickup Location */}
                      <div className="group bg-white/80 backdrop-blur-sm p-3 sm:p-4 lg:p-6 rounded-lg sm:rounded-xl border border-yellow-200/50 shadow-md sm:shadow-lg hover:shadow-lg sm:hover:shadow-xl transition-all duration-300 hover:border-yellow-300/70 hover:-translate-y-0.5 sm:hover:-translate-y-1">
                        <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3 lg:mb-4">
                          <div className="p-1.5 sm:p-2 bg-gradient-to-br from-yellow-400 to-yellow-500 rounded-md sm:rounded-lg shadow-sm sm:shadow-md">
                            {/* Taxi/car icon for Pickup (distinct from drop-off pin) */}
                            <svg className="h-4 w-4 sm:h-5 sm:w-5 text-white" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                              <path d="M3 13.5V11a1 1 0 0 1 1-1h1.2l1.2-2.5A2 2 0 0 1 8.5 6h7a2 2 0 0 1 1.1.5L18 10h1a1 1 0 0 1 1 1v2.5a1 1 0 0 1-1 1h-0.5a1.5 1.5 0 0 1-3 0H9a1.5 1.5 0 0 1-3 0H5a1 1 0 0 1-1-1z" fill="currentColor" />
                              <circle cx="7.2" cy="15.5" r="0.9" fill="#ffffff" />
                              <circle cx="16.8" cy="15.5" r="0.9" fill="#ffffff" />
                            </svg>
                          </div>
                          <span className="text-xs sm:text-sm font-bold text-yellow-700 uppercase tracking-wide">Pickup Location</span>
                        </div>
                        <div className="text-gray-800 text-xs sm:text-sm font-medium leading-relaxed bg-gray-50/50 p-2 sm:p-3 rounded-md sm:rounded-lg border border-gray-100">
                          {response.start ?? startText}
                        </div>
                      </div>

                      {/* Drop-off Location */}
                      <div className="group bg-white/80 backdrop-blur-sm p-3 sm:p-4 lg:p-6 rounded-lg sm:rounded-xl border border-yellow-200/50 shadow-md sm:shadow-lg hover:shadow-lg sm:hover:shadow-xl transition-all duration-300 hover:border-yellow-300/70 hover:-translate-y-0.5 sm:hover:-translate-y-1">
                        <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3 lg:mb-4">
                          <div className="p-1.5 sm:p-2 bg-gradient-to-br from-green-400 to-green-500 rounded-md sm:rounded-lg shadow-sm sm:shadow-md">
                            <svg className="h-4 w-4 sm:h-5 sm:w-5 text-white" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" fill="currentColor" />
                              <circle cx="12" cy="10" r="3" fill="#fff" />
                            </svg>
                          </div>
                          <span className="text-xs sm:text-sm font-bold text-green-700 uppercase tracking-wide">Drop-off Location</span>
                        </div>
                        <div className="text-gray-800 text-xs sm:text-sm font-medium leading-relaxed bg-gray-50/50 p-2 sm:p-3 rounded-md sm:rounded-lg border border-gray-100">
                          {response.destination ?? destinationText}
                        </div>
                      </div>
                    </div>

                    {/* Enhanced Info boxes - Responsive Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
                      {/* Distance */}
                      <div className="group bg-white/90 backdrop-blur-sm p-3 sm:p-4 lg:p-6 rounded-lg sm:rounded-xl border border-blue-200/50 shadow-md sm:shadow-lg hover:shadow-lg sm:hover:shadow-xl transition-all duration-300 hover:border-blue-300/70 hover:-translate-y-0.5 sm:hover:-translate-y-1">
                        <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3 lg:mb-4">
                          <div className="p-2 sm:p-3 bg-gradient-to-br from-blue-400 to-blue-500 rounded-lg sm:rounded-xl shadow-sm sm:shadow-md group-hover:scale-105 sm:group-hover:scale-110 transition-transform duration-300">
                            {/* Car / route icon for Distance (distinct from the clock used for Duration) */}
                            <svg className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 text-white" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                              <path d="M3 12l1-4.5a1 1 0 0 1 1-0.8h14a1 1 0 0 1 1 0.8L21 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M5 12v3a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-1h8v1a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                              <circle cx="7.5" cy="16.5" r="1" fill="currentColor" />
                              <circle cx="16.5" cy="16.5" r="1" fill="currentColor" />
                            </svg>
                          </div>
                          <span className="text-xs sm:text-sm font-bold text-blue-700 uppercase tracking-wide">Distance</span>
                        </div>
                        <div className="text-gray-800 text-lg sm:text-xl lg:text-2xl font-black bg-gradient-to-r from-blue-600 to-blue-700 bg-clip-text text-transparent">
                          {response.distance === '0.00 miles' || response.distance === '0 miles' || !response.distance ? 
                            'Same Location' : 
                            response.distance ?? '—'
                          }
                        </div>
                      </div>

                      {/* Duration */}
                      <div className="group bg-white/90 backdrop-blur-sm p-3 sm:p-4 lg:p-6 rounded-lg sm:rounded-xl border border-purple-200/50 shadow-md sm:shadow-lg hover:shadow-lg sm:hover:shadow-xl transition-all duration-300 hover:border-purple-300/70 hover:-translate-y-0.5 sm:hover:-translate-y-1">
                        <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3 lg:mb-4">
                          <div className="p-2 sm:p-3 bg-gradient-to-br from-purple-400 to-purple-500 rounded-lg sm:rounded-xl shadow-sm sm:shadow-md group-hover:scale-105 sm:group-hover:scale-110 transition-transform duration-300">
                            <svg className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6 text-white" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                              <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            </svg>
                          </div>
                          <span className="text-xs sm:text-sm font-bold text-purple-700 uppercase tracking-wide">Duration</span>
                        </div>
                        <div className="text-gray-800 text-lg sm:text-xl lg:text-2xl font-black bg-gradient-to-r from-purple-600 to-purple-700 bg-clip-text text-transparent">
                          {response.duration ?? '—'}
                        </div>
                      </div>

                      {/* Estimated Fare - Enhanced yellow box with glow - Full width on mobile */}
                      <div className="group relative bg-gradient-to-br from-yellow-400 via-yellow-500 to-orange-500 p-3 sm:p-4 lg:p-6 rounded-lg sm:rounded-xl shadow-xl sm:shadow-2xl hover:shadow-2xl sm:hover:shadow-3xl transition-all duration-300 hover:scale-102 sm:hover:scale-105 sm:col-span-2 lg:col-span-1">
                        <div className="absolute inset-0 bg-gradient-to-br from-yellow-300/20 to-orange-400/20 rounded-lg sm:rounded-xl blur-sm"></div>
                        <div className="relative">
                          <div className="text-xs sm:text-sm font-bold text-black/80 mb-1 sm:mb-2 uppercase tracking-wide">Estimated Fare</div>
                          <div className="text-2xl sm:text-3xl lg:text-4xl font-black text-black drop-shadow-sm">
                            {response.estimatedFare === '£0.00' || response.estimatedFare === '£0' || !response.estimatedFare ? 
                              'Same Location' : 
                              response.estimatedFare ?? '—'
                            }
                          </div>
                          <div className="mt-1 sm:mt-2 text-xs text-black/60 font-medium">
                            {response.rate && response.estimatedFare !== '£0.00' && response.estimatedFare !== '£0' && response.rate}
                          </div>
                        </div>
                        <div className="absolute top-1.5 right-1.5 sm:top-2 sm:right-2 w-2 h-2 sm:w-3 sm:h-3 bg-white/40 rounded-full animate-ping"></div>
                      </div>
                    </div>

                    {/* Enhanced Pricing Information - Responsive */}
                    <div className="relative bg-gradient-to-r from-yellow-50 to-orange-50 border-2 border-yellow-300/50 p-3 sm:p-4 lg:p-6 rounded-lg sm:rounded-xl shadow-md sm:shadow-lg">
                      <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3 lg:mb-4">
                        <div className="p-1.5 sm:p-2 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-md sm:rounded-lg shadow-sm sm:shadow-md">
                          <svg className="h-4 w-4 sm:h-5 sm:w-5 text-white" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                            <path d="M12 16v-4M12 8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                          </svg>
                        </div>
                        <span className="text-xs sm:text-sm font-bold text-yellow-700 uppercase tracking-wide">Book Your Ride with Das Taxis</span>
                      </div>
                      <div className="text-gray-700 text-xs sm:text-sm leading-relaxed bg-white/60 p-2 sm:p-3 lg:p-4 rounded-md sm:rounded-lg border border-yellow-200/50">
                        {/* Please note that the calculated taxi fares are always only estimates based on distance, travel time and the respective taxi fare. The calculated fares are not binding and are for information purposes only. */}
                        
Secure your fare today and enjoy reliable service with professional drivers. No surge pricing, no surprises—just comfortable, stress-free travel across the SCT.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {isScotland && (
              <div className="mt-4 flex justify-center w-full">
                <button 
                onClick={
                  () => window.open('https://www.dastaxis.co.uk/booking/', '_blank')
                }
                // onClick={handleBookingClick}
                 className="inline-flex w-full justify-center items-center gap-2 rounded-md bg-yellow-500 px-4 py-3 text-base font-semibold text-black hover:brightness-95 transition-all duration-200 hover:scale-105">
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

      {/* Booking Dialog - COMMENTED OUT */}
      {/* {showBookingDialog && (
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
            <div className="px-6 py-5 border-b border-gray-200 bg-linear-to-r from-yellow-50 to-yellow-100">
              <h3 className="text-xl font-bold text-gray-900 text-center">🚕 Book Your Ride with Das Taxis</h3>
            </div>

            <div className="px-6 py-6 bg-white">
              <div className="text-center space-y-5">
                <div className="text-base text-gray-700 font-medium">
                  Secure your fare today and enjoy reliable service with professional drivers. No surge pricing, no surprises—just comfortable, stress-free travel across the SCT.
                </div>
                
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
      )} */}
    </div>
  );
}
