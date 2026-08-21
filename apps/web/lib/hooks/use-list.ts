'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageMeta } from '@campusos/shared';
import { apiFetch, ApiError } from '@/lib/api/client';

/**
 * useList — shared list-fetch state (search debounce, pagination, refetch).
 * All list pages consume this hook so fetching logic lives in one place.
 */
export function useList<T>(
  path: string,
  params: Record<string, string | undefined> = {},
) {
  const [rows, setRows] = useState<T[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paramsKey = JSON.stringify(params);

  const refetch = useCallback(() => setVersion((v) => v + 1), []);

  const onSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setPage(1);
      setVersion((v) => v + 1);
    }, 300);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams();
    query.set('page', String(page));
    query.set('limit', '10');
    if (search.trim()) query.set('q', search.trim());
    for (const [key, value] of Object.entries(
      JSON.parse(paramsKey) as Record<string, string | undefined>,
    )) {
      if (value) query.set(key, value);
    }
    apiFetch<T[]>(`${path}?${query.toString()}`)
      .then((response) => {
        if (cancelled) return;
        setRows(response.data);
        setMeta((response.meta as PageMeta) ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Request failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, page, paramsKey, version]);

  return {
    rows,
    meta,
    loading,
    error,
    search,
    onSearchChange,
    page,
    setPage: (next: number) => {
      setPage(next);
      setVersion((v) => v + 1);
    },
    refetch,
  };
}

/** Fetches every row of a small collection (for select options). */
export function useOptions<T>(path: string, enabled = true) {
  const [options, setOptions] = useState<T[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    apiFetch<T[]>(`${path}?page=1&limit=100`)
      .then((response) => {
        if (!cancelled) setOptions(response.data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [path, enabled]);
  return options;
}
