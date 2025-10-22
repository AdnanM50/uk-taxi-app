"use client";
import React, { useEffect, useRef, useState } from 'react';

type Suggestion = {
  formatted?: string;
  lat?: number;
  lon?: number;
  [k: string]: any;
};

type Props = {
  id?: string;
  name?: string;
  placeholder?: string;
  apiUrl?: string; // e.g. '/addressAutocomplete' or full URL
  onSelect?: (item: Suggestion) => void;
  onChange?: (value: string) => void;
  inputClassName?: string;
};

const PUBLIC_BASE = typeof process !== 'undefined' ? (process.env.NEXT_PUBLIC_API_BASE ?? '') : '';

export default function Autocomplete({ id, name, placeholder, apiUrl, onSelect, onChange, inputClassName = '' }: Props) {
  const defaultUrl = apiUrl ?? (PUBLIC_BASE ? `${PUBLIC_BASE.replace(/\/$/, '')}/addressAutocomplete` : '/addressAutocomplete');
  const [value, setValue] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    if (!value || value.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    setLoading(true);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;

  const q = encodeURIComponent(value);
  const url = defaultUrl.includes('?') ? `${defaultUrl}&text=${q}` : `${defaultUrl}?text=${q}`;

      fetch(url, { signal })
        .then(async (res) => {
          if (!res.ok) throw new Error('Network response was not ok');
          const data = await res.json();
          // expect array
          if (Array.isArray(data)) {
            setSuggestions(data as Suggestion[]);
            setOpen(true);
            setActiveIndex(-1);
          } else {
            setSuggestions([]);
            setOpen(false);
          }
        })
        .catch((err) => {
          if (err.name === 'AbortError') return;
          console.error('Autocomplete fetch error', err);
          setSuggestions([]);
          setOpen(false);
        })
        .finally(() => setLoading(false));

    }, 300);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [value, apiUrl]);

  function handleSelect(item: Suggestion) {
    setValue(item.formatted ?? (item as any).display_name ?? String(item));
    setOpen(false);
    setSuggestions([]);
    setActiveIndex(-1);
    if (onSelect) onSelect(item);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        handleSelect(suggestions[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapperRef} className="autocomplete relative">
      <input
        id={id}
        name={name}
        value={value}
        onChange={(e) => { setValue(e.target.value); if (onChange) onChange(e.target.value); }}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (suggestions.length) setOpen(true); }}
        placeholder={placeholder}
        className={inputClassName}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-haspopup="listbox"
        role="combobox"
      />

      {open && (
        <ul role="listbox" className="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-auto rounded-md bg-zinc-800/90 ring-1 ring-black/40">
          {loading && (
            <li className="px-3 py-2 text-sm text-zinc-400">Loading…</li>
          )}
          {!loading && suggestions.length === 0 && (
            <li className="px-3 py-2 text-sm text-zinc-400">No results</li>
          )}
          {suggestions.map((s, idx) => (
            <li
              key={idx}
              role="option"
              aria-selected={activeIndex === idx}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(s); }}
              onMouseEnter={() => setActiveIndex(idx)}
              className={`cursor-pointer px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700/60 ${activeIndex === idx ? 'bg-zinc-700/60' : ''}`}
            >
              <div className="truncate">{s.formatted ?? (s as any).display_name ?? JSON.stringify(s)}</div>
              {/* optional small meta line */}
              {(s.country || s.city) && (
                <div className="mt-0.5 text-xs text-zinc-400">
                  {s.city ? `${s.city}${s.state ? ', ' + s.state : ''}` : ''}{s.country ? ` ${s.country}` : ''}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
