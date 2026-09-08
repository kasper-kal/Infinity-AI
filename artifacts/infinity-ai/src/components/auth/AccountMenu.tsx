/**
 * AccountMenu — Desktop header dropdown showing the signed-in user's
 * avatar / name with quick access to profile, settings, MFA, and logout.
 *
 * Drop-in for DesktopShell headerActions.
 */
import React from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { haptics } from "@/lib/haptics";
import { User, Shield, LogOut } from "lucide-react";

export interface AccountMenuProps {
  /** Navigate to a settings sub-section (e.g. 'account', 'security') */
  onNavigateSettings?: (section: string) => void;
}

export const AccountMenu: React.FC<AccountMenuProps> = ({ onNavigateSettings }) => {
  const { account, logout } = useAuth();
  const { t } = useI18n();

  if (!account) return null;

  const initials = account.displayName
    ? account.displayName.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : account.email.slice(0, 2).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-full p-0.5 hover:ring-2 hover:ring-accent/30 transition-all focus:outline-none"
          aria-label={t("auth.accountMenu")}
        >
          <Avatar className="w-8 h-8">
            {account.avatarUrl && <AvatarImage src={account.avatarUrl} alt={account.displayName || account.email} />}
            <AvatarFallback className="bg-accent/20 text-accent text-xs font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-0.5">
            <p className="text-sm font-medium leading-none truncate">{account.displayName || account.email}</p>
            <p className="text-xs text-muted-foreground truncate">{account.email}</p>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => {
            haptics.light();
            onNavigateSettings?.("account");
          }}
          className="gap-2"
        >
          <User className="w-4 h-4" />
          {t("auth.profile")}
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => {
            haptics.light();
            onNavigateSettings?.("security");
          }}
          className="gap-2"
        >
          <Shield className="w-4 h-4" />
          {t("settings.security")}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={async () => {
            haptics.medium();
            await logout();
          }}
          className="gap-2 text-red-400 focus:text-red-400"
        >
          <LogOut className="w-4 h-4" />
          {t("auth.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default AccountMenu;