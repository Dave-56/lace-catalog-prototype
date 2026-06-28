const http = require("node:http");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

loadEnvFile();

process.on("unhandledRejection", (error) => {
  console.error("[unhandled-rejection]", error?.stack || error);
});

process.on("uncaughtException", (error) => {
  console.error("[uncaught-exception]", error?.stack || error);
});

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const ORBIT_DATA_PATH = path.join(DATA_DIR, "orbit.json");
const ALERTS_DATA_PATH = path.join(DATA_DIR, "alerts.json");
const CATALOG_ENDPOINT = "https://catalog.shopify.com/api/ucp/mcp";
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const DEFAULT_AGENT_PROFILE =
  "https://shopify.dev/ucp/agent-profiles/2026-04-08/valid-with-capabilities.json";
const AGENT_PROFILE = process.env.SHOPIFY_UCP_AGENT_PROFILE || DEFAULT_AGENT_PROFILE;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const CATALOG_PAGE_LIMIT = 25;
const MAX_CATALOG_PAGE_LIMIT = 30;
const PRODUCT_URL_CHECK_TTL_MS = 15 * 60 * 1000;
const PRODUCT_URL_CHECK_CACHE_MAX = 400;
const productUrlCheckCache = new Map();
let alertsWriteQueue = Promise.resolve();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        name: "lace-catalog-prototype",
        time: new Date().toISOString(),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/catalog-search") {
      await handleCatalogSearch(request, response);
      return;
    }

    if (url.pathname === "/api/orbit" || url.pathname.startsWith("/api/orbit/sources")) {
      await handleOrbitRequest(request, response, url);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/shop-detail") {
      await handleShopDetailRequest(response, url);
      return;
    }

    if (url.pathname === "/api/alerts" || url.pathname.startsWith("/api/alerts/")) {
      await handleAlertsRequest(request, response, url);
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      await serveStatic(url.pathname, request, response);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("[server-error]", error.stack || error.message || error);
    sendJson(response, 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`LACE Catalog prototype: http://localhost:${PORT}`);
});

async function handleCatalogSearch(request, response) {
  const body = await readJsonBody(request);
  const image = await resolveImage(body);

  if (!image?.data) {
    sendJson(response, 400, { error: "Send an uploaded image or imageUrl." });
    return;
  }

  const limit = clampInteger(body.limit, CATALOG_PAGE_LIMIT, 1, MAX_CATALOG_PAGE_LIMIT);
  const cursor = typeof body.cursor === "string" ? body.cursor.trim() : "";
  const suppliedQuery = normalizeGeminiSearchQuery(body.searchQuery);
  const queryEnhancement = suppliedQuery
    ? {
        used: false,
        reason: "reused_search_query",
        searchQuery: suppliedQuery,
      }
    : await enhanceQueryWithGemini(image);
  const searchQuery = suppliedQuery || queryEnhancement.searchQuery || "fashion clothing accessory";
  const preferredShopDomains = await getPreferredShopDomains();
  const catalog = {
    like: [
      {
        image: {
          content_type: image.contentType,
          data: image.data,
        },
      },
    ],
    filters: {
      available: true,
      ships_to: { country: "US" },
    },
    context: {
      address_country: "US",
      currency: "USD",
      intent: `A shopper selected one fashion product in an image and wants buyable matches. Query: ${searchQuery}`,
    },
    pagination: {
      limit,
    },
  };

  if (cursor) {
    catalog.pagination.cursor = cursor;
  }

  catalog.query = searchQuery;

  const catalogResult = await searchCatalogWithImageFallback(catalog, {
    allowFallback: !cursor,
    initialLimit: limit,
    preferredShopDomains,
  });
  const {
    visibleProducts,
    missingImages,
    hiddenTrust,
    normalizedCount,
    pagination,
    usedLimit,
    attemptedLimits,
    recoveredImages,
  } = catalogResult;

  console.log(
    `[catalog-search] query="${searchQuery}" limit=${usedLimit} products=${normalizedCount} returned=${visibleProducts.length} missingImages=${missingImages} hiddenTrust=${hiddenTrust} recoveredImages=${recoveredImages}`,
  );

  sendJson(response, 200, {
    products: visibleProducts,
    omittedMissingImages: missingImages,
    omittedTrustFiltered: hiddenTrust,
    catalogRecovery: {
      attemptedLimits,
      recoveredImages,
    },
    searchQuery,
    queryEnhancement,
    messages: catalogResult.messages,
    pagination,
  });
}

async function handleOrbitRequest(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/orbit") {
    sendJson(response, 200, await readOrbitData());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/orbit/sources") {
    const body = await readJsonBody(request);
    const data = await readOrbitData();
    const source = await normalizeOrbitSource(body);
    const duplicate = findDuplicateOrbitSource(data.sources, source);

    if (duplicate) {
      const changed = mergeMissingOrbitSourceFields(duplicate, source);

      if (changed) {
        duplicate.updatedAt = new Date().toISOString();
        await writeOrbitData(data);
      }

      sendJson(response, 200, { source: duplicate, duplicate: true });
      return;
    }

    data.sources.push(source);
    await writeOrbitData(data);
    sendJson(response, 201, { source, duplicate: false });
    return;
  }

  const sourceMatch = url.pathname.match(/^\/api\/orbit\/sources\/([^/]+)$/);

  if (sourceMatch && request.method === "PATCH") {
    const body = await readJsonBody(request);
    const data = await readOrbitData();
    const source = data.sources.find((item) => item.id === sourceMatch[1]);

    if (!source) {
      sendJson(response, 404, { error: "Orbit source not found." });
      return;
    }

    Object.assign(source, normalizeOrbitPatch(body), { updatedAt: new Date().toISOString() });
    await writeOrbitData(data);
    sendJson(response, 200, { source });
    return;
  }

  if (sourceMatch && request.method === "DELETE") {
    const data = await readOrbitData();
    const nextSources = data.sources.filter((item) => item.id !== sourceMatch[1]);

    if (nextSources.length === data.sources.length) {
      sendJson(response, 404, { error: "Orbit source not found." });
      return;
    }

    data.sources = nextSources;
    await writeOrbitData(data);
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 405, { error: "Method not allowed" });
}

