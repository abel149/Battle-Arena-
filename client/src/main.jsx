import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import { useRoute } from './lib/router.js';
import { useAuth } from './lib/session.js';
import AuthGate from './components/AuthGate.jsx';

// Each page is lazy-loaded so only its own socket listeners are mounted.
const Hub = lazy(() => import('./pages/Hub.jsx'));
const Arena = lazy(() => import('./pages/Arena.jsx'));
const MemoryMatch = lazy(() => import('./pages/MemoryMatch.jsx'));
// The earlier lobby (register / login / chat / spectate) stays reachable at #classic.
const ClassicLobby = lazy(() => import('./App.jsx'));

function Root() {
  const { path } = useRoute();
  const status = useAuth();

  let page;
  if (path === 'classic') page = <ClassicLobby />;
  else if (status === 'checking') page = null;
  else if (status !== 'in') page = <AuthGate status={status} />;
  else if (path === 'arena') page = <Arena />;
  else if (path === 'memory') page = <MemoryMatch />;
  else page = <Hub />;

  return <Suspense fallback={null}>{page}</Suspense>;
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);
