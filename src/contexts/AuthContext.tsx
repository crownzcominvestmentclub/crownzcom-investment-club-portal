// Auth context — UI-only for now. Backend auth will be wired to the Cloudflare Worker /api/auth endpoints.
//
// Behaviour:
//   - Persists the active user + active role in localStorage so role switching survives reloads.
//   - Exposes `signInWithEmail` / `signInWithGoogle` placeholders that resolve from seed users.
//   - Exposes `switchRole()` for users that hold both `admin` and `member`.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AppRole, AuthUser } from "@/lib/types";
import { authService } from "@/services";

interface AuthContextValue {
  user: AuthUser | null;
  activeRole: AppRole | null;
  loading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<AuthUser>;
  signInWithGoogle: () => Promise<AuthUser>;
  signOut: () => void;
  switchRole: (role: AppRole) => void;
  hasRole: (role: AppRole) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_USER = "cic.auth.user";
const STORAGE_ROLE = "cic.auth.role";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeRole, setActiveRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const restore = async () => {
      try {
        const r = localStorage.getItem(STORAGE_ROLE) as AppRole | null;
        if (import.meta.env.VITE_API_BASE_URL) {
          try {
            const me = await authService.me();
            if (me) {
              const role = (r && me.roles.includes(r) ? r : me.roles[0]) ?? null;
              setUser(me);
              setActiveRole(role);
              persist(me, role);
            } else {
              persist(null, null);
            }
          } catch {
            persist(null, null);
          }
        } else {
          const u = localStorage.getItem(STORAGE_USER);
          if (u) {
            const parsed = JSON.parse(u) as AuthUser;
            setUser(parsed);
            setActiveRole(r && parsed.roles.includes(r) ? r : parsed.roles[0]);
          }
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };

    restore();
  }, []);

  const persist = (u: AuthUser | null, role: AppRole | null) => {
    if (u) {
      localStorage.setItem(STORAGE_USER, JSON.stringify(u));
    } else {
      localStorage.removeItem(STORAGE_USER);
    }
    if (role) {
      localStorage.setItem(STORAGE_ROLE, role);
    } else {
      localStorage.removeItem(STORAGE_ROLE);
    }
  };

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const found = await authService.signInWithEmail(email, password);
    if (!found) throw new Error("No account found for that email");
    const role = found.roles[0];
    setUser(found);
    setActiveRole(role);
    persist(found, role);
    return found;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (import.meta.env.VITE_API_BASE_URL) {
      throw new Error("Google sign-in is handled through the Worker redirect.");
    }
    const all = await authService.list();
    const dual = all.find((u) => u.roles.includes("admin") && u.roles.includes("member")) ?? all[0];
    const role = dual.roles[0];
    setUser(dual);
    setActiveRole(role);
    persist(dual, role);
    return dual;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await authService.signOut();
    } catch {
      // ignore sign-out errors
    }
    setUser(null);
    setActiveRole(null);
    persist(null, null);
  }, []);

  const switchRole = useCallback(
    (role: AppRole) => {
      if (!user || !user.roles.includes(role)) return;
      setActiveRole(role);
      persist(user, role);
    },
    [user]
  );

  const hasRole = useCallback((role: AppRole) => !!user?.roles.includes(role), [user]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, activeRole, loading, signInWithEmail, signInWithGoogle, signOut, switchRole, hasRole }),
    [user, activeRole, loading, signInWithEmail, signInWithGoogle, signOut, switchRole, hasRole]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
