const orbitState = {
  filter: "shop",
  query: "",
  sources: [],
  status: "loading",
};

const shopSuggestions = window.LACE_SHOP_PROFILES || [];

const brandSignal = document.querySelector("#brand-signal");
const brandDeck = document.querySelector("#brand-deck");
const saveShopButton = document.querySelector("#save-shop-button");
const orbitStatus = document.querySelector("#orbit-status");
const shopLaneCount = document.querySelector("#shop-lane-count");
const itemLaneCount = document.querySelector("#item-lane-count");

brandSignal.addEventListener("input", () => {
  orbitState.query = brandSignal.value.trim().toLowerCase();
  renderOrbitSources();
});

brandSignal.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;

  event.preventDefault();
  saveCustomShop();
});

saveShopButton.addEventListener("click", saveCustomShop);

document.querySelectorAll("[data-signal]").forEach((button) => {
  button.addEventListener("click", () => {
    orbitState.query = button.dataset.signal || "";
    brandSignal.value = orbitState.query;
    renderOrbitSources();
  });
});

document.querySelectorAll("[data-orbit-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    orbitState.filter = button.dataset.orbitFilter || "all";
    document.querySelectorAll("[data-orbit-filter]").forEach((tab) => {
      tab.classList.toggle("active", tab === button);
    });
    renderOrbitSources();
  });
});

brandDeck.addEventListener("click", async (event) => {
  const saveButton = event.target.closest("[data-save-source]");
  const removeButton = event.target.closest("[data-remove-source]");
  const detailsCard = event.target.closest("[data-shop-detail]");

  if (saveButton) {
    await saveSuggestedSource(saveButton.dataset.saveSource);
  } else if (removeButton) {
    await removeSource(removeButton.dataset.removeSource);
  } else if (detailsCard) {
    window.location.href = detailsCard.dataset.shopDetail;
  }
});

brandDeck.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;

  const detailsCard = event.target.closest("[data-shop-detail]");
  if (!detailsCard) return;

  event.preventDefault();
  window.location.href = detailsCard.dataset.shopDetail;
});

loadOrbitSources();

async function loadOrbitSources() {
  orbitState.status = "loading";
  renderOrbitSources();

  try {
    const response = await fetch("/api/orbit");
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Orbit failed with ${response.status}`);
    }

    orbitState.sources = Array.isArray(data.sources) ? data.sources : [];
    orbitState.status = "ready";
  } catch (error) {
    orbitState.status = "error";
    orbitState.error = error.message || "Could not load Orbit.";
  }

  renderOrbitSources();
}

async function saveSuggestedSource(sourceId) {
  const suggestion = shopSuggestions.find((source) => source.id === sourceId);
  if (!suggestion) return;

  const response = await fetch("/api/orbit/sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(suggestion),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    setOrbitStatus(data.error || `Save failed with ${response.status}`, true);
    renderOrbitSources();
    return;
  }

  const saved = data.source;
  orbitState.sources = [
    ...orbitState.sources.filter((source) => source.id !== saved.id && source.domain !== saved.domain),
    saved,
  ];
  orbitState.status = "ready";
  setOrbitStatus(`${saved.name || "Shop"} saved.`);
  renderOrbitSources();
}

async function saveCustomShop() {
  const rawValue = brandSignal.value.trim();
  if (!rawValue) {
    setOrbitStatus("Type a shop name or domain first.", true);
    return;
  }

  saveShopButton.disabled = true;
  saveShopButton.textContent = "Saving...";

  try {
    const payload = getShopPayloadFromInput(rawValue);
    const response = await fetch("/api/orbit/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Save failed with ${response.status}`);
    }

    const saved = data.source;
    orbitState.sources = [
      ...orbitState.sources.filter((source) => source.id !== saved.id && source.domain !== saved.domain),
      saved,
    ];
    orbitState.filter = "shop";
    orbitState.query = "";
    brandSignal.value = "";
    setActiveLane("shop");
    setOrbitStatus(data.duplicate ? "Shop already saved." : `${saved.name || "Shop"} saved.`);
    renderOrbitSources();
  } catch (error) {
    setOrbitStatus(error.message || "Could not save shop.", true);
  } finally {
    saveShopButton.disabled = false;
    saveShopButton.textContent = "Save shop";
  }
}

