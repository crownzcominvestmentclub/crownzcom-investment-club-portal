import { useState, useEffect } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { Mail, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { configService } from "@/services";

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
    <path
      fill="#EA4335"
      d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3.3 14.7 2.4 12 2.4 6.7 2.4 2.5 6.7 2.5 12s4.2 9.6 9.5 9.6c5.5 0 9.1-3.9 9.1-9.3 0-.6-.1-1.1-.2-1.6H12z"
    />
  </svg>
);

export default function Login() {
  const { user, signInWithEmail, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loadingMode, setLoadingMode] = useState<null | "email" | "google">(null);
  const [allowEmailLogin, setAllowEmailLogin] = useState(true);

  useEffect(() => {
    configService
      .get()
      .then((cfg) => setAllowEmailLogin(cfg.allowEmailLogin))
      .catch(() => setAllowEmailLogin(true));
  }, []);

  if (user) return <Navigate to="/app" replace />;

  const onEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoadingMode("email");
    try {
      await signInWithEmail(email, password);
      navigate("/app");
    } catch (err: any) {
      toast({ title: "Sign in failed", description: err?.message ?? "Try again", variant: "destructive" });
    } finally {
      setLoadingMode(null);
    }
  };

  const onGoogle = async () => {
    setLoadingMode("google");
    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL;
      if (apiBase) {
        window.location.href = `${apiBase}/api/auth/google/sign-in`;
        return;
      }
      await signInWithGoogle();
      navigate("/app");
    } catch (err: any) {
      toast({ title: "Google sign in failed", description: err?.message ?? "Try again", variant: "destructive" });
    } finally {
      setLoadingMode(null);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <section className="w-full max-w-sm space-y-8">
        <header className="space-y-2 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Crownzcom Investment Club</p>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        </header>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={onGoogle}
          disabled={loadingMode !== null}
        >
          {loadingMode === "google" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <span className="mr-2"><GoogleIcon /></span>
          )}
          Continue with Google
        </Button>

        {allowEmailLogin ? (
          <>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase tracking-wide">
                <span className="bg-background px-3 text-muted-foreground">or with email</span>
              </div>
            </div>

            <form onSubmit={onEmail} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email address</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="you@crownzcom.ug"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loadingMode !== null}>
                {loadingMode === "email" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Sign in
              </Button>
            </form>
          </>
        ) : null}
      </section>
    </main>
  );
}
