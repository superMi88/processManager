import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { signToken, verifyToken } from "@/lib/auth";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;

    if (!token) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    return NextResponse.json({ authenticated: true, email: payload.email });
  } catch (error) {
    console.error("Auth check error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    const envEmail = process.env.AUTH_EMAIL;
    const envPassword = process.env.AUTH_PASSWORD;

    if (!envEmail || !envPassword) {
      return NextResponse.json(
        { error: "Server authentication is not properly configured in .env" },
        { status: 500 }
      );
    }

    if (email !== envEmail || password !== envPassword) {
      return NextResponse.json(
        { error: "Ungültige E-Mail-Adresse oder Passwort" },
        { status: 401 }
      );
    }

    const token = await signToken({ email });
    if (!token) {
      return NextResponse.json(
        { error: "Fehler beim Erstellen der Sitzung" },
        { status: 500 }
      );
    }

    const cookieStore = await cookies();
    cookieStore.set("auth_token", token, {
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      maxAge: 60 * 60 * 24, // 24 hours
      path: "/",
    });

    return NextResponse.json({ success: true, email });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const cookieStore = await cookies();
    cookieStore.delete("auth_token");
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
