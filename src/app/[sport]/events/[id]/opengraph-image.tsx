import { ImageResponse } from "next/og";
import { baht, levelRange } from "@/lib/constants";
import { createPublicClient } from "@/lib/supabase/server";
import { formatDay, formatTimeRange } from "@/lib/time";

export const alt = "Tennis event on Rallyz";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The preview card shown when an event link is posted in Facebook or LINE. */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: e } = /^[0-9a-f-]{36}$/i.test(id)
    ? await createPublicClient()
        .from("events")
        .select("title, starts_at, ends_at, area, venue_name, level_min, level_max, fee_thb, spots_left, capacity, cancelled_at")
        .eq("id", id)
        .maybeSingle()
    : { data: null };

  const title = e?.title ?? "Tennis on Rallyz";
  const spots = !e ? "" : e.cancelled_at ? "Cancelled" : e.spots_left > 0 ? `${e.spots_left} of ${e.capacity} spots left` : "Full · join the waitlist";

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0f6e56", color: "white", padding: 64, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 36, fontWeight: 800 }}>
          <div style={{ width: 36, height: 36, borderRadius: 999, background: "#c9f0df" }} />
          Rallyz
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: title.length > 40 ? 60 : 76, fontWeight: 800, lineHeight: 1.05 }}>{title}</div>
          {e ? (
            <div style={{ display: "flex", fontSize: 34, color: "#f0fbf5" }}>
              {formatDay(e.starts_at)} · {formatTimeRange(e.starts_at, e.ends_at)} · {e.area}
            </div>
          ) : null}
        </div>
        {e ? (
          <div style={{ display: "flex", gap: 16, fontSize: 30, fontWeight: 700 }}>
            {[levelRange(e.level_min, e.level_max), baht(e.fee_thb), spots].map((t) => (
              <div key={t} style={{ display: "flex", background: t === spots ? "#c9f0df" : "rgba(255,255,255,0.12)", color: t === spots ? "#0b5a46" : "white", padding: "12px 24px", borderRadius: 999 }}>
                {t}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", fontSize: 30 }}>Find tennis games at your level in Bangkok</div>
        )}
      </div>
    ),
    size,
  );
}
