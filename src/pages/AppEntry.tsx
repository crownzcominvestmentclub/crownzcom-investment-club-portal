import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/** Routes the user to the right dashboard based on their active role. */
export default function AppEntry() {
  const { user, activeRole, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={activeRole === "admin" ? "/app/admin" : "/app/member"} replace />;
}
