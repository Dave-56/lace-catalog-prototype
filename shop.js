const shopProfiles = window.LACE_SHOP_PROFILES || [];

const shopState = {
  source: null,
  profile: null,
  liveDetail: null,
  status: "loading",
};

const shopDetail = document.querySelector("#shop-detail");
const params = new URLSearchParams(window.location.search);
const requestedSource = params.get("source") || "";
const requestedDomain = normalizeDomain(params.get("domain") || "");
const isBuyingGuideMock = params.get("mock") === "buying-guide" || Boolean(window.LACE_BUYING_GUIDE_PAGE);

loadShopDetail();

async function loadShopDetail() {
  if (isBuyingGuideMock) {
    shopState.status = "mock";
    renderShopDetail();
    return;
  }

  shopState.status = "loading";
  renderShopDetail();

  try {
    const response = await fetch("/api/orbit");
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Orbit failed with ${response.status}`);
    }

    const sources = Array.isArray(data.sources) ? data.sources : [];
    const savedShop = findRequestedShop(sources);
    const profile = findProfile(savedShop);
    const liveDetail = await loadLiveShopDetail(savedShop || profile);
    const source = savedShop || profile || getSourceFromLiveDetail(liveDetail);
    const domain = normalizeDomain(source?.domain || liveDetail?.domain || requestedDomain);

    shopState.source = source ? { ...source, saved: Boolean(savedShop) } : null;
    shopState.liveDetail = liveDetail;
    shopState.profile = mergeProfileWithLiveDetail(profile || getFallbackProfile(source), liveDetail, source);
    shopState.status = source ? "ready" : "missing";
  } catch (error) {
    shopState.status = "error";
    shopState.error = error.message || "Could not load shop details.";
  }

  renderShopDetail();
}

async function saveShop() {
  const payload = getSavePayload();
  if (!payload) return;

  setDetailBusy(true, "Saving...");

  try {
    const response = await fetch("/api/orbit/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Save failed with ${response.status}`);
    }

    shopState.source = { ...(data.source || payload), saved: true };
    shopState.status = "ready";
    renderShopDetail(data.duplicate ? "Already saved." : "Shop saved.");
  } catch (error) {
    renderShopDetail(error.message || "Could not save shop.");
  }
}

