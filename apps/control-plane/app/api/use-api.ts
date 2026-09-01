import { useCallback, useEffect, useState } from 'react';

type QueryState<T> = {
  data: T | null;
  error: Error | null;
  loading: boolean;
  retry: () => void;
};

export function useApiQuery<T>(loader: () => Promise<T>, dependencies: readonly unknown[] = []): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void loader()
      .then(value => {
        if (active) setData(value);
      })
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason : new Error('请求失败，请稍后重试。'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // The loader is intentionally supplied by each feature; dependencies describe its route inputs.
  }, [attempt, ...dependencies]);

  return { data, error, loading, retry };
}