async function removeSource(sourceId) {
  const response = await fetch(`/api/orbit/sources/${encodeURIComponent(sourceId)}`, {
    method: "DELETE",
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    setOrbitStatus(data.error || `Remove failed with ${response.status}`, true);
    renderOrbitSources();
    return;
  }

  orbitState.sources = orbitState.sources.filter((source) => source.id !== sourceId);
  orbitState.status = "ready";
  setOrbitStatus("Removed from Orbit.");
  renderOrbitSources();
}

function renderOrbitSources() {
  const sources = getDisplaySources();

  if (orbitState.status === "loading") {
    brandDeck.innerHTML = `<div class="empty-brand-state">Loading Orbit memory.</div>`;
  } else if (orbitState.status === "error") {
    brandDeck.innerHTML = `<div class="empty-brand-state">${escapeHtml(orbitState.error)}</div>`;
  } else {
    brandDeck.innerHTML =
      sources.length > 0
        ? sources.map(renderSourceCard).join("")
        : `<div class="empty-brand-state">No ${escapeHtml(orbitState.filter)} matched.</div>`;
  }

  const shopCount = orbitState.sources.filter((source) => source.type === "shop").length;
  const itemCount = orbitState.sources.filter((source) => source.type === "item").length;

  shopLaneCount.textContent = String(shopCount);
  itemLaneCount.textContent = String(itemCount);
}

function getDisplaySources() {
  const query = orbitState.query;
  const saved = orbitState.sources.map((source) => ({ ...source, saved: true }));
  const suggestions = orbitState.filter === "shop" ? getUnsavedSuggestions() : [];
  const combined = [...saved, ...suggestions];

  return combined.filter((source) => {
    const text = [source.name, source.domain, source.sellerName, source.signal, source.url]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const queryMatch = !query || text.includes(query);
    const filterMatch =
      (orbitState.filter === "shop" && source.type === "shop") ||
      (orbitState.filter === "item" && source.saved && source.type === "item");

    return queryMatch && filterMatch;
  });
}

function getUnsavedSuggestions() {
  const savedDomains = new Set(orbitState.sources.map((source) => source.domain).filter(Boolean));

  return shopSuggestions
    .filter((source) => !savedDomains.has(source.domain))
    .map((source) => ({ ...source, saved: false }));
}

function renderSourceCard(source) {
  if (source.type === "item") {
    return renderItemCard(source);
  }

  const initials = source.name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const meta = source.type === "item" ? "item" : "shop";
  const action = source.saved
    ? `<button type="button" data-remove-source="${escapeAttribute(source.id)}">Remove</button>`
    : `<button type="button" data-save-source="${escapeAttribute(source.id)}">Save</button>`;
  const detailUrl = source.type === "shop" ? getShopDetailUrl(source) : "";
  const detailAttrs = detailUrl
    ? ` data-shop-detail="${escapeAttribute(detailUrl)}" tabindex="0" aria-label="Open ${escapeAttribute(
        source.name || "shop",
      )} details"`
    : "";
  const detailLink = detailUrl
    ? `<a class="brand-details-link" href="${escapeAttribute(detailUrl)}">Details</a>`
    : "";

  return `
    <article class="brand-card ${source.saved ? "followed" : ""} ${detailUrl ? "is-clickable" : ""}"${detailAttrs}>
      <div class="brand-token" aria-hidden="true">${escapeHtml(initials || "L")}</div>
      <div class="brand-card-body">
        <div class="brand-card-head">
          <div>
            <h3>${escapeHtml(source.name || "Untitled source")}</h3>
            <p>${escapeHtml(source.domain || source.url || "No domain")}</p>
          </div>
          <span class="brand-pulse">${source.saved ? "saved" : "suggested"}</span>
        </div>
        <p class="brand-reason">${escapeHtml(getSourceReason(source))}</p>
        <div class="brand-card-foot">
          <span>${escapeHtml(meta)}</span>
          <div class="brand-card-actions">
            ${detailLink}
            ${action}
          </div>
        </div>
      </div>
    </article>
  `;
}

function renderItemCard(source) {
  const image = source.imageUrl
    ? `<img class="orbit-item-image" alt="${escapeAttribute(source.name || "Watched item")}" src="${escapeAttribute(
        source.imageUrl,
      )}" />`
    : `<div class="orbit-item-image empty" aria-hidden="true">${escapeHtml(getSourceInitials(source))}</div>`;
  const viewLink = source.url
    ? `<a href="${escapeAttribute(source.url)}" target="_blank" rel="noreferrer">View</a>`
    : "";
  const buyLink = source.checkoutUrl
    ? `<a class="secondary" href="${escapeAttribute(source.checkoutUrl)}" target="_blank" rel="noreferrer">Buy</a>`
    : "";

  return `
    <article class="orbit-item-card followed">
      ${image}
      <div class="orbit-item-body">
        <div class="orbit-item-head">
          <div>
            <h3>${escapeHtml(source.name || "Untitled item")}</h3>
            <p>${escapeHtml(source.sellerName || source.domain || "Saved shop")}</p>
          </div>
          <span class="brand-pulse">saved</span>
        </div>
        <div class="orbit-item-meta">
          <span>${escapeHtml(formatOrbitPrice(source))}</span>
          <span>${escapeHtml(source.domain || "No domain")}</span>
        </div>
        <div class="brand-card-foot">
          <span>item</span>
          <div class="brand-card-actions">
            ${viewLink}
            ${buyLink}
            <button type="button" data-remove-source="${escapeAttribute(source.id)}">Remove</button>
          </div>
        </div>
      </div>
    </article>
  `;
}

function getSourceInitials(source) {
  return (source.sellerName || source.name || "L")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatOrbitPrice(source) {
  if (typeof source.currentPrice !== "number") return "Price varies";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: source.currency || "USD",
  }).format(source.currentPrice / 100);
}

