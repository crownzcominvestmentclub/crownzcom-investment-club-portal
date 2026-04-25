import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DashboardLayout } from "@/components/layouts/DashboardLayout";

import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import AppEntry from "./pages/AppEntry";

import AdminOverview from "./pages/admin/AdminOverview";
import AdminMembers from "./pages/admin/AdminMembers";
import AdminSavings from "./pages/admin/AdminSavings";
import AdminLoans from "./pages/admin/AdminLoans";
import AdminSubscriptions from "./pages/admin/AdminSubscriptions";
import AdminUnitTrust from "./pages/admin/AdminUnitTrust";
import AdminExpenses from "./pages/admin/AdminExpenses";
import AdminReports from "./pages/admin/AdminReports";
import AdminDocuments from "./pages/admin/AdminDocuments";
import AdminSettings from "./pages/admin/AdminSettings";

import MemberOverview from "./pages/member/MemberOverview";
import MemberSavings from "./pages/member/MemberSavings";
import MemberLoans from "./pages/member/MemberLoans";
import MemberSubscriptions from "./pages/member/MemberSubscriptions";
import MemberReports from "./pages/member/MemberReports";
import MemberProfile from "./pages/member/MemberProfile";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/login" element={<Login />} />

            {/* Authenticated app */}
            <Route element={<ProtectedRoute />}>
              <Route path="/app" element={<AppEntry />} />
            </Route>

            {/* Admin */}
            <Route element={<ProtectedRoute requireRole="admin" />}>
              <Route path="/app/admin" element={<DashboardLayout variant="admin" />}>
                <Route index element={<AdminOverview />} />
                <Route path="members" element={<AdminMembers />} />
                <Route path="savings" element={<AdminSavings />} />
                <Route path="loans" element={<AdminLoans />} />
                <Route path="subscriptions" element={<AdminSubscriptions />} />
                <Route path="unit-trust" element={<AdminUnitTrust />} />
                <Route path="expenses" element={<AdminExpenses />} />
                <Route path="reports" element={<AdminReports />} />
                <Route path="documents" element={<AdminDocuments />} />
                <Route path="settings" element={<AdminSettings />} />
              </Route>
            </Route>

            {/* Member */}
            <Route element={<ProtectedRoute requireRole="member" />}>
              <Route path="/app/member" element={<DashboardLayout variant="member" />}>
                <Route index element={<MemberOverview />} />
                <Route path="savings" element={<MemberSavings />} />
                <Route path="loans" element={<MemberLoans />} />
                <Route path="subscriptions" element={<MemberSubscriptions />} />
                <Route path="reports" element={<MemberReports />} />
                <Route path="profile" element={<MemberProfile />} />
              </Route>
            </Route>

            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
