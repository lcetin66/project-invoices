// Project owner: Levent Cetin
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const nextPath = request.nextUrl.searchParams.get("next") || "/dashboard";
  const html = `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Demo session</title>
  </head>
  <body>
    <script>
      document.cookie = "rm_demo_mode=1; path=/; max-age=3600; samesite=lax";
      window.location.href = ${JSON.stringify(nextPath)};
    </script>
    <p>Demo session is being prepared...</p>
  </body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
