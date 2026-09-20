import { Route, Routes } from "react-router-dom";
import AppProviders from "./app/AppProviders";
import PlannerPage from "./pages/PlannerPage";

export default function App() {
  return (
    <AppProviders>
      <Routes>
        {/* Single planner route; the selected CRNs will live in the URL query later. */}
        <Route path="*" element={<PlannerPage />} />
      </Routes>
    </AppProviders>
  );
}
