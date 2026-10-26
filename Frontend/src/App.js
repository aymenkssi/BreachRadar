import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/components/AuthProvider";
import Dashboard from "@/pages/Dashboard";

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="breachradar-theme">
      <AuthProvider>
        <div className="App">
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Dashboard />} />
            </Routes>
          </BrowserRouter>
          <Toaster position="top-right" richColors />
        </div>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
