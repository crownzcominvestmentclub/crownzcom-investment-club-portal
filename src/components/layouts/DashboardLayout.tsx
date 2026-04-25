import { Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Wallet, Banknote, ReceiptText, LineChart, FileBarChart2,
  FolderOpen, Settings, LogOut, Menu, ChevronLeft, BadgeDollarSign, Bell,
} from "lucide-react";
import { useState } from "react";
import { NavLink } from "@/components/NavLink";
import { BrandLogo } from "@/components/BrandLogo";
import { RoleSwitcher } from "@/components/RoleSwitcher";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

const adminNav = [
  { to: "/app/admin", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/app/admin/members", label: "Members", icon: Users },
  { to: "/app/admin/savings", label: "Savings", icon: Wallet },
  { to: "/app/admin/loans", label: "Loans", icon: Banknote },
  { to: "/app/admin/subscriptions", label: "Subscriptions", icon: BadgeDollarSign },
  { to: "/app/admin/unit-trust", label: "Unit Trust", icon: LineChart },
  { to: "/app/admin/expenses", label: "Expenses", icon: ReceiptText },
  { to: "/app/admin/reports", label: "Reports", icon: FileBarChart2 },
  { to: "/app/admin/documents", label: "Documents", icon: FolderOpen },
  { to: "/app/admin/settings", label: "Settings", icon: Settings },
];

const memberNav = [
  { to: "/app/member", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/app/member/savings", label: "My Savings", icon: Wallet },
  { to: "/app/member/loans", label: "My Loans", icon: Banknote },
  { to: "/app/member/subscriptions", label: "Subscriptions", icon: BadgeDollarSign },
  { to: "/app/member/reports", label: "Reports", icon: FileBarChart2 },
  { to: "/app/member/profile", label: "Profile", icon: Users },
];

interface DashboardLayoutProps {
  variant: "admin" | "member";
}

export function DashboardLayout({ variant }: DashboardLayoutProps) {
  const { user, activeRole, signOut } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const nav = variant === "admin" ? adminNav : memberNav;
  const heading = variant === "admin" ? "Administration" : "Member Portal";

  const handleSignOut = () => {
    signOut();
    navigate("/login");
  };

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col bg-sidebar text-sidebar-foreground transition-all duration-200 ease-out lg:static",
          collapsed ? "lg:w-[72px]" : "lg:w-64",
          mobileOpen ? "w-64 translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className={cn("flex items-center border-b border-sidebar-border px-4 py-4", collapsed && "lg:justify-center lg:px-2")}>
          <BrandLogo size="sm" variant="dark" showWordmark={!collapsed} />
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {!collapsed && (
            <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
              {heading}
            </p>
          )}
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                collapsed && "lg:justify-center lg:px-2"
              )}
              activeClassName="bg-sidebar-primary/15 text-sidebar-primary-foreground !text-white border-l-2 border-sidebar-primary"
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="hidden w-full items-center justify-center rounded-md p-2 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground lg:flex"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-foreground/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-card/80 px-4 backdrop-blur md:px-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="hidden md:block">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{heading}</p>
              <h1 className="text-sm font-semibold text-foreground">
                {activeRole === "admin" ? "Administrator dashboard" : "Member dashboard"}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <RoleSwitcher />
            <Button variant="ghost" size="icon" aria-label="Notifications">
              <Bell className="h-4 w-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-full p-1 transition-colors hover:bg-muted">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                      {initials(user?.name ?? "?")}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{user?.name}</span>
                    <span className="text-xs font-normal text-muted-foreground">{user?.email}</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 md:px-6 lg:px-8">
          <div className="animate-fade-in mx-auto w-full max-w-[1400px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
