# LACE Trust Layer Temp Plan

Goal: avoid sending shoppers to dead, blocked, or obviously questionable storefronts while keeping LACE's visual discovery broad.

## Ideology

- Discovery broad, checkout narrow.
- Do not claim scam detection before we have real evidence.
- Do not call a shop Protected unless LACE can enforce refunds or buyer protection.
- Start with basic seller confidence that improves product UX:
  - hide dead or blocked clicks
  - rank known/preferred sellers higher
  - label uncertainty plainly

## Confidence Labels

### Current Definitions

- Preferred: shop saved in Orbit.
- Checked: product URL passed live reachability check.
- Reviewed: product URL passed reachability check and Catalog result has rating evidence, currently `rating.count >= 20`.
- Unknown: product URL has not been checked yet.
- Needs check: product URL failed reachability. Hidden by default.

### Future Real Definitions

- Preferred: shop user saved in Orbit or explicitly marked as preferred.
- Checked: product/shop URL is reachable and basic storefront checks pass.
- Reviewed: enough review/rating evidence from a trusted source.
- Trusted: strong order, support, delivery, and return history over time.
- Protected: LACE/payment layer can enforce refund or buyer protection.
- Unknown: enough product data to show, but not enough seller evidence to recommend buying directly.
- Needs check: failed reachability, blocked storefront, suspicious storefront signals, or missing key purchase evidence.

Important:

- Checked is an information product.
- Protected is a financial/accountability product.
- Do not call a seller Protected until LACE can enforce buyer protection.

## Policy Signal Terms

- Return/refund policy: storefront exposes terms for returns, refunds, exchanges, or final sale.
- Shipping policy: storefront exposes shipping timelines, regions, costs, or carrier expectations.
- Contact page: storefront exposes customer support path such as email, form, phone, or help page.
- Complete policy evidence: return/refund policy + shipping policy + contact page are all present.
- Policy evidence is not proof of trust. It only supports `Checked`.

## Orbit Preference

- Saved shop in Orbit means shopper explicitly wants LACE to remember that shop.
- Orbit saved shop becomes `Preferred` in Catalog results.
- Preferred is a shopper-affinity label, not a safety guarantee.
- Preferred sellers still need reachability checks before display.

## Build Phases

1. Seller confidence layer
   - Add `sellerConfidence` to catalog products.
   - Orbit saved shops become Preferred.
   - Reachable product URLs become Checked.
   - Failed product URLs become hidden Needs check.
   - Catalog rating count can become Reviewed after reachability passes.
   - Show shopper-facing evidence chips on cards.
   - Sort safer sellers first.
   - Filter hidden `Needs check` sellers from default results.

2. Real reachability gate
   - Product URL reachability is implemented server-side.
   - Product URL checks are cached in memory for the local session.
   - Product URLs that timeout, fail DNS, return 4xx/5xx, or fail redirects are hidden as `Needs check`.
   - Seller homepage reachability still needs implementation.

3. Basic storefront evidence
   - HTTPS.
   - Contact page.
   - Return/refund policy.
   - Shipping policy.
   - Suspicious shipping/refund language.
   - Price outlier vs similar results.

4. Trust evidence
   - Review history.
   - Complaint history.
   - Support response quality.
   - Delivery outcome history.
   - Return outcome history.

## Current Prototype Rule

Show product cards only when:

- image exists
- product URL exists
- product URL passes reachability

Catalog media recovery:

- If `search_catalog` returns products but no image media, retry smaller limits server-side.
- If retry recovers image-backed products, return those to the UI silently.
- If retry fails, return no cards instead of `NO IMAGE` cards.
- Cursor/load-more pages stop when Shopify returns image-less products.

Then rank:

1. Preferred
2. Checked
3. Reviewed
4. Unknown

Action behavior:

- View is allowed for Preferred, Checked, Reviewed, and Unknown.
- Buy is active only for Preferred, Checked, and Reviewed.
- Unknown shows a disabled Review action instead of direct Buy.
- Needs check remains hidden from default view.

Shopper-facing card evidence:

- Do not make the primary UI say abstract labels like `Checked` or `Reviewed`.
- Show the evidence consumers actually care about:
  - `24 reviews`
  - `0 reviews`
  - `30-day returns`
  - `Support found`
  - `Shipping details`
  - `Ships from US`
  - `Saved shop`
  - `Look before buying`
- For now, returns/contact/shipping evidence is mocked in the frontend to test product UX.
- Tooltips can show one-line details, for example `Returns accepted within 30 days.`
- Needs check: do not show in default product-card UI.

Internal debug reasons can mention reachability, status codes, confidence levels, policy evidence, or mock rules. Do not show those raw reasons in product-card UI.

## Open Questions

- Should users be able to expand hidden `Needs check` results?
- Should Orbit saved shops automatically become Preferred?
- Which source should become the first real reviews signal?
