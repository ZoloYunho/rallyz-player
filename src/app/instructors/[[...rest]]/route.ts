import type { NextRequest } from "next/server";
import { forwardToSport } from "@/lib/legacy-redirect";
import { coachSport } from "@/lib/sport-of";

export async function GET(req: NextRequest, ctx: RouteContext<"/instructors/[[...rest]]">) {
  const { rest } = await ctx.params;
  return forwardToSport(req, "instructors", rest, coachSport);
}
