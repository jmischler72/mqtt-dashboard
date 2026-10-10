import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import DashboardPage from "./pages/DashboardPage";
import ConfigPage from "./pages/ConfigPage";
import ExplorerPage from "./pages/ExplorerPage";
import AutomationsPage from "./pages/AutomationsPage";
import { basePath } from "./runtime";

export default function App() {
  return (
    <BrowserRouter
      basename={basePath === "/" ? undefined : basePath.slice(0, -1)}
    >
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/explorer" element={<ExplorerPage />} />
          <Route path="/automations" element={<AutomationsPage />} />
          <Route path="/config" element={<ConfigPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