async function handleShopDetailRequest(response, url) {
  const domain = normalizeDomain(url.searchParams.get("domain"));
  const suppliedUrl = cleanUrl(url.searchParams.get("url"));
  const shopUrl = suppliedUrl || (domain ? `https://${domain}/` : "");

  if (!domain && !shopUrl) {
    sendJson(response, 400, { error: "Send a shop domain or URL." });
    return;
  }

  const targetUrl = cleanUrl(shopUrl || domain);

  if (!targetUrl) {
    sendJson(response, 400, { error: "Shop URL must be http or https." });
    return;
  }

  const detail = await loadLiveShopDetail(targetUrl);

  sendJson(response, 200, detail);
}

async function handleAlertsRequest(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/alerts") {
    sendJson(response, 200, { alerts: await readAlertsInbox() });
    return;
  }

  const alertMatch = url.pathname.match(/^\/api\/alerts\/([^/]+)$/);

  if (alertMatch && request.method === "PATCH") {
    const alertId = decodeURIComponent(alertMatch[1]);
    const body = await readJsonBody(request);
    const orbitData = await readOrbitData();
    const candidates = generateAlertCandidates(orbitData.sources);
    const candidate = candidates.find((alert) => alert.id === alertId);

    if (!candidate) {
      sendJson(response, 404, { error: "Alert not found." });
      return;
    }

    const patch = normalizeAlertPatch(body);
    const nextState = await updateAlertsData(async (data) => {
      const current = data.states[alertId] || {};
      const state = normalizeStoredAlertState({
        ...current,
        ...patch,
        id: alertId,
        updatedAt: new Date().toISOString(),
      });

      data.states[alertId] = state;
      return state;
    });

    sendJson(response, 200, { alert: applyAlertState(candidate, nextState) });
    return;
  }

  sendJson(response, 405, { error: "Method not allowed" });
}

async function searchCatalogWithImageFallback(catalog, options = {}) {
  const fallbackLimits = [25, 20, 15, 10, 5].filter((limit) => limit < options.initialLimit);
  const attempts = [options.initialLimit, ...(options.allowFallback ? fallbackLimits : [])];
  let lastResult = null;
  const attemptedLimits = [];

  for (const limit of attempts) {
    attemptedLimits.push(limit);
    catalog.pagination.limit = limit;

    const catalogResponse = await callShopifyCatalog(catalog);
    const result = await normalizeCatalogSearchResult(catalogResponse, options);

    lastResult = {
      ...result,
      usedLimit: limit,
      attemptedLimits: [...attemptedLimits],
      recoveredImages: attemptedLimits.length > 1 && result.visibleProducts.length > 0,
    };

    if (result.visibleProducts.length > 0 || result.normalizedCount === 0 || result.missingImages === 0) {
      return lastResult;
    }
  }

  return lastResult || {
    visibleProducts: [],
    missingImages: 0,
    hiddenTrust: 0,
    normalizedCount: 0,
    pagination: null,
    messages: [],
    usedLimit: options.initialLimit,
    attemptedLimits: [options.initialLimit],
    recoveredImages: false,
  };
}

async function normalizeCatalogSearchResult(catalogResponse, options = {}) {
  const structured = catalogResponse.result?.structuredContent || {};
  const products = Array.isArray(structured.products) ? structured.products : [];
  const normalizedProducts = products.map((product) => normalizeProduct(product, options)).filter(Boolean);
  const productsWithImages = normalizedProducts.filter((product) => product.image);
  const checkedProducts = await Promise.all(productsWithImages.map(applyProductReachability));
  const visibleProducts = checkedProducts
    .filter((product) => !product.sellerConfidence?.hidden)
    .sort(compareSellerConfidence);
  const missingImages = normalizedProducts.length - productsWithImages.length;
  const hiddenTrust = checkedProducts.length - visibleProducts.length;
  const pagination = normalizedProducts.length > 0 && visibleProducts.length === 0
    ? null
    : structured.pagination || null;

  return {
    visibleProducts,
    missingImages,
    hiddenTrust,
    normalizedCount: normalizedProducts.length,
    pagination,
    messages: structured.messages || [],
  };
}

async function applyProductReachability(product) {
  const reachability = await getProductUrlReachability(product.url);

  if (reachability.reachable) {
    const sellerConfidence = getReachableSellerConfidence(product, reachability);

    return {
      ...product,
      linkReachability: reachability,
      sellerConfidence,
    };
  }

  return {
    ...product,
    linkReachability: reachability,
    sellerConfidence: {
      level: "needs_check",
      label: "Needs check",
      reason: reachability.reason,
      rank: 95,
      hidden: true,
    },
  };
}

async function getProductUrlReachability(url) {
  const cacheKey = makeProductUrlCheckCacheKey(url);

  if (!cacheKey) {
    return {
      reachable: false,
      reason: "Missing product URL.",
      cached: false,
    };
  }

  const cached = productUrlCheckCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.checkedAt < PRODUCT_URL_CHECK_TTL_MS) {
    return {
      ...cached.result,
      cached: true,
    };
  }

  const result = await checkProductUrl(cacheKey);
  productUrlCheckCache.set(cacheKey, { checkedAt: now, result });
  pruneProductUrlCheckCache();

  return {
    ...result,
    cached: false,
  };
}

function makeProductUrlCheckCacheKey(url) {
  const clean = cleanUrl(url);
  if (!clean) return "";

  try {
    const parsed = new URL(clean);
    ["_gsid", "shclid", "shdid", "utm_source", "utm_medium", "utm_campaign", "utm_content"].forEach((key) => {
      parsed.searchParams.delete(key);
    });

    parsed.hash = "";
    return parsed.toString();
  } catch {
    return clean;
  }
}

async function checkProductUrl(url) {
  const head = await fetchReachability(url, "HEAD");
  const shouldTryGet = !head.reachable && [403, 405, 501].includes(head.status);
  const result = shouldTryGet ? await fetchReachability(url, "GET") : head;

  if (result.reachable) {
    return {
      reachable: true,
      status: result.status,
      finalUrl: result.finalUrl,
      reason: `Reachable product URL (${result.status}).`,
    };
  }

  return {
    reachable: false,
    status: result.status || head.status || null,
    finalUrl: result.finalUrl || head.finalUrl || url,
    reason: result.reason || head.reason || "Product URL did not resolve.",
  };
}

