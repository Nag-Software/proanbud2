import { Buffer } from "buffer"
import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getDocusignAuthContext, getDocusignJwtConsentUrl } from "@/lib/integrations/docusign/client"

type TestAction = "consent" | "auth" | "account" | "envelope"

type TestPayload = {
  action?: TestAction
  recipientEmail?: string
  recipientName?: string
  sendNow?: boolean
}

async function resolveContext() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }

  const { data: userRow } = await supabase
    .from("users")
    .select("company_id, role")
    .eq("id", user.id)
    .maybeSingle()

  if (!userRow?.company_id) {
    return { error: NextResponse.json({ error: "Company context missing" }, { status: 400 }) }
  }

  const canManage = userRow.role === "admin"
  if (!canManage) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }

  return { companyId: userRow.company_id }
}

function buildTestDocument(companyId: string) {
  const body = [
    "DocuSign API Test Document",
    "",
    `Company: ${companyId}`,
    `Generated at: ${new Date().toISOString()}`,
    "",
    "If you can sign this test envelope, the integration works.",
    "",
    "DocuSign.",
  ].join("\n")

  return Buffer.from(body, "utf8").toString("base64")
}

export async function POST(request: Request) {
  const ctx = await resolveContext()
  if ("error" in ctx) return ctx.error

  const payload = (await request.json().catch(() => ({}))) as TestPayload
  const action = payload.action || "account"

  try {
    if (action === "consent") {
      const consentUrl = getDocusignJwtConsentUrl()
      return NextResponse.json({ ok: true, action, consentUrl })
    }

    const auth = await getDocusignAuthContext()

    if (action === "auth") {
      return NextResponse.json({
        ok: true,
        action,
        accountId: auth.accountId,
        baseUri: auth.baseUri,
        tokenPreview: `${auth.accessToken.slice(0, 12)}...${auth.accessToken.slice(-8)}`,
      })
    }

    if (action === "account") {
      const response = await fetch(`${auth.baseUri}/restapi/v2.1/accounts/${auth.accountId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          Accept: "application/json",
        },
        cache: "no-store",
      })

      const accountPayload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return NextResponse.json(
          { error: accountPayload?.message || "DocuSign account request failed" },
          { status: response.status }
        )
      }

      return NextResponse.json({
        ok: true,
        action,
        account: {
          accountId: String(accountPayload?.accountId || auth.accountId),
          accountName: String(accountPayload?.accountName || ""),
          isDefault: Boolean(accountPayload?.isDefault),
          baseUri: auth.baseUri,
        },
      })
    }

    if (action === "envelope") {
      const recipientEmail = String(payload.recipientEmail || "").trim()
      if (!recipientEmail) {
        return NextResponse.json({ error: "recipientEmail er påkrevd for envelope-test" }, { status: 400 })
      }

      const recipientName = String(payload.recipientName || "Test Signer").trim() || "Test Signer"
      const sendNow = payload.sendNow === true
      const documentBase64 = buildTestDocument(ctx.companyId)

      const envelopeResponse = await fetch(`${auth.baseUri}/restapi/v2.1/accounts/${auth.accountId}/envelopes`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          emailSubject: "DocuSign API tester - test envelope",
          documents: [
            {
              documentBase64,
              name: "docusign-api-test.txt",
              fileExtension: "txt",
              documentId: "1",
            },
          ],
          recipients: {
            signers: [
              {
                email: recipientEmail,
                name: recipientName,
                recipientId: "1",
                routingOrder: "1",
                tabs: {
                  signHereTabs: [
                    {
                      anchorString: "DocuSign.",
                      anchorUnits: "pixels",
                      anchorYOffset: "10",
                      anchorXOffset: "0",
                    },
                  ],
                },
              },
            ],
          },
          status: sendNow ? "sent" : "created",
        }),
        cache: "no-store",
      })

      const envelopePayload = await envelopeResponse.json().catch(() => ({}))
      if (!envelopeResponse.ok) {
        return NextResponse.json(
          { error: envelopePayload?.message || "DocuSign envelope create failed" },
          { status: envelopeResponse.status }
        )
      }

      return NextResponse.json({
        ok: true,
        action,
        envelope: {
          envelopeId: String(envelopePayload?.envelopeId || ""),
          status: String(envelopePayload?.status || ""),
          uri: typeof envelopePayload?.uri === "string" ? `${auth.baseUri}${envelopePayload.uri}` : null,
        },
      })
    }

    return NextResponse.json({ error: "Ugyldig action" }, { status: 400 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "DocuSign test failed" },
      { status: 500 }
    )
  }
}