async function removeShop() {
  if (!shopState.source?.id) return;

  setDetailBusy(true, "Removing...");

  try {
    const response = await fetch(`/api/orbit/sources/${encodeURIComponent(shopState.source.id)}`, {
      method: "DELETE",
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Remove failed with ${response.status}`);
    }

    shopState.source = { ...shopState.source, saved: false };
    renderShopDetail("Removed from Orbit.");
  } catch (error) {
    renderShopDetail(error.message || "Could not remove shop.");
  }
}

function renderShopDetail(message = "") {
  if (shopState.status === "mock") {
    shopDetail.innerHTML = renderBuyingGuideMock();
    attachBuyingGuideInteractions();
    return;
  }

  if (shopState.status === "loading") {
    shopDetail.innerHTML = `<div class="empty-brand-state">Loading shop details.</div>`;
    return;
  }

  if (shopState.status === "error") {
    shopDetail.innerHTML = `<div class="empty-brand-state">${escapeHtml(shopState.error)}</div>`;
    return;
  }

  if (shopState.status === "missing" || !shopState.source) {
    shopDetail.innerHTML = `<div class="empty-brand-state">Shop not found.</div>`;
    return;
  }

  const source = shopState.source;
  const profile = shopState.profile || {};
  const latestProducts = Array.isArray(profile.latestProducts) ? profile.latestProducts : [];
  const statusLabel = source.saved ? "saved" : "suggested";
  const action = source.saved
    ? `<button class="shop-action danger" type="button" data-remove-shop>Remove</button>`
    : `<button class="shop-action" type="button" data-save-shop>Save shop</button>`;
  const visit = source.url
    ? `<a class="shop-action secondary" href="${escapeAttribute(source.url)}" target="_blank" rel="noreferrer">Visit shop</a>`
    : "";

  shopDetail.innerHTML = `
    <section class="shop-hero simple" aria-labelledby="shop-title">
      <div class="shop-hero-copy">
        <p class="eyebrow">Shop</p>
        <h1 id="shop-title">${escapeHtml(source.name || profile.name || "Untitled shop")}</h1>
        <p class="shop-domain">${escapeHtml(source.domain || profile.domain || "No domain")} · ${escapeHtml(statusLabel)}</p>
        <p class="shop-summary">${escapeHtml(getShopDetailSummary(profile))}</p>
      </div>
      <div class="shop-actions">
        ${visit}
        ${action}
      </div>
    </section>

    <section class="shop-section compact" aria-labelledby="shop-memory-title">
      <div class="shop-section-head">
        <div>
          <p class="eyebrow">Newest arrivals</p>
          <h2 id="shop-memory-title">Latest drops</h2>
        </div>
        <span>${latestProducts.length} arrivals</span>
      </div>
      ${renderLatestProductsPanel(latestProducts, profile.latestProductsUrl)}
      <p class="detail-status" id="detail-status">${escapeHtml(message)}</p>
    </section>
  `;

  shopDetail.querySelector("[data-save-shop]")?.addEventListener("click", saveShop);
  shopDetail.querySelector("[data-remove-shop]")?.addEventListener("click", removeShop);
  attachLatestProductImageSwaps();
}

function renderBuyingGuideMock() {
  return `
    <section class="search-guide" aria-labelledby="guide-title">
      <form class="consumer-search" aria-label="Product search">
        <div class="consumer-search-box">
          <input id="mock-search-input" type="search" value="England jersey" aria-label="Search products" />
          <button type="submit">Search</button>
        </div>
      </form>

      <p class="search-loading" data-search-loading hidden>Checking options, sellers, and reviews...</p>

      <div class="search-results" data-search-results hidden>
      <div class="quick-answer">
        <div class="quick-answer-copy">
          <p class="soft-label">Recommended for you</p>
          <h1 id="guide-title">England Home Jersey</h1>
          <p class="plain-summary">Best pick if you want a verified retailer and easy returns.</p>

          <div class="simple-signals" aria-label="Why this was recommended">
            <span>Verified retailer</span>
            <span>Clear returns</span>
            <span>Strong reviews</span>
          </div>

          <div class="simple-auth verified">
            <span>Authenticity</span>
            <strong>Seller evidence found</strong>
          </div>

          <div class="quick-product">
            <div class="consumer-product-thumb">ENG</div>
            <div>
              <span class="price">$95</span>
              <p>Seller evidence found</p>
            </div>
          </div>

          <div class="consumer-actions">
            <button class="primary-button" type="button">View product</button>
            <button class="quiet-button" type="button">Watch</button>
          </div>
        </div>
      </div>

      <section class="simple-alternatives" aria-labelledby="alternatives-title">
        <h2 id="alternatives-title">Other good options</h2>

          ${renderAlternativeCard({
            id: "value",
            title: "Cheaper",
            product: "Fan-style England Jersey",
            meta: "Good budget option",
            price: "$42",
            authenticity: "Not verified",
            tone: "unclear",
          })}
          ${renderAlternativeCard({
            id: "speed",
            title: "Arrives sooner",
            product: "England Jersey - Ships from US",
            meta: "Best if timing matters",
            price: "$68",
            authenticity: "Unclear",
            tone: "unclear",
          })}
          ${renderAlternativeCard({
            id: "official",
            title: "Most official",
            product: "Licensed England Match Jersey",
            meta: "Verified retailer, higher price",
            price: "$130",
            authenticity: "Evidence found",
            tone: "verified",
          })}

        <p class="search-note">We only say official when seller or licensing evidence is present.</p>
      </section>
      </div>
    </section>
  `;
}

function renderAlternativeCard(option) {
  return `
    <article class="alternative-card ${escapeAttribute(option.tone)}" data-guide-card="${escapeAttribute(option.id)}">
      <div class="alternative-thumb">ENG</div>
      <div>
        <span>${escapeHtml(option.title)}</span>
        <h3>${escapeHtml(option.product)}</h3>
        <p>${escapeHtml(option.meta)}</p>
      </div>
      <strong>${escapeHtml(option.price)}</strong>
      <small>${escapeHtml(option.authenticity)}</small>
    </article>
  `;
}

function attachBuyingGuideInteractions() {
  const form = shopDetail.querySelector(".consumer-search");
  const input = shopDetail.querySelector("#mock-search-input");
  const loading = shopDetail.querySelector("[data-search-loading]");
  const results = shopDetail.querySelector("[data-search-results]");

  form?.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!input.value.trim()) {
      input.value = "England jersey";
    }

    results.hidden = true;
    loading.hidden = false;

    window.setTimeout(() => {
      loading.hidden = true;
      results.hidden = false;
      results.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 450);
  });
}

function renderLatestProductsPanel(products, latestProductsUrl) {
  const latestLink = latestProductsUrl
    ? `<a class="product-link secondary" href="${escapeAttribute(latestProductsUrl)}" target="_blank" rel="noreferrer">Open arrivals</a>`
    : "";

  return `
    <div class="detail-panel-meta">Products first pulled from this shop's newest available feed. ${latestLink}</div>
    <div class="shop-item-grid">
      ${
        products.length
          ? products.map(renderLatestProduct).join("")
          : `<div class="empty-brand-state">No newest arrivals found for this shop yet.</div>`
      }
    </div>
  `;
}

function getShopDetailSummary(profile) {
  if (Array.isArray(profile.latestProducts) && profile.latestProducts.length) {
    return "Live newest arrivals pulled from this shop.";
  }

  return "Newest arrivals were not available. Open the shop to browse live drops.";
}

function renderLatestProduct(product) {
  const images = getProductImages(product);
  const primaryImage = images[0];
  const image = primaryImage
    ? renderProductMedia(product, images, primaryImage)
    : `<div class="product-image-empty">No image</div>`;
  const link = product.url
    ? `<a class="product-link" href="${escapeAttribute(product.url)}" target="_blank" rel="noreferrer">View</a>`
    : "";

  return `
    <article class="product-card">
      ${image}
      <div class="product-body">
        <div class="product-meta">
          <span>New arrival</span>
          <span>${escapeHtml(formatPublishedDate(product.publishedAt))}</span>
        </div>
        <h3>${escapeHtml(product.title || "Untitled product")}</h3>
        <div class="price-row">
          <span class="price">${escapeHtml(product.price || "Price varies")}</span>
          <span class="product-actions">${link}</span>
        </div>
      </div>
    </article>
  `;
}

function renderProductMedia(product, images, primaryImage) {
  const title = product.title || "Product image";
  const thumbs = images.length > 1
    ? `
      <div class="product-image-thumbs" aria-label="${escapeAttribute(`${title} photos`)}">
        ${images
          .slice(0, 5)
          .map((image, index) => renderProductImageThumb(image, title, index === 0))
          .join("")}
      </div>
    `
    : "";

  return `
    <div class="product-media">
      <img class="product-main-image" alt="${escapeAttribute(primaryImage.alt || title)}" src="${escapeAttribute(
        primaryImage.url,
      )}" loading="lazy" />
      ${thumbs}
    </div>
  `;
}

function renderProductImageThumb(image, title, isActive) {
  return `
    <button class="product-image-thumb ${isActive ? "active" : ""}" type="button" data-product-image-src="${escapeAttribute(
      image.url,
    )}" data-product-image-alt="${escapeAttribute(image.alt || title)}" aria-label="${escapeAttribute(
      image.kind === "model" ? "Show model photo" : `Show product photo ${image.position + 1}`,
    )}">
      <img alt="" src="${escapeAttribute(image.url)}" loading="lazy" />
    </button>
  `;
}

function attachLatestProductImageSwaps() {
  shopDetail.querySelectorAll("[data-product-image-src]").forEach((button) => {
    const swapImage = () => {
      const card = button.closest(".product-card");
      const mainImage = card?.querySelector(".product-main-image");

      if (!mainImage) return;

      mainImage.src = button.dataset.productImageSrc;
      mainImage.alt = button.dataset.productImageAlt || mainImage.alt;
      card.querySelectorAll("[data-product-image-src]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
    };

    button.addEventListener("click", swapImage);
    button.addEventListener("mouseenter", swapImage);
  });
}

function getProductImages(product) {
  const images = Array.isArray(product.images) ? product.images : [];
  const normalized = images
    .map((image, index) => {
      if (typeof image === "string") {
        return { url: image, alt: "", kind: "unknown", position: index };
      }

      return {
        url: image?.url || "",
        alt: image?.alt || "",
        kind: image?.kind || "unknown",
        position: Number.isFinite(Number(image?.position)) ? Number(image.position) : index,
      };
    })
    .filter((image) => image.url);

  if (!normalized.length && product.image) {
    normalized.push({ url: product.image, alt: product.title || "", kind: "unknown", position: 0 });
  }

  return normalized;
}

function findRequestedShop(sources) {
  const shops = sources.filter((source) => source.type === "shop");

  return (
    shops.find((source) => source.id === requestedSource) ||
    shops.find((source) => normalizeDomain(source.domain) === requestedDomain) ||
    null
  );
}

function findProfile(source) {
  return (
    shopProfiles.find((profile) => profile.id === requestedSource) ||
    shopProfiles.find((profile) => normalizeDomain(profile.domain) === requestedDomain) ||
    shopProfiles.find((profile) => source?.domain && normalizeDomain(profile.domain) === normalizeDomain(source.domain)) ||
    null
  );
}

function getFallbackProfile(source) {
  if (!source) return null;

  return {
    name: source.name,
    domain: source.domain,
    url: source.url,
    summary: getSourceReason(source),
    collections: getFallbackCollections(source),
    latestProducts: [],
  };
}

function getFallbackCollections(source) {
  if (!source.url) return [];

  return [
    {
      name: "Shop home",
      description: "Open the main shop site.",
      url: source.url,
    },
  ];
}

async function loadLiveShopDetail(source) {
  const domain = normalizeDomain(source?.domain || requestedDomain);
  const url = source?.url || (domain ? `https://${domain}/` : "");
  const query = new URLSearchParams();

  if (domain) query.set("domain", domain);
  if (url) query.set("url", url);
  if (!query.toString()) return null;

  try {
    const response = await fetch(`/api/shop-detail?${query.toString()}`);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Shop detail failed with ${response.status}`);
    }

    return data;
  } catch (error) {
    return {
      live: false,
      source: "fallback",
      domain,
      url,
      collections: [],
      errors: [error.message || "shop_detail_failed"],
    };
  }
}

function mergeProfileWithLiveDetail(profile, liveDetail, source) {
  const baseProfile = profile || getFallbackProfile(source) || {};
  const liveCollections = Array.isArray(liveDetail?.collections) ? liveDetail.collections : [];
  const latestProducts = Array.isArray(liveDetail?.latestProducts) ? liveDetail.latestProducts : [];

  if (!liveDetail?.live && latestProducts.length === 0) {
    return {
      ...baseProfile,
      collectionSource: "fallback",
      latestProducts: baseProfile.latestProducts || [],
    };
  }

  return {
    ...baseProfile,
    name: source?.name || baseProfile.name || liveDetail.title || nameFromDomain(liveDetail.domain),
    domain: source?.domain || baseProfile.domain || liveDetail.domain,
    url: source?.url || baseProfile.url || liveDetail.url,
    summary: liveDetail.summary || baseProfile.summary || "Live shop details loaded from the storefront.",
    cadence: "Live storefront data",
    fit: liveDetail.source === "shopify_collections_json" ? "Collections loaded from Shopify JSON." : "Collections discovered from homepage navigation.",
    collections: liveCollections,
    collectionSource: liveDetail.source,
    latestProducts,
    latestProductsSource: liveDetail.latestProductsSource,
    latestProductsUrl: liveDetail.latestProductsUrl,
  };
}

function getSourceFromLiveDetail(liveDetail) {
  if (!liveDetail?.domain && !liveDetail?.url) return null;

  return {
    type: "shop",
    name: liveDetail.title || nameFromDomain(liveDetail.domain),
    domain: liveDetail.domain,
    url: liveDetail.url,
    sellerName: liveDetail.title || nameFromDomain(liveDetail.domain),
  };
}

function getCollectionsSourceLabel(source) {
  if (source === "shopify_collections_json") return "live Shopify links";
  if (source === "homepage_links") return "live homepage links";
  return "fallback links";
}

function nameFromDomain(domain) {
  const [name = "Shop"] = normalizeDomain(domain).split(".");

  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function getSavePayload() {
  const source = shopState.source || shopState.profile;

  if (!source) return null;

  return {
    type: "shop",
    name: source.name,
    domain: source.domain,
    url: source.url,
    source: "search_add_shop",
    sellerName: source.sellerName || source.name,
  };
}

function setDetailBusy(isBusy, label) {
  shopDetail.querySelectorAll("[data-save-shop], [data-remove-shop]").forEach((button) => {
    button.disabled = isBusy;
    if (label) button.textContent = label;
  });
}

function getSourceReason(source) {
  return source.saved ? "Shop saved to Orbit memory." : "Suggested shop. Save to add it to Orbit memory.";
}

function getInitials(name) {
  return String(name || "L")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function normalizeDomain(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";

  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

function formatCurrencyFromMinorUnits(amount, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(amount / 100);
}

function formatPublishedDate(value) {
  if (!value) return "Latest";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Latest";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
