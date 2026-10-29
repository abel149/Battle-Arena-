// Tiny hash router — the app has a handful of pages and no router dependency.
import { useEffect, useState } from 'react';

export function parseRoute(hash = window.location.hash) {
  const raw = hash.replace(/^#\/?/, '') || 'hub';
  const [path, qs] = raw.split('?');
  return { path: path || 'hub', params: new URLSearchParams(qs || '') };
}

export function navigate(to) {
  window.location.hash = to;
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute());
  useEffect(() => {
    const onChange = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
