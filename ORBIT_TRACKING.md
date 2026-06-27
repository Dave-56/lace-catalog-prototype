# Orbit Tracking

Orbit is LACE's shopper memory layer. For Shopify, it should save shops and items first. Brand is optional metadata later.

It should not own every downstream behavior.

Product split:

- Look = find item from image.
- Orbit = save shops and items.
- Alerts = notify changes like price drops, restocks, and new drops.
- Compare = find better deals, cheaper sellers, or similar items for less.

Orbit answers: what does the shopper care about?

Alerts answers: what changed?

Compare answers: can the shopper get a better option?

For now, Orbit should stay focused on memory: followed shops, watched items, and pasted shop/product links.

Shopify-native object model:

- Shop = merchant/storefront/seller user wants LACE to remember.
- Item = exact product user wants LACE to remember.
- Brand = optional metadata, not primary MVP object.

## 1. Watch Item

Represents: exact item intent.

The shopper found an item they care about and wants LACE to remember it.

Agent focus:
- Add `Watch` action to product cards.
- Save item identifiers, title, seller shop, image, URL, checkout URL, current price, and source context.
- Show watched items in Orbit.

Out of scope for Orbit:
- Price-drop notifications belong to Alerts.
- Similar-for-less recommendations belong to Compare.

## 2. Paste Link

Represents: imported existing intent.

The shopper already has a shop or item URL from elsewhere and wants LACE to remember it.

Agent focus:
- Add link input to Orbit.
- Parse shop/item URLs.
- Extract domain and basic metadata.
- Save as followed shop or watched item.

Out of scope for Orbit:
- Change detection belongs to Alerts.
- Seller/offer comparison belongs to Compare.

## 3. Search/Add Shops

Represents: explicit shop affinity.

The shopper names shops they want LACE to keep in their orbit. This is an always-available Orbit action, not onboarding.

Agent focus:
- Add shop search/add flow.
- Save followed shops.
- Persist follow/unfollow state.
- Prepare records for later Catalog enrichment.

Out of scope for Orbit:
- New-drop notifications belong to Alerts.
- Cheaper alternatives belong to Compare.

## 4. Upload Screenshot

Represents: bulk taste import.

The shopper uploads a screenshot of Shop, saved shops, carts, wishlists, or shopping tabs so LACE can extract possible shops/items.

Agent focus:
- Add screenshot upload to Orbit.
- Extract shop/item candidates with OCR or vision.
- Ask user to confirm matches.
- Save confirmed shops/items.

Out of scope for Orbit:
- Automated alerting belongs to Alerts.
- Alternative item discovery belongs to Compare.

## Build Work Split

### Phase 1: Orbit Data

Goal: make Orbit memory persistent.

Build:
- `data/orbit.json`
- `GET /api/orbit`
- `POST /api/orbit/sources`
- `PATCH /api/orbit/sources/:id`
- `DELETE /api/orbit/sources/:id`

Source record:

```json
{
  "id": "src_123",
  "type": "shop",
  "name": "STAUD",
  "domain": "staud.clothing",
  "url": "https://staud.clothing",
  "checkoutUrl": "",
  "imageUrl": "",
  "source": "search_add_shop",
  "shopId": "",
  "itemId": "",
  "sellerName": "STAUD",
  "currentPrice": null,
  "currency": "USD",
  "createdAt": "2026-06-26T00:00:00.000Z",
  "updatedAt": "2026-06-26T00:00:00.000Z"
}
```

Allowed `type` values:
- `shop`
- `item`

Allowed `source` values:
- `watch_item`
- `paste_link`
- `search_add_shop`
- `screenshot`

### Phase 2: Watch Item

Goal: connect Look to Orbit.

Build:
- Add `Watch` action to product cards.
- Save selected catalog result as `type: "item"`.
- Show watched items on Orbit page.
- Prevent duplicates by item URL, catalog product id, or checkout URL.

Do not build:
- Price-drop alerts.
- Similar-for-less compare.

### Phase 3: Paste Link

Goal: import shopper intent from URLs.

Build:
- Add link input to Orbit.
- Parse URL.
- If URL looks like shop homepage, save as `type: "shop"`.
- If URL looks like product page, save as `type: "item"`.
- Extract domain as first metadata pass.

Do not build:
- Full scraper.
- Alert checks.
- Offer comparison.

### Phase 4: Search/Add Shops

Goal: let shopper explicitly add shops anytime.

Build:
- Replace mock brand cards with saved shop cards.
- Add shop search/add input.
- Save as `type: "shop"` and `source: "search_add_shop"`.
- Persist follow/unfollow through Orbit API.

Do not build:
- Brand-first model.
- Onboarding-only flow.

### Phase 5: Upload Screenshot

Goal: bulk import shops/items after core data works.

Build:
- Add screenshot upload.
- Extract shop/item candidates.
- Show confirmation step.
- Save confirmed records only.

Do not build first:
- OCR before persistent Orbit data exists.
- Auto-save low-confidence matches.
