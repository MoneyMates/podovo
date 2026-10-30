# Podovo × Fidel API backend

Two serverless endpoints, deployed as their own Vercel project (separate from podovo-api). They store linked cards per listener and turn Fidel purchase notifications into points.

| Endpoint | Who calls it | What it does |
|---|---|---|
| `POST /api/fidel-webhook` | Fidel | Saves linked cards and matched purchases (Pending on authorization, Confirmed when it clears, negative points on refunds). Verifies Fidel's signature and ignores anything older than 5 minutes. |
| `POST /api/fidel-link` | Wallet page | Right after Fidel links a card, records which listener (email) it belongs to. Fidel only gets an opaque Podovo ID in card metadata, never the email. |
| `GET /api/fidel-wallet?email=` | Wallet page | Returns the listener's linked cards (brand + last 4 only), points totals and last 20 matched purchases. CORS limited to podovo.ai and webflow.io. |

No npm packages needed (Node 18+ `fetch`, built-in `crypto`).

## 1. Deploy on Vercel
In Vercel: Add New › Project › import `MoneyMates/podovo`, framework preset "Other", no build settings, then Deploy. Every push to `main` redeploys. The endpoints live at `https://<project>.vercel.app/api/...`; use that address in steps 4 and 5 below.

## 2. Airtable tables (in the base the project already uses)
**Fidel Cards**: `Card ID` (single line text, primary), `Email`, `Scheme`, `Last4`, `Status` (single select: Linked, Failed), `Linked At` (date/time), `Live` (checkbox).

**Fidel Transactions**: `Transaction ID` (single line text, primary), `Card ID`, `Email`, `Brand`, `Amount` (number, 2 decimals), `Currency`, `Status` (single select: Pending, Confirmed, Refunded), `Points` (number), `Datetime` (date/time), `Original Transaction ID`.

## 3. Vercel environment variables
| Name | Value |
|---|---|
| `AIRTABLE_TOKEN` | Airtable personal access token with read/write on the base |
| `AIRTABLE_BASE_ID` | `app...` |
| `FIDEL_SECRET_KEY` | Fidel secret API key (`sk_test_...` first, `sk_live_...` later) |
| `FIDEL_WEBHOOK_SECRET` | The webhook `secretKey` from the Fidel dashboard |
| `POINTS_PER_DOLLAR` | Points per $1 at a partner brand (default 100; 5,000 points = $1 when redeemed, so 2% back) |
| `FIDEL_WEBHOOK_URL` | Optional. Only if the URL registered in Fidel differs from the deployed URL |

## 4. Register the webhook in Fidel (test mode)
In the Fidel dashboard, add `https://<project>.vercel.app/api/fidel-webhook` for the program's **card.linked**, **card.failed**, **transaction.auth**, **transaction.clearing** and **transaction.refund** events. Use the same URL and secret for all of them. Fidel doesn't send the event name, so the endpoint tells events apart by the payload.

## 5. Turn it on in the Wallet page
In Webflow, the `FidelOpen` page script holds `window.PODOVO_FIDEL`. Fill in `sdkKey` (`pk_test_...`), `programId`, and `apiBase` (the new project address), then publish. The Wallet then shows cards and points from this backend.

## 6. Test
Link Fidel test card `4444 0000 0000 4004` (any future expiry) on the Wallet, then create a test transaction in the Fidel dashboard against that card. The row appears in Airtable as Pending, then Confirmed, and the Wallet points update.

## Known limits (fix before real cards)
- **Identity:** the Wallet's sign-in is browser-only, so the email sent to Fidel (card metadata) and to `/api/fidel-wallet` isn't verified server-side. Anyone who knows a listener's email could see their card brand, last 4 and points. Before launch, issue a signed session token at sign-in and require it on `/api/fidel-wallet`.
- **Points rate** is a single flat rate. Per-brand or tier multipliers (the Wallet mentions a 10× Gold multiplier) aren't applied yet.
- Signature format follows Fidel's docs; confirm with a real test-mode webhook before going live (a 401 in the Vercel logs means it didn't match).

`node test.js` runs the local tests (fake Airtable and Fidel).
