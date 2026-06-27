# Shopping Agent Notes

Raw thought stream. Do not over-resolve yet.

## Starting Thought

Agent-to-agent marketplace.

A Shopify merchant can have an agent to manage the shop:

> "Put my shop on autopilot."

But based on merchant-defined rules.

The shopper also has an agent.

Question:

> What does commerce look like when the merchant agent and shopper agent can talk to each other?

## Context

This is for brainstorming creative use cases around Shopify UCP + Catalogs API.

It is all based on shopping.

Not just "discover products."

Maybe more like:

> Find what you need.

## First Principles Questions

What is a shop?

Why do people shop?

How do people shop?

How much of shopping is research before purchase?

What does "need" mean in shopping?

What does "trust" mean in shopping?

What does the shopper already know before they search?

What does the shopper not know yet?

## How People Shop

People do not always start from a clean need.

Sometimes they know exactly what they want.

Example:

> I want AirPods.

Then the default store might be Apple. Maybe Best Buy or Amazon if price/delivery matters.

Sometimes they do not know what to buy yet.

Example:

> I need headphones for running.

Then they search, compare, read, and try to figure out what matters.

So shopping mode depends on category and certainty.

## Clothes And Shoes

For clothes and shoes, shopper often already has initial shops in mind.

They do not start from the whole internet.

They start from trusted or familiar places:

> Check the shops I already like first.

Then expand only if needed.

This matters.

An agent should know the shopper's preferred shops.

It should not always start with global search.

## Pinterest As Taste Memory

Pinterest boards could be imported as taste memory.

Not necessarily as shopping inventory.

More like:

> This is what I am drawn to.

Possible use:

1. Import boards.
2. Learn taste from saved images.
3. Use preferred shops as first search path.
4. Use Shopify Catalog to find buyable matches.

Question:

> Can Pinterest become the shopper's taste layer, while Shopify becomes execution layer?

## User May Not Know The Need

"User states need" is not always true.

Sometimes user only has:

- screenshot
- vague vibe
- Pinterest board
- event
- item they almost like
- store they usually check
- category with uncertainty
- "I need something but I don't know what"

Agent may need to help form the need.

Question:

> How does agent turn messy shopping signal into a clear shopping task?

## Shop App Concern

Looking at Shop app reviews, most critical reviews are logistics and trust problems:

- delivery takes weeks
- product quality issues
- sizing issues
- scam shops
- poor merchant support
- customer feels abandoned

Shop does not fully control these things.

If someone builds something similar to Shop, they may inherit the same problems.

Unless they control the value chain to the customer.

That is hard from day one.

Question:

> If you do not control fulfillment, quality, sizing, returns, and merchant behavior, what can you control?

## Seller Confidence Layer

Do not make trust the whole UI.

Use trust as a ranking and buy-decision layer inside LACE.

Simple flow:

1. Show all good visual matches.
2. Rank trusted or preferred sellers higher.
3. Label seller confidence.
4. For Buy button, recommend safest offer.
5. If risky seller has best item, show warning plus safer alternatives.

Useful product sentence:

> Best match, safest seller.

Example:

> Found the look across Shopify. Best safe buy is from X. Cheapest is Y, but lower confidence.

### Seller Confidence Levels

- Unknown: not enough data.
- Checked: passed basic checks.
- Trusted: good order/support history.
- Protected: buyer gets refund guarantee.

Do not overclaim.

If LACE cannot refund or enforce buyer protection, call seller "Checked" or "Trusted", not "Protected".

### What Vetted Means

Vetted store means store passed trust checks and has enough evidence to recommend.

It does not mean perfect.

### Priority

Need now:

- domain age / first seen date
- HTTPS and basic domain health
- visible contact page
- visible return/refund policy
- visible shipping policy
- suspicious shipping language
- external web reputation search
- obvious scam keywords
- price outlier vs similar catalog matches
- product photo reuse if reverse-image tooling is available
- user-preferred shops list

These can support:

- Unknown
- Checked
- Risk warning
- Preferred seller ranking

Need soon:

- merchant identity verification
- working return address
- real carrier tracking quality
- customer complaint history
- delivery outcome history
- support response history

These can support:

- Trusted
- better Buy recommendation
- lower-ranking risky sellers

Not needed now:

- chargeback/dispute rate
- payout holds
- merchant removal rules
- refund guarantee
- platform-funded buyer protection

These require payment/control layer.

They support:

- Protected
- real accountability

Important distinction:

> Checked is an information product. Protected is a financial/accountability product.

Start with Checked. Do not pretend to be Protected.

### Important Product Rule

Do not hard-filter to only vetted stores.

Hard filtering hurts LACE because Shopify Catalog breadth is the advantage.

Better rule:

> Discovery broad. Checkout narrow.

Show visual matches broadly, then guide the buy action toward safer sellers.

## What Remains

Maybe the agent can give customers better information.

But not as generic warnings.

The agent should have the shopper's best interest at heart.

Question:

> What does a shopper-first agent look like when it cannot control the merchant?

Possible direction:

The agent helps the shopper decide where to route intent.

It knows:

- taste
- preferred shops
- category behavior
- urgency
- budget
- uncertainty level
- past likes/dislikes
- maybe purchase/return history later

It may know when to search broadly and when to stay inside trusted shops.

## Merchant Agent

Merchant agent manages the shop on autopilot.

It follows rules:

- what to promote
- when to discount
- what not to promise
- how to bundle
- how to answer product questions
- when to escalate
- how to protect margin
- how to handle low stock
- how to match shopper intent

Open question:

> Does merchant agent sell better because it understands shopper intent more clearly?

## Shopper Agent

Shopper agent acts for shopper.

It should not be merchant-biased.

It should know:

- where shopper likes to shop
- what shopper likes visually
- what shopper is trying to solve
- when shopper is uncertain
- when shopper already knows the brand/store
- when research is needed

Open question:

> What does the shopper agent send to merchant agents?

Possibilities:

- "Looking for this vibe."
- "Need this by Friday."
- "Only show trusted stores first."
- "Prefer these brands."
- "Avoid risky sizing."
- "Budget is around X."
- "User is still exploring."
- "User knows exact item."

## Agent-To-Agent Marketplace

Potential shape:

1. Shopper agent has messy intent.
2. Shopper agent clarifies or structures it.
3. Shopper agent routes it through preferred shops first.
4. Merchant agents respond with options, bundles, terms, and constraints.
5. Shopper agent compares responses against shopper taste/trust/context.
6. Shopper sees a small set of high-confidence options.

Question:

> Is the new marketplace a marketplace of products, or a marketplace of intent?

## Voice

Voice may be shiny.

Do not start with voice as product.

But voice might help when shopper is forming messy intent:

- walking through closet
- packing
- cooking
- looking at item in hand
- describing vague need

Question:

> Is voice useful because shopping need starts messy and conversational?

## Core Open Questions

- What is a shop in agentic commerce?
- What does "autopilot" mean for a merchant?
- What does "best interest of the shopper" mean in practice?
- How does agent know when to search broadly vs start from preferred stores?
- How does agent help when shopper does not know how to state need?
- Can Pinterest boards become taste memory?
- Can preferred shops become trust memory?
- What can a shopping agent control if it cannot control delivery, quality, and returns?
- Is this a consumer product first, merchant product first, or protocol/network first?