async function fetchReachability(url, method) {
  try {
    const response = await fetch(url, {
      method,
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5",
        "User-Agent": "LACE prototype product reachability check",
      },
      signal: AbortSignal.timeout(6000),
    });

    return {
      reachable: response.status >= 200 && response.status < 400,
      status: response.status,
      finalUrl: response.url,
      reason: response.status >= 200 && response.status < 400
        ? `Reachable product URL (${response.status}).`
        : `Product URL returned ${response.status}.`,
    };
  } catch (error) {
    return {
      reachable: false,
      status: null,
      finalUrl: url,
      reason: error.name === "TimeoutError" ? "Product URL timed out." : error.message || "Product URL failed.",
    };
  }
}

function pruneProductUrlCheckCache() {
  if (productUrlCheckCache.size <= PRODUCT_URL_CHECK_CACHE_MAX) return;

  const overflow = productUrlCheckCache.size - PRODUCT_URL_CHECK_CACHE_MAX;
  const keys = productUrlCheckCache.keys();

  for (let index = 0; index < overflow; index += 1) {
    const next = keys.next();
    if (next.done) return;
    productUrlCheckCache.delete(next.value);
  }
}

async function loadLiveShopDetail(shopUrl) {
  const origin = getOrigin(shopUrl);
  const domain = normalizeDomain(origin);
  const errors = [];
  const collectionsJson = await readShopifyCollections(origin).catch((error) => {
    errors.push(`collections_json:${error.message}`);
    return null;
  });
  const latestProducts = await readLatestShopProducts(origin, collectionsJson?.rawCollections).catch((error) => {
    errors.push(`latest_products:${error.message}`);
    return {
      products: [],
      source: "fallback",
      url: origin,
    };
  });

  if (collectionsJson?.collections?.length) {
    return {
      domain,
      url: origin,
      source: "shopify_collections_json",
      live: true,
      title: collectionsJson.title || "",
      summary: collectionsJson.summary || "",
      collections: collectionsJson.collections,
      latestProducts: latestProducts.products,
      latestProductsSource: latestProducts.source,
      latestProductsUrl: latestProducts.url,
      errors,
    };
  }

  const homepage = await readHomepageDetail(origin).catch((error) => {
    errors.push(`homepage:${error.message}`);
    return null;
  });

  if (homepage?.collections?.length) {
    return {
      domain,
      url: origin,
      source: "homepage_links",
      live: true,
      title: homepage.title || "",
      summary: homepage.summary || "",
      collections: homepage.collections,
      latestProducts: latestProducts.products,
      latestProductsSource: latestProducts.source,
      latestProductsUrl: latestProducts.url,
      errors,
    };
  }

  return {
    domain,
    url: origin,
    source: "fallback",
    live: false,
    title: homepage?.title || collectionsJson?.title || "",
    summary: homepage?.summary || collectionsJson?.summary || "",
    collections: [],
    latestProducts: latestProducts.products,
    latestProductsSource: latestProducts.source,
    latestProductsUrl: latestProducts.url,
    errors,
  };
}

async function readShopifyCollections(origin) {
  const endpoint = new URL("/collections.json", origin);
  endpoint.searchParams.set("limit", "250");
  const data = await fetchJson(endpoint.toString());
  const rawCollections = Array.isArray(data.collections) ? data.collections : [];
  const collections = rawCollections
    .map((collection) => normalizeShopifyCollection(collection, origin))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 12)
    .map(({ score, ...collection }) => collection);

  return {
    title: "",
    summary: "",
    collections,
    rawCollections,
  };
}

async function readLatestShopProducts(origin, rawCollections = []) {
  const newestCollection = findNewestCollection(rawCollections);
  const attempts = [];

  if (newestCollection?.handle) {
    attempts.push({
      source: "new_arrivals_collection",
      url: new URL(`/collections/${newestCollection.handle}`, origin).toString(),
      endpoint: new URL(`/collections/${newestCollection.handle}/products.json`, origin).toString(),
    });
  }

  attempts.push({
    source: "all_products",
    url: new URL("/collections/all", origin).toString(),
    endpoint: new URL("/products.json", origin).toString(),
  });

  for (const attempt of attempts) {
    const endpoint = new URL(attempt.endpoint);
    endpoint.searchParams.set("limit", "24");

    const data = await fetchJson(endpoint.toString()).catch(() => null);
    const rawProducts = Array.isArray(data?.products) ? data.products : [];
    const products = rawProducts
      .map((product) => normalizeShopProduct(product, origin))
      .filter(Boolean)
      .sort(compareShopProductsByPublishedAt)
      .slice(0, 12);

    if (products.length) {
      return {
        products,
        source: attempt.source,
        url: attempt.url,
      };
    }
  }

  return {
    products: [],
    source: "none",
    url: newestCollection?.handle ? new URL(`/collections/${newestCollection.handle}`, origin).toString() : origin,
  };
}

