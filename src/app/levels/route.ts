import type { NextRequest } from "next/server";
import { forwardToSport } from "@/lib/legacy-redirect";

export async function GET(req: NextRequest) {
  return forwardToSport(req, "levels");
}
