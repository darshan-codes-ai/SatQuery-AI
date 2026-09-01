"use client";

import { usePathname } from "next/navigation";

const items = [
  { label: "Dashboard", href: "/" },
  { label: "Analyze", href: "/analyze" },
  { label: "Area Statistics", href: "/area-stats" },
  { label: "Change Detection", href: "/change-detection" },
  { label: "Satellite Explorer", href: "/satellite-explorer" },
];

export default function TopNav() {
  const pathname = usePathname();

  const goTo = (href: string) => {
    window.location.href = href;
  };

  return (
    <nav className="hidden md:flex items-center gap-6 lg:gap-8">
      {items.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);

        return (
          <button
            key={item.href}
            type="button"
            onClick={() => goTo(item.href)}
            className={`
              relative
              py-2
              text-sm
              whitespace-nowrap
              transition
              ${
                active
                  ? "text-white"
                  : "text-gray-500 hover:text-white"
              }
            `}
          >
            {item.label}

            {active && (
              <span className="absolute -bottom-1 left-0 right-0 h-0.5 rounded-full bg-cyan-400" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