function findNewestCollection(collections) {
  const ranked = (collections || [])
    .map((collection) => {
      const handle = cleanText(collection.handle);
      const title = cleanText(collection.title);
      const text = `${handle} ${title}`.toLowerCase();
      let score = 0;

      if (!handle || !title) return null;
      if (/new-arrivals|new_arrivals|new arrivals/.test(text)) score += 10;
      if (/\bnew\b|\barrivals?\b|\blatest\b|\bdrops?\b/.test(text)) score += 4;
      if (/archive|sale|gift|accessories|size|filter|vendor/.test(text)) score -= 4;

      return { collection, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.score > 0 ? ranked[0].collection : null;
}

function normalizeShopProduct(product, origin) {
  const handle = cleanText(product.handle);
  const title = cleanText(product.title);

  if (!handle || !title) return null;

  const variants = Array.isArray(product.variants) ? product.variants : [];
  const firstAvailableVariant = variants.find((variant) => variant.available !== false) || variants[0] || {};
  const images = collectShopProductImages(product, firstAvailableVariant);
  const primaryImage = choosePrimaryShopProductImage(images);
  const price = cleanText(firstAvailableVariant.price || product.variants?.[0]?.price);

  return {
    id: cleanText(product.id || handle),
    title,
    image: primaryImage?.url || "",
    images,
    price: price ? formatShopProductPrice(price) : "Price varies",
    url: new URL(`/products/${handle}`, origin).toString(),
    publishedAt: cleanText(product.published_at || product.created_at),
  };
}

function compareShopProductsByPublishedAt(a, b) {
  return getTimeValue(b.publishedAt) - getTimeValue(a.publishedAt);
}

function getTimeValue(value) {
  const time = Date.parse(value);

  return Number.isNaN(time) ? 0 : time;
}

function collectShopProductImages(product, variant) {
  const rawImages = [
    product.featured_image,
    ...(Array.isArray(product.images) ? product.images : []),
    variant.featured_image,
  ];
  const seen = new Set();

  return rawImages
    .map((image, index) => normalizeShopProductImage(image, variant, index))
    .filter(Boolean)
    .filter((image) => {
      const key = normalizeUrlKey(image.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((image) => ({
      ...image,
      kind: classifyShopProductImage(image),
    }))
    .sort(compareShopProductImages);
}

function normalizeShopProductImage(image, variant, index) {
  if (!image) return null;

  if (typeof image === "string") {
    const url = normalizeImageUrl(image);
    return url
      ? {
          url,
          alt: "",
          position: index,
          variantMatch: false,
        }
      : null;
  }

  const url = normalizeImageUrl(image.src || image.url || image.image || image.preview_image?.src);
  if (!url) return null;

  const variantIds = Array.isArray(image.variant_ids) ? image.variant_ids.map(String) : [];
  const variantId = cleanText(variant?.id);

  return {
    url,
    alt: cleanText(image.alt || image.alt_text),
    position: Number.isFinite(Number(image.position)) ? Number(image.position) : index,
    variantMatch: Boolean(variantId && variantIds.includes(variantId)),
  };
}

function normalizeImageUrl(value) {
  const url = cleanUrl(value);
  if (!url) return "";

  return url.startsWith("//") ? `https:${url}` : url;
}

function choosePrimaryShopProductImage(images) {
  return images.find((image) => image.kind === "model") || images[0] || null;
}

function compareShopProductImages(a, b) {
  const rank = { model: 0, lifestyle: 1, product: 2, flatlay: 3, unknown: 4 };
  const variantDelta = Number(b.variantMatch) - Number(a.variantMatch);

  return variantDelta || (rank[a.kind] ?? 4) - (rank[b.kind] ?? 4) || a.position - b.position;
}

function classifyShopProductImage(image) {
  const text = `${image.alt || ""} ${image.url || ""}`.toLowerCase();

  if (/on[-_ ]?model|onmodel|on[-_ ]?body|onbody|\b(model|worn|wearing|styled|fit pic|lookbook)\b/.test(text)) return "model";
  if (/\b(lifestyle|editorial|campaign|outfit)\b/.test(text)) return "lifestyle";
  if (/\b(flat[-_ ]?lay|laydown|ghost|packshot|product[-_ ]?shot|front|back|detail)\b/.test(text)) return "flatlay";

  return "unknown";
}

function formatShopProductPrice(value) {
  const amount = Number.parseFloat(value);

  if (!Number.isFinite(amount)) return value;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function normalizeShopifyCollection(collection, origin) {
  const handle = cleanText(collection.handle);
  const title = cleanText(collection.title);

  if (!handle || !title) return null;

  const collectionUrl = new URL(`/collections/${handle}`, origin).toString();
  const score = scoreCollectionLink(title, collectionUrl);

  if (score < 4) return null;

  return {
    name: title,
    description: cleanCollectionDescription(collection.body_html) || "Live Shopify collection.",
    url: collectionUrl,
    source: "shopify_collections_json",
    score,
  };
}

async function readHomepageDetail(origin) {
  const html = await fetchText(origin);
  const title = decodeHtml(stripTags(findFirstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i)));
  const summary = decodeHtml(
    findFirstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
      findFirstMatch(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i),
  );
  const collections = extractHomepageCollections(html, origin);

  return {
    title,
    summary,
    collections,
  };
}

function extractHomepageCollections(html, origin) {
  const candidates = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(html))) {
    const href = findFirstMatch(match[1], /\bhref=["']([^"']+)["']/i);
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;

    const resolved = resolveStorefrontUrl(href, origin);
    if (!resolved) continue;

    const label = cleanLinkLabel(decodeHtml(stripTags(match[2])));
    const score = scoreCollectionLink(label, resolved);
    if (score < 2) continue;

    candidates.push({
      name: label || nameFromPath(resolved),
      description: "Live storefront link discovered from homepage.",
      url: resolved,
      source: "homepage_links",
      score,
    });
  }

  const seen = new Set();

  return candidates
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .filter((collection) => {
      const key = normalizeUrlKey(collection.url);
      if (!collection.name || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8)
    .map(({ score, ...collection }) => collection);
}

function scoreCollectionLink(label, url) {
  const text = `${label} ${url}`.toLowerCase();
  let score = 0;

  if (/^\$?\d+(?:\.\d+)?(?:\s*(?:to|-)\s*\$?\d+)?$/i.test(label.trim())) score -= 10;
  if (/^(?:size\s*)?(?:00|0|[1-9]|1[0-9]|2[0-9]|3[0-9]|[xsml]{1,3}|[1-4]x)$/i.test(label.trim())) score -= 10;
  if (/\/collections\/(?:size-|color-|price-|filter-|vendor-)/.test(text)) score -= 8;
  if (/\/collections?\b|\/category\b|\/categories\b|\/c\//.test(text)) score += 4;
  if (/\bnew\b|new-arrivals|arrivals|women|menswear|womenswear|clothing|apparel/.test(text)) score += 3;
  if (/\bdresses?\b|denim|bags?|shoes?|tailoring|knitwear|tops?|pants?|trousers?|skirts?|jackets?|coats?/.test(text)) {
    score += 2;
  }
  if (/account|login|cart|checkout|privacy|terms|contact|help|stores?|shipping|returns?|sale/.test(text)) score -= 3;
  if (label.length > 44 || label.length < 2) score -= 1;

  return score;
}

function resolveStorefrontUrl(href, origin) {
  try {
    const url = new URL(href, origin);
    const originUrl = new URL(origin);

    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (normalizeDomain(url.hostname) !== normalizeDomain(originUrl.hostname)) return "";

    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function cleanCollectionDescription(value) {
  return cleanText(decodeHtml(stripTags(value))).slice(0, 150);
}

function cleanLinkLabel(value) {
  return cleanText(value)
    .replace(/\s+/g, " ")
    .replace(/\bopens in a new window\b/gi, "")
    .trim()
    .slice(0, 58);
}

function nameFromPath(url) {
  try {
    const pathname = new URL(url).pathname;
    const segment = pathname.split("/").filter(Boolean).pop() || "Collection";

    return segment
      .replace(/\.[a-z0-9]+$/i, "")
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
      .join(" ");
  } catch {
    return "Collection";
  }
}

function normalizeUrlKey(value) {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value;
  }
}

function findFirstMatch(value, pattern) {
  const match = String(value || "").match(pattern);
  return match?.[1] || "";
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ");
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "LACE prototype shop detail fetcher",
    },
    signal: AbortSignal.timeout(6000),
  });
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`returned_${response.status}`);
  }

  if (!contentType.includes("json")) {
    throw new Error("not_json");
  }

  return text ? JSON.parse(text) : {};
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "LACE prototype shop detail fetcher",
    },
    signal: AbortSignal.timeout(6000),
  });

  if (!response.ok) {
    throw new Error(`returned_${response.status}`);
  }

  return response.text();
}

