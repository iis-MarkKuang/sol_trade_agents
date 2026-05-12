import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { InsightsPage } from "./pages/InsightsPage";
import { LiveTradingPage } from "./pages/LiveTradingPage";
import { useSocketStore } from "./lib/websocket";

export default function App() {
  const connect = useSocketStore((state) => state.connect);
  const disconnect = useSocketStore((state) => state.disconnect);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/insights" replace />} />
        <Route path="/insights" element={<InsightsPage />} />
        <Route path="/live" element={<LiveTradingPage />} />
        <Route path="*" element={<Navigate to="/insights" replace />} />
      </Route>
    </Routes>
  );
}
