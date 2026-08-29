import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.SENTINEL_HUB_CLIENT_ID;
  const clientSecret =
    process.env.SENTINEL_HUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        success: false,
        error: "Sentinel Hub credentials are missing.",
      },
      { status: 500 }
    );
  }

  const body = new URLSearchParams();

  body.append("grant_type", "client_credentials");
  body.append("client_id", clientId);
  body.append("client_secret", clientSecret);

  try {
    const response = await fetch(
      "https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",
        },
        body,
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const text = await response.text();

      console.error(
        "Sentinel Hub authentication failed:",
        text
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Sentinel Hub authentication failed.",
        },
        { status: 401 }
      );
    }

    const data = await response.json();

    return NextResponse.json({
      success: true,
      message:
        "Sentinel Hub authentication is working.",
      tokenReceived: Boolean(data.access_token),
      expiresIn: data.expires_in ?? null,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        error:
          "Could not connect to Sentinel Hub.",
      },
      { status: 500 }
    );
  }
}