function getOrigin(value) {
  const url = new URL(cleanUrl(value));
  return `${url.protocol}//${url.hostname}/`;
}

async function readOrbitData() {
  try {
    const raw = await fs.readFile(ORBIT_DATA_PATH, "utf8");
    const data = JSON.parse(raw);

    return {
      sources: Array.isArray(data.sources) ? data.sources.map(normalizeStoredOrbitSource) : [],
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;

    const data = { sources: [] };
    await writeOrbitData(data);
    return data;
  }
}

async function getPreferredShopDomains() {
  const data = await readOrbitData();

  return new Set(
    data.sources
      .filter((source) => source.type === "shop")
      .map((source) => normalizeDomain(source.domain || source.url))
      .filter(Boolean),
  );
}

async function writeOrbitData(data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    ORBIT_DATA_PATH,
    `${JSON.stringify({ sources: data.sources || [] }, null, 2)}\n`,
    "utf8",
  );
}

async function readAlertsInbox() {
  const [orbitData, alertsData] = await Promise.all([readOrbitData(), readAlertsData()]);

  return generateAlertCandidates(orbitData.sources).map((alert) =>
    applyAlertState(alert, alertsData.states[alert.id]),
  );
}

async function readAlertsData() {
  try {
    const raw = await fs.readFile(ALERTS_DATA_PATH, "utf8");
    const data = JSON.parse(raw);
    const rawStates = data.states && typeof data.states === "object" ? data.states : {};
    const states = {};

    for (const [id, state] of Object.entries(rawStates)) {
      states[id] = normalizeStoredAlertState({ ...state, id });
    }

    return { states };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;

    const data = { states: {} };
    await writeAlertsData(data);
    return data;
  }
}

