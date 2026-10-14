"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

export type NavItem = { href: string; label: string };

/** Header links, styled like the main rallyz.club navbar. */
export function MainNav({ items, className }: { items: NavItem[]; className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className={className}>
      {items.map((n) => {
        const active = n.href.startsWith("/") && (pathname === n.href || pathname.startsWith(n.href + "/"));
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "whitespace-nowrap text-[15px] transition-colors hover:text-ink",
              active ? "font-medium text-ink" : "text-[#555]",
            )}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
