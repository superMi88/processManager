import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Define paths that are public
  const isAuthApi = pathname.startsWith("/api/auth");
  const isLoginPage = pathname === "/login";
  
  // Static assets and internal next paths
  const isStatic =
    pathname.startsWith("/_next") ||
    pathname.startsWith("/static") ||
    pathname.includes(".") ||
    pathname === "/favicon.ico";

  // Bypass checking for static files
  if (isStatic) {
    return NextResponse.next();
  }

  // Get token from cookie
  const token = request.cookies.get("auth_token")?.value;
  const hasValidToken = token ? await verifyToken(token) : null;

  // Protect Pages
  if (!isAuthApi && !isLoginPage) {
    if (!hasValidToken) {
      // If the request is for an API endpoint, return 401 JSON
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "Nicht autorisiert. Bitte anmelden." },
          { status: 401 }
        );
      }
      // Otherwise, redirect to login page
      const loginUrl = new URL("/login", request.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Redirect logged-in users away from /login to dashboard /
  if (isLoginPage && hasValidToken) {
    const dashboardUrl = new URL("/", request.url);
    return NextResponse.redirect(dashboardUrl);
  }

  return NextResponse.next();
}

// Config to specify matching routes
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (handled inside the proxy via startsWith)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
