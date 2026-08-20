import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import DashboardPage from "./pages/DashboardPage";
import ConfigPage from "./pages/ConfigPage";
import ExplorerPage from "./pages/ExplorerPage";
import FleetPage from "./pages/FleetPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/explorer" element={<ExplorerPage />} />
          <Route path="/devices" element={<FleetPage />} />
          <Route path="/fleet" element={<Navigate to="/devices" replace />} />
          <Route path="/config" element={<ConfigPage />} />

        </Route>
      </Routes>
    </BrowserRouter>
  );
}

