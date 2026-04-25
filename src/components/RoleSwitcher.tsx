import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ShieldCheck, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function RoleSwitcher() {
  const { user, activeRole, switchRole } = useAuth();
  const navigate = useNavigate();

  if (!user || user.roles.length < 2) return null;

  const switchTo = activeRole === "admin" ? "member" : "admin";
  const Icon = switchTo === "admin" ? ShieldCheck : UserRound;
  const label = switchTo === "admin" ? "Switch to Admin" : "Switch to Member";

  const handle = () => {
    switchRole(switchTo);
    navigate(switchTo === "admin" ? "/app/admin" : "/app/member");
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="sm" onClick={handle} className="gap-2">
          <Icon className="h-4 w-4" />
          <span className="hidden sm:inline">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label} dashboard</TooltipContent>
    </Tooltip>
  );
}
