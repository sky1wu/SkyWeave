import { AppError } from "@/server/errors";
import { sharedItinerary } from "@/server/itinerary-share-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const headers = {
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "Referrer-Policy": "no-referrer",
  };
  try {
    const { token } = await context.params;
    return Response.json(sharedItinerary(token), { headers });
  } catch (error) {
    const known = error instanceof AppError;
    return Response.json(
      {
        error: {
          code: known ? error.code : "INTERNAL",
          message: known ? error.message : "暂时无法加载行程，请稍后重试",
        },
      },
      { status: known ? error.status : 500, headers },
    );
  }
}