async function writeAlertsData(data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tempPath = `${ALERTS_DATA_PATH}.${process.pid}.tmp`;

  await fs.writeFile(tempPath, `${JSON.stringify({ states: data.states || {} }, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, ALERTS_DATA_PATH);
}

async function updateAlertsData(mutator) {
  const nextRun = alertsWriteQueue.then(async () => {
    const data = await readAlertsData();
    const result = await mutator(data);

    await writeAlertsData(data);
    return result;
  });

  alertsWriteQueue = nextRun.catch(() => {});
  return nextRun;
}

function generateAlertCandidates(sources) {
  return (sources || [])
    .filter((source) => source.type === "item")
    .flatMap((source) => [
      makePriceAlert(source),
      makeRestockAlert(source),
      makeShopUpdateAlert(source),
    ]);
}

function makePriceAlert(source) {
  const currentPrice = normalizeNullableNumber(source.currentPrice);
  const previousPrice = currentPrice ? Math.round(currentPrice * 1.28) : null;
  const priceChange = currentPrice
    ? `${formatCurrencyFromMinorUnits(previousPrice, source.currency)} -> ${formatCurrencyFromMinorUnits(
        currentPrice,
        source.currency,
      )}`
    : "Mock price move";
  const percent = currentPrice ? Math.max(8, Math.round(((previousPrice - currentPrice) / previousPrice) * 100)) : 18;

  return makeBaseAlert(source, "price", {
    section: "today",
    change: priceChange,
    detail: `Mock price drop ${percent}%`,
    time: "today",
  });
}

function makeRestockAlert(source) {
  const restockOptions = ["Available again", "Watched size back", "Low stock back"];

  return makeBaseAlert(source, "restock", {
    section: "today",
    change: restockOptions[hashString(source.id) % restockOptions.length],
    detail: "Mock restock signal",
    time: "2h ago",
  });
}

function makeShopUpdateAlert(source) {
  const updateCount = 4 + (hashString(source.id || source.url) % 9);

  return makeBaseAlert(source, "shop", {
    section: "week",
    change: `${updateCount} new pieces`,
    detail: "Mock shop update from watched item seller",
    time: "this week",
  });
}

function makeBaseAlert(source, type, overrides) {
  const sourceKey = cleanText(source.id || source.itemId || source.url || source.name, "source");

  return {
    id: `alert_${makeSlug(sourceKey)}_${type}`,
    sourceId: source.id,
    section: overrides.section,
    type,
    title: cleanText(source.name, "Watched item"),
    shop: cleanText(source.sellerName || source.domain, "Saved shop"),
    change: overrides.change,
    detail: overrides.detail,
    time: overrides.time,
    image: cleanUrl(source.imageUrl),
    url: cleanUrl(source.url),
    generatedAt: source.updatedAt || source.createdAt || new Date().toISOString(),
  };
}

function applyAlertState(alert, state = {}) {
  return {
    ...alert,
    read: Boolean(state.read),
    dismissed: Boolean(state.dismissed),
    updatedAt: cleanText(state.updatedAt),
  };
}

function normalizeStoredAlertState(input) {
  return {
    id: cleanText(input.id),
    read: Boolean(input.read || input.dismissed),
    dismissed: Boolean(input.dismissed),
    updatedAt: cleanText(input.updatedAt) || new Date().toISOString(),
  };
}

function normalizeAlertPatch(input) {
  const patch = {};

  if ("read" in input) {
    patch.read = Boolean(input.read);
  }

  if ("dismissed" in input) {
    patch.dismissed = Boolean(input.dismissed);

    if (patch.dismissed) {
      patch.read = true;
    }
  }

  return patch;
}

async function findPageImageUrl(pageUrl) {
  try {
    const response = await fetch(pageUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "LACE prototype image metadata fetch",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return "";

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return "";

    return extractImageUrlFromHtml(await response.text(), pageUrl);
  } catch {
    return "";
  }
}

function extractImageUrlFromHtml(html, pageUrl) {
  const metaNames = "(?:og:image(?::secure_url)?|twitter:image(?::src)?)";
  const patterns = [
    new RegExp(`<meta\\s+[^>]*(?:property|name)=["']${metaNames}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta\\s+[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${metaNames}["'][^>]*>`, "i"),
    /<link\s+[^>]*rel=["']image_src["'][^>]*href=["']([^"']+)["'][^>]*>/i,
    /<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']image_src["'][^>]*>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    const imageUrl = match ? resolvePageImageUrl(match[1], pageUrl) : "";

    if (imageUrl) return imageUrl;
  }

  return "";
}

function resolvePageImageUrl(value, pageUrl) {
  const cleaned = decodeHtmlAttribute(value).replace(/\\\//g, "/");

  try {
    const url = new URL(cleaned, pageUrl);
    const imageUrl = cleanUrl(url.toString());

    return imageUrl && isLikelyImageUrl(imageUrl) ? imageUrl : "";
  } catch {
    return "";
  }
}

function decodeHtmlAttribute(value) {
  return cleanText(value)
    .replace(/\\u0026/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function normalizeOrbitSource(input) {
  const type = input.type === "item" ? "item" : "shop";
  const now = new Date().toISOString();
  const source = normalizeStoredOrbitSource({
    id: makeOrbitSourceId(type, input),
    type,
    name: cleanText(input.name, type === "item" ? "Untitled item" : "Untitled shop"),
    domain: normalizeDomain(input.domain || extractDomain(input.url)),
    url: cleanUrl(input.url),
    checkoutUrl: cleanUrl(input.checkoutUrl || input.checkout_url),
    imageUrl: cleanUrl(input.imageUrl),
    source: normalizeOrbitSourceKind(input.source),
    shopId: cleanText(input.shopId),
    itemId: type === "item" ? cleanText(input.itemId || input.id) : "",
    sellerName: cleanText(input.sellerName || input.merchant),
    currentPrice: normalizeNullableNumber(input.currentPrice),
    currency: cleanText(input.currency, "USD").toUpperCase().slice(0, 3),
    createdAt: now,
    updatedAt: now,
  });

  if (!source.name && !source.domain && !source.url) {
    throw new Error("Orbit source needs a name, domain, or URL.");
  }

  if (source.type === "item" && !source.imageUrl && source.url) {
    source.imageUrl = await findPageImageUrl(source.url);
  }

  return source;
}

function normalizeStoredOrbitSource(input) {
  return {
    id: cleanText(input.id) || makeOrbitSourceId(input.type || "shop", input),
    type: input.type === "item" ? "item" : "shop",
    name: cleanText(input.name),
    domain: normalizeDomain(input.domain || extractDomain(input.url)),
    url: cleanUrl(input.url),
    checkoutUrl: cleanUrl(input.checkoutUrl || input.checkout_url),
    imageUrl: cleanUrl(input.imageUrl),
    source: normalizeOrbitSourceKind(input.source),
    shopId: cleanText(input.shopId),
    itemId: cleanText(input.itemId),
    sellerName: cleanText(input.sellerName),
    currentPrice: normalizeNullableNumber(input.currentPrice),
    currency: cleanText(input.currency, "USD").toUpperCase().slice(0, 3),
    createdAt: cleanText(input.createdAt) || new Date().toISOString(),
    updatedAt: cleanText(input.updatedAt) || cleanText(input.createdAt) || new Date().toISOString(),
  };
}

function normalizeOrbitPatch(input) {
  const patch = {};
  const allowed = [
    "name",
    "domain",
    "url",
    "checkoutUrl",
    "imageUrl",
    "shopId",
    "itemId",
    "sellerName",
    "currentPrice",
    "currency",
  ];

  for (const key of allowed) {
    if (!(key in input)) continue;

    if (key === "domain") {
      patch.domain = normalizeDomain(input.domain);
    } else if (key === "url" || key === "checkoutUrl" || key === "imageUrl") {
      patch[key] = cleanUrl(input[key]);
    } else if (key === "currentPrice") {
      patch.currentPrice = normalizeNullableNumber(input.currentPrice);
    } else if (key === "currency") {
      patch.currency = cleanText(input.currency, "USD").toUpperCase().slice(0, 3);
    } else {
      patch[key] = cleanText(input[key]);
    }
  }

  return patch;
}

function findDuplicateOrbitSource(sources, source) {
  return sources.find((item) => {
    if (source.itemId && item.itemId === source.itemId) return true;
    if (source.url && item.url === source.url) return true;
    if (source.checkoutUrl && item.checkoutUrl === source.checkoutUrl) return true;
    if (source.type === "shop" && source.domain && item.type === "shop" && item.domain === source.domain) {
      return true;
    }

    return false;
  });
}

function mergeMissingOrbitSourceFields(target, source) {
  let changed = false;
  const fillIfMissing = ["domain", "url", "checkoutUrl", "imageUrl", "shopId", "itemId", "sellerName", "currency"];

  for (const key of fillIfMissing) {
    if (!target[key] && source[key]) {
      target[key] = source[key];
      changed = true;
    }
  }

  if (target.currentPrice === null && source.currentPrice !== null) {
    target.currentPrice = source.currentPrice;
    changed = true;
  }

  return changed;
}

function makeOrbitSourceId(type, input) {
  const basis =
    (type === "item" ? cleanText(input.itemId || input.id) : "") ||
    cleanUrl(input.checkoutUrl || input.checkout_url) ||
    normalizeDomain(input.domain || extractDomain(input.url)) ||
    cleanText(input.name, "source");
  const slug = basis
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);

  return `${type}_${slug || Date.now().toString(36)}`;
}

function makeSlug(value) {
  return cleanText(value, "source")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 52);
}

function hashString(value) {
  const text = cleanText(value, "source");
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function normalizeOrbitSourceKind(source) {
  const allowed = new Set(["watch_item", "paste_link", "search_add_shop", "screenshot", "mock_seed"]);
  return allowed.has(source) ? source : "search_add_shop";
}

function normalizeDomain(value) {
  const raw = cleanText(value).toLowerCase();
  if (!raw) return "";

  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

function extractDomain(value) {
  const url = cleanUrl(value);
  if (!url) return "";

  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function cleanUrl(value) {
  const raw = cleanText(value).replace(/&amp;/g, "&").replace(/\\\//g, "/");
  if (!raw) return "";

  try {
    const absolute = raw.startsWith("//") ? `https:${raw}` : raw.includes("://") ? raw : `https://${raw}`;
    const url = new URL(absolute);
    return url.toString();
  } catch {
    return "";
  }
}

function cleanText(value, fallback = "") {
  if (typeof value !== "string" && typeof value !== "number") return fallback;

  const text = String(value).replace(/\s+/g, " ").trim();
  return text || fallback;
}

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function enhanceQueryWithGemini(image) {
  if (!GEMINI_API_KEY) {
    return {
      used: false,
      reason: "missing_gemini_api_key",
      searchQuery: "",
    };
  }

  try {
    const prompt = [
      "You improve visual shopping search for a selected image crop.",
      "Analyze only the main product in the crop.",
      "Return JSON only. Do not include prose.",
      "Use empty strings for unknown brand or model.",
      "Use visible evidence. Do not invent exact brand or model names unless the logo/text/model is visible or strongly implied.",
      "Make search_query concise, ecommerce-friendly, and useful with a visual similarity search.",
    ].join("\n");

    const geminiResponse = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        input: [
          { type: "text", text: prompt },
          {
            type: "image",
            data: image.data,
            mime_type: image.contentType,
          },
        ],
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: {
            type: "object",
            properties: {
              product_type: { type: "string" },
              likely_brand: { type: "string" },
              likely_model: { type: "string" },
              colors: {
                type: "array",
                items: { type: "string" },
              },
              materials: {
                type: "array",
                items: { type: "string" },
              },
              distinctive_features: {
                type: "array",
                items: { type: "string" },
              },
              search_query: { type: "string" },
            },
            required: ["product_type", "colors", "distinctive_features", "search_query"],
          },
        },
      }),
    });

    const raw = await geminiResponse.text();
    const data = raw ? JSON.parse(raw) : {};

    if (!geminiResponse.ok) {
      return {
        used: false,
        reason: data.error?.message || `gemini_${geminiResponse.status}`,
        searchQuery: "",
      };
    }

    const parsed = parseGeminiJson(data);
    const searchQuery = normalizeGeminiSearchQuery(parsed.search_query);

    if (!searchQuery) {
      return {
        used: false,
        reason: "gemini_empty_search_query",
        searchQuery: "",
        raw: parsed,
      };
    }

    return {
      used: true,
      model: GEMINI_MODEL,
      searchQuery,
      productType: parsed.product_type || "",
      likelyBrand: parsed.likely_brand || null,
      likelyModel: parsed.likely_model || null,
      colors: Array.isArray(parsed.colors) ? parsed.colors : [],
      distinctiveFeatures: Array.isArray(parsed.distinctive_features)
        ? parsed.distinctive_features
        : [],
    };
  } catch (error) {
    return {
      used: false,
      reason: error.message || "gemini_failed",
      searchQuery: "",
    };
  }
}

function parseGeminiJson(data) {
  const candidates = [
    data.output_text,
    data.outputText,
    data.response?.output_text,
    data.response?.outputText,
    data.candidates?.[0]?.content?.parts?.[0]?.text,
    ...collectStrings(data),
  ].filter((value) => typeof value === "string" && value.trim());

  for (const candidate of candidates) {
    const parsed = parseJsonFromText(candidate);

    if (parsed && typeof parsed === "object" && parsed.search_query) {
      return parsed;
    }
  }

  return {};
}

function collectStrings(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return [];

  seen.add(value);

  const strings = [];

  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    if (typeof child === "string") {
      strings.push(child);
    } else if (child && typeof child === "object") {
      strings.push(...collectStrings(child, seen));
    }
  }

  return strings;
}

function parseJsonFromText(text) {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) return null;

  try {
    return JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
  } catch {
    return null;
  }
}

