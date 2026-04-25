import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/** Public landing — sends signed-in users to /app, others to /login. */
const Index = () => {
  const { user, loading } = useAuth();
  if (loading) return null;
  return <Navigate to={user ? "/app" : "/login"} replace />;
};

export default Index;