function getShopDetailUrl(source) {
  const domain = normalizeInputDomain(source.domain || source.url || "");
  const params = new URLSearchParams();

  if (source.saved && source.id) {
    params.set("source", source.id);
  } else if (domain) {
    params.set("domain", domain);
  } else if (source.id) {
    params.set("source", source.id);
  }

  return `/shop.html?${params.toString()}`;
}

function getSourceReason(source) {
  if (source.type === "item") {
    return source.sellerName ? `Exact item from ${source.sellerName}` : "Exact item saved to Orbit.";
  }

  if (source.saved) {
    return "Shop saved to Orbit memory.";
  }

  return "Suggested shop. Save to add it to Orbit memory.";
}

function getShopPayloadFromInput(value) {
  const hasUrlShape = value.includes(".") || value.includes("://");
  const domain = hasUrlShape ? normalizeInputDomain(value) : "";
  const name = hasUrlShape ? nameFromDomain(domain) : value;

  return {
    type: "shop",
    name,
    domain,
    url: domain ? `https://${domain}/` : "",
    source: "search_add_shop",
    sellerName: name,
  };
}

function normalizeInputDomain(value) {
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname.replace(/^www\./, "");
  } catch {
    return value.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  }
}

function nameFromDomain(domain) {
  const [name = "Shop"] = domain.split(".");

  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function setActiveLane(filter) {
  document.querySelectorAll("[data-orbit-filter]").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.orbitFilter === filter);
  });
}

function setOrbitStatus(message, isError = false) {
  orbitStatus.textContent = message;
  orbitStatus.classList.toggle("error", isError);
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
