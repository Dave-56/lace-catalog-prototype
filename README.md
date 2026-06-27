# LACE

**Taste layer on top of agentic commerce.** Shopify made it possible for any agent to search, compare, and buy across *every* Shopify store. LACE is the consumer-facing experience that wraps those rails in *taste* — so shopping feels like a friend with great style picking things out for you, not 47 browser tabs.

## Prototype

Run the live Catalog prototype with:

```sh
npm run start
```

Then open `http://localhost:3000`. Pick or upload a look, drag over one item, and press Search. The frontend calls `POST /api/catalog-search`, which proxies the selected image crop to Shopify Global Catalog `search_catalog` using `catalog.like`.

To test Gemini query enhancement, add a key to `.env`:

```sh
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-3.5-flash
```

Restart the server after changing `.env`. With a key present, the selected crop is first sent to Gemini to produce a specific shopping query, then Shopify Catalog receives both the crop and that query.

> Name = fashion-native (lace / laces). It's a **structure, not a model**: one product, four modes (L·A·C·E) you can ship in tiers. Rename freely.

---

## The four modes

| | Mode | One-liner | Maps to |
|---|---|---|---|
| **L** | **Look** | Snap or save any outfit photo → buy that one piece, *or* the whole fit, at the best price, in one tap. | shop-the-look / visual buy |
| **A** | **Ask** | Tell it what you want ("rooftop party fit, ~$200") → it shops every store and comes back with options ready to buy. | shopping agent (pull) |
| **C** | **Compare** | Found the item? It shows every seller of that exact product — cheapest, in-stock, fastest — and buys the best. | deals / price compare |
| **E** | **Edit** | Every Friday, a curated drop of new arrivals matched to your taste. Discovery comes to you, pre-filtered. | curation feed (push) |

**The thread:** one engine (search across all stores → compare offers → check out), four front doors. **L** you snap, **A** you ask, **C** saves money, **E** comes to you.

---

## Why now

Shopify's **Spring '26 Edition** shipped the **Universal Commerce Protocol (UCP)** + **Shopify Catalog** — the rails that make LACE buildable by a solo founder in a way that was impossible two weeks ago.

What changed (from the docs):
- **One protocol to shop all of Shopify.** `Global Catalog` lets an agent `search_catalog` (by **text, image, or find-similar**), `lookup_catalog`, and `get_product` (variants, pricing, checkout link) — across *every* Shopify merchant. No per-store integration grind.
- **Image search is native.** `search_catalog` takes an image and returns *buyable* matches. That's Google Lens — but the results check out. (Powers **L**.)
- **Compare is native.** Global Catalog clusters results by **Universal Product ID (UPID)** and returns **offers from multiple merchants** for the same product. Price-compare is free out of the box. (Powers **C**.)
- **Agents can complete checkout.** Higher trust tiers unlock direct checkout completion.

**The plumbing that used to be the wall is now free.** So the moat isn't the tech — it's whatever is still hard after UCP: **taste, trust, and the relationship with the shopper.** That's all LACE.

Docs: https://shopify.dev/docs/agents · https://shopify.dev/docs/agents/catalog · https://www.shopify.com/news/spring-26-edition-merchant

---

## Why it's interesting (the Big Plays)

Each piece is *already* a big company — which proves demand. **Nobody has combined them with taste + cross-merchant checkout.**

- **Compare** → Honey (~$4B to PayPal), **Phia** (Phoebe Gates' cross-site price-compare startup). Proven, but commodity — a price function, no taste moat.
- **Look** → Google Lens (genuinely good) finds the item — but doesn't compare sellers, doesn't buy, doesn't do the *whole outfit*.
- **Edit / discovery** → Pinterest won shopping-as-taste by sitting *on top* of everyone's catalog, never being a store.
- **Curation/trust** → LTK, Stitch Fix ($1.7B peak) prove people pay for someone else's taste.

The gap nobody owns: **taste + buy the whole look + across every store, in one flow.** LACE.

---

## The tension (read before building)

- **Compare (C) "works always" — but everyone does it.** Honey, Phia, *and* ChatGPT compare prices natively now. Starting here = race to the bottom on affiliate cents, squeezed between giants. No defensibility.
- **Look (L) is the superset.** Build shop-the-look and the others fall out as features:
  - assembling the cart → pick best offer per item = **C baked in**
  - "tap to shop" = **A**
  - "new looks for you Friday" = **E**
  - So **L is the house; A/C/E are rooms inside it.** Starting with C traps you in a commodity room with no taste.
- **Don't fight Shopify on "general."** Shop app stays bland by necessity (100M users). Win where they *structurally can't*: a narrow scene whose taste they'd never ship. Sit *on top* of the rails; don't rebuild Shop.

---

## What to start with

**L — Look.** Reasons:
1. **Founder-fit** — it's the original pain (planning an outfit across stores, hating the tab-juggle).
2. **Taste moat** — "copy this whole vibe" needs curation, not price-matching. Honey/Phia can't.
3. **Superset** — absorbs A/C/E as features instead of fighting them.
4. **Native tech** — Shopify's image search does the visual match; you build taste + experience, not ML.

Pitch: *"Snap or save any outfit → buy that piece, or the whole look, at the best price, in one tap. Lens that checks out."*

---

## The one open question

**Which scene's taste?** Not "fashion" — too broad, no unfair access, Shopify competes. A *specific* vibe the founder lives in, where their taste is unfair and they'd be trusted (streetwear? a subculture? a specific aesthetic?). 

This is the only unsolved input. Everything downstream — the look sources, the curation, the go-to-market, the defensibility — depends on it. **Shopify built the rest. This part is yours to name.**

---

## How the engine works (for the next agent)

```
image / text query
        │
        ▼
search_catalog  ──►  matches across ALL Shopify merchants
(text · image · find-similar)     clustered by UPID
        │
        ▼
get_product  ──►  variants, every seller's offer (price/stock/shipping)
        │
        ▼
checkout link / direct completion (trust-tier gated)
```

- **Single item** = run the flow once (Lens mode).
- **Whole look** = detect each garment in the image, run the flow per item, merge into one cart.
- Pinterest/IG/screenshots are just *image sources* — input is any image. Not an integration with any one platform.

Next steps to flesh out: pick the scene (niche), map where its "looks" come from, design the L experience, then layer C/A/E.
