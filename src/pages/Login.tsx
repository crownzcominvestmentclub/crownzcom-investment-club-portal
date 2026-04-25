import { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { Mail, Loader2, ShieldCheck, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandLogo } from "@/components/BrandLogo";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

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
      await signInWithGoogle();
      navigate("/app");
    } catch (err: any) {
      toast({ title: "Google sign in failed", description: err?.message ?? "Try again", variant: "destructive" });
    } finally {
      setLoadingMode(null);
    }
  };

  return (
    <main className="grid min-h-screen w-full lg:grid-cols-2">
      {/* Brand panel */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-gradient-hero p-12 text-primary-foreground lg:flex">
        <div className="absolute inset-0 opacity-[0.07]" aria-hidden>
          <div className="absolute -left-24 top-12 h-72 w-72 rounded-full bg-primary-glow blur-3xl" />
          <div className="absolute -bottom-32 right-0 h-96 w-96 rounded-full bg-primary blur-3xl" />
        </div>
        <BrandLogo size="lg" variant="dark" />
        <div className="relative max-w-md space-y-6">
          <h1 className="text-4xl font-semibold leading-tight">
            Manage your club's <span className="text-primary-glow">savings, loans</span> and growth — all in one place.
          </h1>
          <p className="text-base text-primary-foreground/70">
            A modern platform built for member-owned investment clubs and SACCOs. Track contributions,
            run guarantor-backed lending, and produce AGM-ready reports without the spreadsheet chaos.
          </p>
          <ul className="space-y-3 pt-2 text-sm text-primary-foreground/80">
            <li className="flex items-center gap-3">
              <ShieldCheck className="h-4 w-4 text-primary-glow" /> Server-authoritative loan workflows
            </li>
            <li className="flex items-center gap-3">
              <Lock className="h-4 w-4 text-primary-glow" /> Role-based admin & member access
            </li>
          </ul>
        </div>
        <p className="relative text-xs text-primary-foreground/50">
          © {new Date().getFullYear()} Crownzcom Investment Club
        </p>
      </aside>

      {/* Form panel */}
      <section className="flex items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden">
            <BrandLogo size="md" />
          </div>

          <header className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
            <p className="text-sm text-muted-foreground">
              Sign in to access your dashboard. Members and administrators use the same login.
            </p>
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
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <button type="button" className="text-xs text-primary hover:underline">
                  Forgot password?
                </button>
              </div>
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loadingMode !== null}>
              {loadingMode === "email" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Sign in
            </Button>
          </form>

          <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">Demo access</p>
            <p>Use <code className="rounded bg-background px-1 py-0.5">admin@crownzcom.ug</code> for admin,
              {" "}or any member email from the seed data. Password is not validated in preview.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
