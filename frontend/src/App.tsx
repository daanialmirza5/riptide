import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Shell from "./components/Shell";
import { Spinner } from "./components/ui";
import { useEventToasts } from "./lib/useEventToasts";
import { useLiveFeed } from "./lib/useLiveFeed";

const Landing = lazy(() => import("./pages/Landing"));
const Console = lazy(() => import("./pages/Console"));
const Recovery = lazy(() => import("./pages/Recovery"));
const Incidents = lazy(() => import("./pages/Incidents"));
const Analyzer = lazy(() => import("./pages/Analyzer"));
const BenchmarkPage = lazy(() => import("./pages/Benchmark"));

function Loading() {
  return (
    <div className="grid h-full place-items-center text-tide-300">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

export default function App() {
  useLiveFeed();
  useEventToasts();
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route element={<Shell />}>
          <Route path="/console" element={<Console />} />
          <Route path="/recovery" element={<Recovery />} />
          <Route path="/incidents" element={<Incidents />} />
          <Route path="/analyzer" element={<Analyzer />} />
          <Route path="/benchmark" element={<BenchmarkPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
