import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";
import type { AppRole } from "@/lib/types";

interface ProtectedProps {
  requireRole?: AppRole;
}

export function ProtectedRoute({ requireRole }: ProtectedProps) {
  const { user, activeRole, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (requireRole && activeRole !== requireRole) {
    // Auto-redirect based on the role they actually have access to
    if (user.roles.includes(requireRole)) {
      return <Navigate to={requireRole === "admin" ? "/app/admin" : "/app/member"} replace />;
    }
    return <Navigate to={user.roles.includes("admin") ? "/app/admin" : "/app/member"} replace />;
  }

  return <Outlet />;
}
