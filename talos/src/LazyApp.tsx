import { lazy, Suspense } from 'react';
import Loading from '@/component/loading/Loading.tsx';

const App = lazy(() => import('./App'));

export default function LazyApp() {
  return (
    <Suspense fallback={<Loading/>}>
      <App />
    </Suspense>
  );
}
