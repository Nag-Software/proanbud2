import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const error = url.searchParams.get("error")
  const errorDescription = url.searchParams.get("error_description")

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        provider: "docusign",
        error,
        errorDescription,
      },
      { status: 400 }
    )
  }

  return NextResponse.json({
    ok: true,
    provider: "docusign",
    message:
      "Consent callback mottatt. Du kan nå gå tilbake til DocuSign-testeren og kjøre Test JWT auth på nytt.",
    codePresent: Boolean(code),
  })
}
