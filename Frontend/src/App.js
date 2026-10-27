import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/components/AuthProvider";
import Dashboard from "@/pages/Dashboard";
import { lazy, Suspense } from "react";

// Pages secondaires chargées à la demande : la page d'accueil reste légère
const AdminPage = lazy(() => import("@/pages/AdminPage"));
const LegalNotice = lazy(() => import("@/pages/LegalPages").then((m) => ({ default: m.LegalNotice })));
const Terms = lazy(() => import("@/pages/LegalPages").then((m) => ({ default: m.Terms })));
const Privacy = lazy(() => import("@/pages/LegalPages").then((m) => ({ default: m.Privacy })));

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="breachradar-theme">
      <AuthProvider>
        <div className="App">
          <BrowserRouter>
            <Suspense fallback={<div className="min-h-screen bg-background" />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/mentions-legales" element={<LegalNotice />} />
              <Route path="/cgv" element={<Terms />} />
              <Route path="/confidentialite" element={<Privacy />} />
            </Routes>
            </Suspense>
          </BrowserRouter>
          <Toaster position="top-right" richColors />
        </div>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
