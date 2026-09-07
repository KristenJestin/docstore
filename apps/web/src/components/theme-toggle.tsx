import { Button } from "@docstore/ui/components/button";
import { DropdownMenuItem } from "@docstore/ui/components/dropdown-menu";
import { MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

/** `true` only after hydration: `resolvedTheme` does not exist during SSR. */
function useIsDark(): { isDark: boolean; toggle: () => void } {
	const { resolvedTheme, setTheme } = useTheme();
	const [mounted, setMounted] = useState(false);

	useEffect(() => setMounted(true), []);

	const isDark = !mounted || resolvedTheme === "dark";
	return { isDark, toggle: () => setTheme(isDark ? "light" : "dark") };
}

export interface ThemeToggleProps {
	className?: string;
	size?: "icon" | "icon-sm";
}

/** Light / dark switch as an icon button (`next-themes`). */
export function ThemeToggle({ className, size = "icon" }: ThemeToggleProps) {
	const { isDark, toggle } = useIsDark();

	return (
		<Button
			variant="ghost"
			size={size}
			className={className}
			aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
			title="Toggle light / dark"
			onClick={toggle}
		>
			{isDark ? <SunIcon /> : <MoonIcon />}
		</Button>
	);
}

/** Same switch, as a menu item (sidebar user block). */
export function ThemeMenuItem() {
	const { isDark, toggle } = useIsDark();

	return (
		<DropdownMenuItem closeOnClick={false} onClick={toggle}>
			{isDark ? <SunIcon /> : <MoonIcon />}
			{isDark ? "Light theme" : "Dark theme"}
		</DropdownMenuItem>
	);
}