function normalizeGeminiSearchQuery(query) {
  if (typeof query !== "string") return "";

  return query.replace(/\s+/g, " ").trim().slice(0, 160);
}

async function callShopifyCatalog(catalog) {
  const response = await fetch(CATALOG_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      id: 1,
      params: {
        name: "search_catalog",
        arguments: {
          meta: {
            "ucp-agent": {
              profile: AGENT_PROFILE,
            },
          },
          catalog,
        },
      },
    }),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok || data.error) {
    const message = data.error?.message || data.error || `Shopify Catalog returned ${response.status}`;
    throw new Error(String(message));
  }

  return data;
}

async function resolveImage(body) {
  if (body.image?.data) {
    return {
      contentType: body.image.contentType || body.image.content_type || "image/jpeg",
      data: body.image.data,
    };
  }

  if (!body.imageUrl) return null;

  const imageUrl = new URL(body.imageUrl);

  if (!["http:", "https:"].includes(imageUrl.protocol)) {
    throw new Error("Image URL must be http or https.");
  }

  const imageResponse = await fetch(imageUrl);

  if (!imageResponse.ok) {
    throw new Error(`Could not fetch source image (${imageResponse.status}).`);
  }

  const contentType = imageResponse.headers.get("content-type") || "image/jpeg";

  if (!contentType.startsWith("image/")) {
    throw new Error("Source URL did not return an image.");
  }

  const arrayBuffer = await imageResponse.arrayBuffer();

  return {
    contentType: contentType.split(";")[0],
    data: Buffer.from(arrayBuffer).toString("base64"),
  };
}

function normalizeProduct(product, options = {}) {
  if (!product || typeof product !== "object") return null;

  const variants = Array.isArray(product.variants) ? product.variants : [];
  const availableVariant =
    variants.find((variant) => variant.availability?.available !== false) || variants[0] || {};
  const image = findProductImage(product, availableVariant);
  const seller = availableVariant.seller || {};
  const productUrl = availableVariant.url || product.url || seller.url || "";
  const checkoutUrl = availableVariant.checkout_url || "";
  const price = availableVariant.price || product.price_range?.min || null;
  const domain = normalizeDomain(seller.domain || productUrl);
  const productDomain = normalizeDomain(productUrl);
  const rating = normalizeRating(availableVariant.rating || product.rating);

  return {
    id: product.id || availableVariant.id || "",
    title: product.title || "Untitled product",
    image,
    merchant: seller.name || seller.domain || "Shopify merchant",
    domain,
    rating,
    sellerConfidence: getInitialSellerConfidence({
      domain,
      productDomain,
      rating,
      preferredShopDomains: options.preferredShopDomains,
    }),
    price: formatPrice(price),
    priceAmount: typeof price?.amount === "number" ? price.amount : null,
    currency: price?.currency || "USD",
    url: productUrl,
    checkoutUrl,
    matchLabel: availableVariant.availability?.status || "Catalog match",
  };
}

