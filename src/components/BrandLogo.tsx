import { Coins } from "lucide-react";
import { cn } from "@/lib/utils";

interface BrandLogoProps {
  className?: string;
  size?: "sm" | "md" | "lg";
  showWordmark?: boolean;
  variant?: "light" | "dark";
}

const sizeMap = {
  sm: { box: "h-8 w-8", icon: "h-4 w-4", title: "text-sm", sub: "text-[10px]" },
  md: { box: "h-10 w-10", icon: "h-5 w-5", title: "text-base", sub: "text-xs" },
  lg: { box: "h-14 w-14", icon: "h-7 w-7", title: "text-xl", sub: "text-sm" },
};

export function BrandLogo({ className, size = "md", showWordmark = true, variant = "light" }: BrandLogoProps) {
  const s = sizeMap[size];
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className={cn(
          "flex items-center justify-center rounded-lg bg-gradient-primary text-primary-foreground shadow-glow",
          s.box
        )}
      >
        <Coins className={s.icon} strokeWidth={2.25} />
      </div>
      {showWordmark && (
        <div className="flex flex-col leading-tight">
          <span
            className={cn(
              "font-semibold tracking-tight",
              s.title,
              variant === "dark" ? "text-sidebar-foreground" : "text-foreground"
            )}
          >
            Crownzcom
          </span>
          <span
            className={cn(
              "uppercase tracking-[0.18em]",
              s.sub,
              variant === "dark" ? "text-sidebar-foreground/60" : "text-muted-foreground"
            )}
          >
            Investment Club
          </span>
        </div>
      )}
    </div>
  );
}
