# Catalogs API Notes

The prototype in `index.html` calls the local `server.js` proxy, which maps a selected image area to Shopify's Global Catalog MCP.

## Current Shopify shape

- Endpoint: `https://catalog.shopify.com/api/ucp/mcp`
- Tool: `search_catalog`
- Image similarity input: `catalog.like`
- Image format: base64 content plus MIME type, for example:

```json
{
  "catalog": {
    "like": [
      {
        "image": {
          "content_type": "image/jpeg",
          "data": "<base64>"
        }
      }
    ],
    "filters": {
      "available": true,
      "ships_to": { "country": "US" }
    },
    "context": {
      "address_country": "US",
      "currency": "USD"
    },
    "pagination": {
      "limit": 50
    }
  }
}
```

Add a `query` beside `like` when you want multimodal search, such as "black leather jacket" plus the uploaded outfit image.

## Current implementation

`server.js` exposes `POST /api/catalog-search`, which:

1. Accepts a browser-side crop from the selected image area.
2. Sends that crop as base64.
3. Optionally calls Gemini with the crop to produce a tighter shopping query.
4. Calls `search_catalog` with `catalog.like` plus the Gemini query when available.
5. Requests 50 products per page, then passes Shopify's returned pagination cursor for "Load more".
6. Normalizes `products[].media`, `price_range`, and `variants[].seller` into the product card shape.
7. Uses `url` for product/store pages and `checkout_url` only for the separate Buy action.

Keep the Catalog call server-side so the browser does not own agent profile details or future auth tokens.