function getInitialSellerConfidence({ domain, productDomain, rating, preferredShopDomains }) {
  if (preferredShopDomains?.has(domain) || preferredShopDomains?.has(productDomain)) {
    return {
      level: "preferred",
      label: "Preferred",
      reason: "Orbit preference: shopper saved this shop.",
      rank: 10,
      hidden: false,
    };
  }

  if (rating.count >= 20) {
    return {
      level: "reviewed",
      label: "Reviewed",
      reason: `${rating.count} catalog reviews. Product URL still checked before display.`,
      reviewCount: rating.count,
      rank: 25,
      hidden: false,
    };
  }

  return {
    level: "unknown",
    label: "Unknown",
    reason: "Product URL not checked yet.",
    rank: 50,
    hidden: false,
  };
}

function getReachableSellerConfidence(product, reachability) {
  const current = product.sellerConfidence || {};

  if (current.level === "preferred") {
    return {
      ...current,
      reason: `${current.reason} Product URL reachable (${reachability.status}).`,
    };
  }

  if (product.rating?.count >= 20) {
    return {
      level: "reviewed",
      label: "Reviewed",
      reason: `Reachable product URL (${reachability.status}) plus ${product.rating.count} catalog reviews.`,
      reviewCount: product.rating.count,
      rank: 25,
      hidden: false,
    };
  }

  return {
    level: "checked",
    label: "Checked",
    reason: `Product URL reachable (${reachability.status}).`,
    rank: 30,
    hidden: false,
  };
}

function compareSellerConfidence(a, b) {
  const rankDelta = (a.sellerConfidence?.rank || 50) - (b.sellerConfidence?.rank || 50);

  if (rankDelta !== 0) return rankDelta;

  return (a.priceAmount ?? Number.MAX_SAFE_INTEGER) - (b.priceAmount ?? Number.MAX_SAFE_INTEGER);
}

function normalizeRating(rating) {
  if (!rating || typeof rating !== "object") {
    return {
      value: null,
      count: 0,
    };
  }

  return {
    value: normalizeNullableNumber(rating.value),
    count: normalizeNullableNumber(rating.count) || 0,
  };
}

function findProductImage(product, availableVariant) {
  const candidates = [
    product.image,
    product.image_url,
    product.imageUrl,
    product.featured_image,
    product.featuredImage,
    product.featured_media,
    product.featuredMedia,
    product.media,
    product.images,
    availableVariant.image,
    availableVariant.image_url,
    availableVariant.imageUrl,
    availableVariant.featured_image,
    availableVariant.featuredImage,
    availableVariant.media,
  ];

  for (const candidate of candidates) {
    const imageUrl = findImageUrl(candidate, { allowStringUrl: true, allowGenericUrl: true });

    if (imageUrl) return imageUrl;
  }

  return findImageUrl(product) || findLikelyImageUrl(product);
}

function findImageUrl(value, options = {}, seen = new Set()) {
  if (!value) return "";

  if (typeof value === "string") {
    const url = cleanUrl(value);

    if (!url) return "";

    return options.allowStringUrl || isLikelyImageUrl(url) ? url : "";
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const url = findImageUrl(item, options, seen);

      if (url) return url;
    }

    return "";
  }

  if (typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);

  const mediaType = cleanText(value.type || value.media_type || value.mediaType).toLowerCase();
  const allowGenericUrl = options.allowGenericUrl || mediaType.includes("image");
  const directKeys = [
    "image_url",
    "imageUrl",
    "thumbnail_url",
    "thumbnailUrl",
    "preview_image_url",
    "previewImageUrl",
    "original_src",
    "originalSrc",
    "transformed_src",
    "transformedSrc",
    "src",
    "url",
  ];

  for (const key of directKeys) {
    if (!(key in value)) continue;

    const url = findImageUrl(value[key], {
      allowStringUrl: allowGenericUrl || key !== "url",
      allowGenericUrl,
    }, seen);

    if (url) return url;
  }

  const nestedKeys = [
    "image",
    "images",
    "source",
    "sources",
    "media",
    "nodes",
    "edges",
    "featured_image",
    "featuredImage",
    "featured_media",
    "featuredMedia",
    "preview_image",
    "previewImage",
    "thumbnail",
  ];

  for (const key of nestedKeys) {
    if (!(key in value)) continue;

    const url = findImageUrl(value[key], { allowStringUrl: true, allowGenericUrl: true }, seen);

    if (url) return url;
  }

  return "";
}

function findLikelyImageUrl(value, seen = new Set()) {
  if (!value) return "";

  if (typeof value === "string") {
    const url = cleanUrl(value);
    return url && isLikelyImageUrl(url) ? url : "";
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const url = findLikelyImageUrl(item, seen);

      if (url) return url;
    }

    return "";
  }

  if (typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);

  for (const child of Object.values(value)) {
    const url = findLikelyImageUrl(child, seen);

    if (url) return url;
  }

  return "";
}

function isLikelyImageUrl(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();

    return (
      /\.(avif|gif|jpe?g|png|webp)(?:$|\?)/.test(pathname) ||
      parsed.hostname.includes("cdn.shopify.com") ||
      parsed.hostname.includes("shopifycdn.net")
    );
  } catch {
    return false;
  }
}

function formatPrice(price) {
  if (!price || typeof price.amount !== "number") return "Price varies";

  return formatCurrencyFromMinorUnits(price.amount, price.currency);
}

function formatCurrencyFromMinorUnits(amount, currency = "USD") {
  const majorUnits = amount / 100;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(majorUnits);
}

function clampInteger(value, fallback, min, max) {
  const number = Number(value);

  if (!Number.isInteger(number)) return fallback;

  return Math.min(Math.max(number, min), max);
}

async function readJsonBody(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;

    if (totalBytes > MAX_BODY_BYTES) {
      throw new Error("Image payload is too large. Try a smaller file.");
    }

    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function serveStatic(urlPath, request, response) {
  const pathname = urlPath === "/" ? "/index.html" : decodeURIComponent(urlPath);
  const filePath = path.resolve(ROOT, `.${pathname}`);

  if (!filePath.startsWith(ROOT)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    response.end(content);
  } catch (error) {
    sendText(response, 404, "Not found");
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function sendText(response, status, text) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

function loadEnvFile() {
  const envPath = path.resolve(__dirname, ".env");

  if (!fsSync.existsSync(envPath)) return;

  const lines = fsSync.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) continue;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();

    if (!key || process.env[key]) continue;

    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}
