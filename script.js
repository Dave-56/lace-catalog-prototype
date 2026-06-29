if (window.location.protocol === "file:") {
  window.location.href = "http://localhost:3000/";
}

const samples = {
  studio: {
    label: "studio outfit",
    src: "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=920&q=80",
    intent: "oversized leather, cropped knit, city black",
  },
  street: {
    label: "street outfit",
    src: "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=920&q=80",
    intent: "denim, polished basics, everyday errand fit",
  },
  weekend: {
    label: "weekend outfit",
    src: "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=920&q=80",
    intent: "soft dress, linen texture, daytime date",
  },
  evening: {
    label: "evening outfit",
    src: "https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=920&q=80",
    intent: "night-out dress, vintage shape, warm neutral",
  },
};

const CATALOG_PAGE_LIMIT = 25;

const state = {
  activeSource: null,
  cropRect: null,
  dragStart: null,
  isLoadingMore: false,
  buyingGuide: null,
  lastSearch: null,
  orbitItemIds: new Set(),
  pagination: null,
  previewImage: null,
  products: [],
  uploadedFileName: "",
};

const previewFrame = document.querySelector("#preview-frame");
const querySummary = document.querySelector("#query-summary");
const buyingGuide = document.querySelector("#buying-guide");
const productGrid = document.querySelector("#product-grid");
const statusLine = document.querySelector("#status-line");
const searchButton = document.querySelector("#search-button");
const loadMoreButton = document.querySelector("#load-more-button");
const clearButton = document.querySelector("#clear-button");
const uploadInput = document.querySelector("#image-upload");
const cameraInput = document.querySelector("#camera-capture");
const uploadCard = document.querySelector("#photo-picker-button");
const photoSheet = document.querySelector("#photo-sheet");
const photoSheetCancel = document.querySelector("#photo-sheet-cancel");

document.querySelectorAll("[data-sample]").forEach((button) => {
  button.addEventListener("click", () => {
    const sampleKey = button.dataset.sample;
    const sample = samples[sampleKey];
    selectSource({
      kind: "sample",
      key: sampleKey,
      label: sample.label,
      src: sample.src,
      intent: sample.intent,
      imageUrl: sample.src,
    });
  });
});

uploadInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (!file) return;

  selectUploadedFile(file, { source: "upload" });
});

cameraInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (!file) return;

  selectUploadedFile(file, { source: "camera" });
});

bindUploadDropTarget(uploadCard, "dragging");

uploadCard.addEventListener("click", openPhotoSheet);
photoSheetCancel.addEventListener("click", closePhotoSheet);
photoSheet.addEventListener("click", handlePhotoSheetClick);
document.addEventListener("keydown", handlePhotoSheetKeydown);
searchButton.addEventListener("click", runCatalogSearch);
loadMoreButton.addEventListener("click", runCatalogLoadMore);
clearButton.addEventListener("click", resetSource);
productGrid.addEventListener("click", handleProductGridClick);
buyingGuide.addEventListener("click", handleProductGridClick);

loadWatchedItems();

function selectSource(source) {
  state.activeSource = source;
  state.cropRect = null;
  state.dragStart = null;
  document.body.classList.add("has-source");
  resetSearchResults();
  searchButton.disabled = false;
  renderCropper(source);
  querySummary.textContent =
    source.kind === "upload"
      ? `${state.uploadedFileName || "Uploaded image"} -> drag over one item`
      : `${source.label} -> drag over one item`;
  statusLine.textContent = "Drag over the item you want, then search.";
  scrollSelectedLookIntoView();
}

function resetSource() {
  state.activeSource = null;
  state.cropRect = null;
  state.dragStart = null;
  document.body.classList.remove("has-source");
  resetSearchResults();
  state.previewImage = null;
  state.uploadedFileName = "";
  uploadInput.value = "";
  cameraInput.value = "";
  searchButton.disabled = true;
  statusLine.textContent = "Choose a look to start.";
  querySummary.textContent = "Waiting for an image.";
  previewFrame.innerHTML = `
    <div class="empty-preview">
      <span>Selected look will appear here</span>
    </div>
  `;
}

function scrollSelectedLookIntoView() {
  if (!window.matchMedia("(max-width: 640px)").matches) return;

  window.requestAnimationFrame(() => {
    previewFrame.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function selectUploadedFile(file, options = {}) {
  if (!file || !file.type.startsWith("image/")) return;

  closePhotoSheet();
  const src = URL.createObjectURL(file);
  const isCamera = options.source === "camera";
  state.uploadedFileName = isCamera ? "Camera photo" : file.name;
  selectSource({
    kind: "upload",
    key: isCamera ? "camera" : "upload",
    label: isCamera ? "camera photo" : "uploaded photo",
    src,
    intent: "fashion clothing and accessories",
  });
}

function openPhotoSheet() {
  photoSheet.hidden = false;
  document.body.classList.add("has-photo-sheet");
}

function closePhotoSheet() {
  photoSheet.hidden = true;
  document.body.classList.remove("has-photo-sheet");
}

function handlePhotoSheetClick(event) {
  const sourceButton = event.target.closest("[data-photo-source]");

  if (sourceButton) {
    closePhotoSheet();

    if (sourceButton.dataset.photoSource === "camera") {
      cameraInput.value = "";
      cameraInput.click();
    } else {
      uploadInput.value = "";
      uploadInput.click();
    }
    return;
  }

  if (event.target === photoSheet) {
    closePhotoSheet();
  }
}

function handlePhotoSheetKeydown(event) {
  if (event.key === "Escape" && !photoSheet.hidden) {
    closePhotoSheet();
  }
}

function bindUploadDropTarget(target, draggingClass) {
  ["dragenter", "dragover"].forEach((eventName) => {
    target.addEventListener(eventName, (event) => {
      event.preventDefault();
      target.classList.add(draggingClass);
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    target.addEventListener(eventName, (event) => {
      event.preventDefault();
      target.classList.remove(draggingClass);
    });
  });

  target.addEventListener("drop", (event) => {
    const [file] = event.dataTransfer.files;
    selectUploadedFile(file, { source: "upload" });
  });
}

async function runCatalogSearch() {
  if (!state.activeSource) return;

  resetSearchResults();
  renderSkeletons();
  statusLine.textContent = "Searching Shopify Catalog...";
  searchButton.disabled = true;

  try {
    const data = await searchCatalog(state.activeSource);
    const results = data.products || [];
    const queryEnhancement = data.queryEnhancement || {};

    state.products = results;
    state.buyingGuide = {
      recommended: data.recommended || null,
      alternatives: Array.isArray(data.alternatives) ? data.alternatives : [],
      summary: data.rankingSummary || null,
    };
    state.pagination = data.pagination || null;
    logMissingProductImages(results);
    renderBuyingGuide();
    productGrid.innerHTML = results.map(renderProductCard).join("");
    statusLine.textContent =
      results.length > 0
        ? getResultStatus(results.length, queryEnhancement)
        : data.omittedTrustFiltered
          ? "No visible matches after seller confidence filtering."
        : "No catalog matches came back for this image.";
    updateLoadMoreButton();
  } catch (error) {
    resetSearchResults();
    statusLine.textContent = error.message || "Catalog search failed.";
  } finally {
    searchButton.disabled = false;
  }
}

async function runCatalogLoadMore() {
  const cursor = getPaginationCursor(state.pagination);

  if (!cursor || !state.lastSearch || state.isLoadingMore) return;

  state.isLoadingMore = true;
  loadMoreButton.disabled = true;
  loadMoreButton.textContent = "Loading...";
  statusLine.textContent = `Loading ${CATALOG_PAGE_LIMIT} more matches...`;

  try {
    const data = await searchCatalog(state.activeSource, { cursor });
    const results = data.products || [];

    state.products = [...state.products, ...results];
    state.pagination = data.pagination || null;
    logMissingProductImages(results);
    productGrid.innerHTML = state.products.map(renderProductCard).join("");
    statusLine.textContent =
      results.length > 0
        ? `${state.products.length} live matches loaded.`
        : data.omittedTrustFiltered
          ? `${state.products.length} live matches loaded. Hidden matches need seller review.`
        : data.omittedMissingImages
          ? `${state.products.length} live matches loaded. No more image-backed matches came back.`
          : `${state.products.length} live matches loaded. No more products came back.`;
  } catch (error) {
    statusLine.textContent = error.message || "Could not load more matches.";
  } finally {
    state.isLoadingMore = false;
    loadMoreButton.textContent = "Load more";
    updateLoadMoreButton();
  }
}

async function searchCatalog(source, options = {}) {
  const isNextPage = Boolean(options.cursor);
  let image = state.lastSearch?.image || null;
  let searchQuery = state.lastSearch?.searchQuery || "";

  if (!isNextPage) {
    if (!state.cropRect) {
      throw new Error("Drag over one item first.");
    }

    image = await cropSelectedArea();
    searchQuery = "";
  }

  if (!image) {
    throw new Error("Drag over one item first.");
  }

  const payload = {
    image,
    limit: CATALOG_PAGE_LIMIT,
  };

  if (options.cursor) {
    payload.cursor = options.cursor;
  }

  if (searchQuery) {
    payload.searchQuery = searchQuery;
  }

  const response = await fetch("/api/catalog-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Catalog search failed with ${response.status}`);
  }

  state.lastSearch = {
    image,
    searchQuery: data.searchQuery || searchQuery || data.queryEnhancement?.searchQuery || "",
  };

  return data;
}

function resetSearchResults() {
  state.isLoadingMore = false;
  state.buyingGuide = null;
  state.lastSearch = null;
  state.pagination = null;
  state.products = [];
  buyingGuide.innerHTML = "";
  buyingGuide.hidden = true;
  productGrid.innerHTML = "";
  updateLoadMoreButton();
}

async function loadWatchedItems() {
  try {
    const response = await fetch("/api/orbit");
    const data = await response.json().catch(() => ({}));

    if (!response.ok) return;

    state.orbitItemIds = new Set(
      (data.sources || [])
        .filter((source) => source.type === "item")
        .flatMap((source) => [source.itemId, source.url, source.checkoutUrl].filter(Boolean)),
    );
  } catch {
    state.orbitItemIds = new Set();
  }
}

async function handleProductGridClick(event) {
  const imageButton = event.target.closest("[data-product-image-step]");
  if (imageButton) {
    changeProductImage(imageButton);
    return;
  }

  const button = event.target.closest("[data-watch-product]");
  if (!button) return;

  const product = findProductByWatchKey(button.dataset.watchProduct);
  if (!product) return;

  button.disabled = true;
  button.textContent = "Watching...";

  try {
    const response = await fetch("/api/orbit/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(getWatchPayload(product)),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Watch failed with ${response.status}`);
    }

    const saved = data.source || {};
    [saved.itemId, saved.url, saved.checkoutUrl, getProductWatchKey(product)].filter(Boolean).forEach((id) => {
      state.orbitItemIds.add(id);
    });
    renderBuyingGuide();
    productGrid.innerHTML = state.products.map(renderProductCard).join("");
    statusLine.textContent = data.duplicate ? "Already watching that item." : "Item saved to Orbit.";
  } catch (error) {
    button.disabled = false;
    button.textContent = "Watch";
    statusLine.textContent = error.message || "Could not watch item.";
  }
}

function changeProductImage(button) {
  const card = button.closest("[data-product-card-key]");
  const product = card ? findProductByWatchKey(card.dataset.productCardKey) : null;
  const images = getProductImages(product || {});

  if (!card || images.length < 2) return;

  const step = Number(button.dataset.productImageStep || 0);
  const currentIndex = Number(card.dataset.imageIndex || 0);
  const nextIndex = (currentIndex + step + images.length) % images.length;
  const nextImage = images[nextIndex];
  const mainImage = card.querySelector(".product-main-image");
  const count = card.querySelector("[data-product-image-count]");

  if (!mainImage || !nextImage) return;

  mainImage.src = nextImage.url;
  mainImage.alt = nextImage.alt || product.title || "Product image";
  card.dataset.imageIndex = String(nextIndex);

  if (count) {
    count.textContent = `${nextIndex + 1}/${images.length}`;
  }
}

function getWatchPayload(product) {
  return {
    type: "item",
    name: product.title,
    itemId: product.id,
    sellerName: product.merchant,
    domain: product.domain,
    url: product.url,
    checkoutUrl: product.checkoutUrl,
    imageUrl: product.image,
    source: "watch_item",
    currentPrice: product.priceAmount,
    currency: product.currency,
  };
}

function getProductWatchKey(product) {
  return product.id || product.url || product.checkoutUrl || product.title;
}

function findProductByWatchKey(watchKey) {
  return [
    ...state.products,
    state.buyingGuide?.recommended?.product,
    ...(state.buyingGuide?.alternatives || []).map((item) => item.product),
  ]
    .filter(Boolean)
    .find((item) => getProductWatchKey(item) === watchKey);
}

function updateLoadMoreButton() {
  const canLoadMore = Boolean(getPaginationCursor(state.pagination));

  loadMoreButton.hidden = !canLoadMore;
  loadMoreButton.disabled = !canLoadMore || state.isLoadingMore;
}

function getPaginationCursor(pagination) {
  if (!pagination) return "";

  const hasNextPage = pagination.has_next_page ?? pagination.hasNextPage ?? true;
  const cursor = pagination.cursor || pagination.next_cursor || pagination.nextCursor || "";

  return hasNextPage && typeof cursor === "string" ? cursor : "";
}

function getResultStatus(resultCount, queryEnhancement) {
  if (queryEnhancement.used && queryEnhancement.searchQuery) {
    return `${resultCount} live matches. Gemini query: ${queryEnhancement.searchQuery}`;
  }

  if (queryEnhancement.reason === "missing_gemini_api_key") {
    return `${resultCount} live matches. Add GEMINI_API_KEY to enable query enhancement.`;
  }

  if (queryEnhancement.reason) {
    return `${resultCount} live matches. Gemini skipped: ${queryEnhancement.reason}`;
  }

  return `${resultCount} live matches from Shopify Catalog.`;
}

function renderSkeletons() {
  productGrid.innerHTML = Array.from({ length: 6 }, () => `<div class="skeleton"></div>`).join("");
}

function logMissingProductImages(products) {
  const missing = products.filter((product) => !product.image);

  if (!missing.length) return;

  console.warn(
    "Catalog products missing image URLs",
    missing.map((product) => ({
      id: product.id,
      title: product.title,
      merchant: product.merchant,
    })),
  );
}

function renderCropper(source) {
  previewFrame.innerHTML = `
    <div class="cropper" id="cropper">
      <img alt="${escapeAttribute(source.label)}" crossorigin="anonymous" src="${escapeAttribute(source.src)}" />
      <div class="crop-dim crop-dim-top"></div>
      <div class="crop-dim crop-dim-right"></div>
      <div class="crop-dim crop-dim-bottom"></div>
      <div class="crop-dim crop-dim-left"></div>
      <div class="crop-box" id="crop-box" hidden></div>
      <div class="crop-hint" id="crop-hint">Drag over one item</div>
    </div>
  `;

  const cropper = previewFrame.querySelector("#cropper");
  const image = cropper.querySelector("img");
  state.previewImage = image;

  cropper.addEventListener("pointerdown", startCrop);
  cropper.addEventListener("pointermove", moveCrop);
  cropper.addEventListener("pointerup", endCrop);
  cropper.addEventListener("pointercancel", endCrop);
}

function startCrop(event) {
  if (!state.activeSource) return;

  const point = getCropperPoint(event);
  state.dragStart = point;
  state.cropRect = { x: point.x, y: point.y, width: 0, height: 0 };
  event.currentTarget.setPointerCapture(event.pointerId);
  updateCropOverlay();
}

function moveCrop(event) {
  if (!state.dragStart) return;

  const point = getCropperPoint(event);
  const x = Math.min(state.dragStart.x, point.x);
  const y = Math.min(state.dragStart.y, point.y);
  const width = Math.abs(point.x - state.dragStart.x);
  const height = Math.abs(point.y - state.dragStart.y);

  state.cropRect = { x, y, width, height };
  updateCropOverlay();
}

function endCrop(event) {
  if (!state.dragStart) return;

  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  state.dragStart = null;

  if (!state.cropRect || state.cropRect.width < 18 || state.cropRect.height < 18) {
    state.cropRect = null;
    updateCropOverlay();
    statusLine.textContent = "Drag a larger box around one item.";
    return;
  }

  querySummary.textContent = "Selected area -> Shopify visual similarity";
  statusLine.textContent = "Area selected. Press Search.";
}

function getCropperPoint(event) {
  const rect = event.currentTarget.getBoundingClientRect();

  return {
    x: clamp(event.clientX - rect.left, 0, rect.width),
    y: clamp(event.clientY - rect.top, 0, rect.height),
  };
}

function updateCropOverlay() {
  const cropBox = previewFrame.querySelector("#crop-box");
  const cropHint = previewFrame.querySelector("#crop-hint");
  const cropper = previewFrame.querySelector("#cropper");

  if (!cropBox || !cropper) return;

  if (!state.cropRect) {
    cropBox.hidden = true;
    cropper.style.setProperty("--crop-x", "0px");
    cropper.style.setProperty("--crop-y", "0px");
    cropper.style.setProperty("--crop-w", "0px");
    cropper.style.setProperty("--crop-h", "0px");
    if (cropHint) cropHint.hidden = false;
    return;
  }

  cropBox.hidden = false;
  cropBox.style.left = `${state.cropRect.x}px`;
  cropBox.style.top = `${state.cropRect.y}px`;
  cropBox.style.width = `${state.cropRect.width}px`;
  cropBox.style.height = `${state.cropRect.height}px`;
  cropper.style.setProperty("--crop-x", `${state.cropRect.x}px`);
  cropper.style.setProperty("--crop-y", `${state.cropRect.y}px`);
  cropper.style.setProperty("--crop-w", `${state.cropRect.width}px`);
  cropper.style.setProperty("--crop-h", `${state.cropRect.height}px`);
  if (cropHint) cropHint.hidden = true;
}

async function cropSelectedArea() {
  if (!state.cropRect || !state.previewImage) return null;

  await waitForImage(state.previewImage);

  const image = state.previewImage;
  const crop = getNaturalCrop(image, state.cropRect);

  if (!crop || crop.width < 1 || crop.height < 1) return null;

  const canvas = document.createElement("canvas");
  const maxDimension = 900;
  const scale = Math.min(1, maxDimension / Math.max(crop.width, crop.height));

  canvas.width = Math.max(1, Math.round(crop.width * scale));
  canvas.height = Math.max(1, Math.round(crop.height * scale));

  const context = canvas.getContext("2d");
  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
  const [, data = ""] = dataUrl.split(",");

  return {
    contentType: "image/jpeg",
    data,
  };
}

function getNaturalCrop(image, rect) {
  const display = image.getBoundingClientRect();
  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;

  if (!naturalWidth || !naturalHeight || !display.width || !display.height) return null;

  const scale = Math.max(display.width / naturalWidth, display.height / naturalHeight);
  const renderedWidth = naturalWidth * scale;
  const renderedHeight = naturalHeight * scale;
  const offsetX = (display.width - renderedWidth) / 2;
  const offsetY = (display.height - renderedHeight) / 2;

  const x1 = clamp((rect.x - offsetX) / scale, 0, naturalWidth);
  const y1 = clamp((rect.y - offsetY) / scale, 0, naturalHeight);
  const x2 = clamp((rect.x + rect.width - offsetX) / scale, 0, naturalWidth);
  const y2 = clamp((rect.y + rect.height - offsetY) / scale, 0, naturalHeight);

  return {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
  };
}

function waitForImage(image) {
  if (image.complete && image.naturalWidth) return Promise.resolve();

  return new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", () => reject(new Error("Could not load the selected image.")), {
      once: true,
    });
  });
}

function renderBuyingGuide() {
  const guide = state.buyingGuide;

  if (!guide?.recommended?.product) {
    buyingGuide.innerHTML = "";
    buyingGuide.hidden = true;
    return;
  }

  buyingGuide.hidden = false;
  buyingGuide.innerHTML = `
    <section class="guide-answer" aria-labelledby="guide-answer-title">
      ${renderGuidePick(guide.recommended, {
        featured: true,
        titleId: "guide-answer-title",
      })}
      <div class="guide-alternatives" aria-label="Other good options">
        ${(guide.alternatives || []).map((pick) => renderGuidePick(pick)).join("")}
      </div>
    </section>
  `;
}

function renderGuidePick(pick, options = {}) {
  const product = pick?.product;
  if (!product) return "";

  const titleId = options.titleId || "";
  const titleAttribute = titleId ? ` id="${escapeAttribute(titleId)}"` : "";
  const watchKey = getProductWatchKey(product);
  const isWatched =
    state.orbitItemIds.has(product.id) ||
    state.orbitItemIds.has(product.url) ||
    state.orbitItemIds.has(product.checkoutUrl) ||
    state.orbitItemIds.has(watchKey);
  const image = product.image
    ? `<img alt="${escapeAttribute(product.title)}" src="${escapeAttribute(product.image)}" />`
    : `<div class="guide-pick-empty">No image</div>`;
  const signals = (pick.signals || [])
    .slice(0, 4)
    .map((signal) => `<span>${escapeHtml(signal)}</span>`)
    .join("");
  const viewLink = product.url
    ? `<a class="product-link" href="${escapeAttribute(product.url)}" target="_blank" rel="noreferrer">View</a>`
    : `<span class="product-link disabled">No page</span>`;
  const buyLink = product.checkoutUrl
    ? canBuyDirectly(product)
      ? `<a class="product-link secondary" href="${escapeAttribute(product.checkoutUrl)}" target="_blank" rel="noreferrer">Buy</a>`
      : `<span class="product-link secondary disabled" title="Seller needs more confidence before direct buy.">Review</span>`
    : "";
  const watchButton = `
    <button class="product-link watch" type="button" data-watch-product="${escapeAttribute(watchKey)}" ${
      isWatched ? "disabled" : ""
    }>
      ${isWatched ? "Watching" : "Watch"}
    </button>
  `;

  return `
    <article class="guide-pick ${options.featured ? "featured" : ""}">
      <div class="guide-pick-media">${image}</div>
      <div class="guide-pick-copy">
        <p class="soft-label">${escapeHtml(pick.title || "Other good option")}</p>
        <h3${titleAttribute}>${escapeHtml(product.title || "Untitled product")}</h3>
        <p>${escapeHtml(pick.reason || "Good balance of match, seller evidence, and price.")}</p>
        <div class="guide-signals">${signals}</div>
        <div class="price-row">
          <span class="price">${escapeHtml(product.price || "Price varies")}</span>
          <span class="product-actions">
            ${viewLink}
            ${buyLink}
            ${watchButton}
          </span>
        </div>
      </div>
    </article>
  `;
}

function renderProductCard(product) {
  const url = escapeAttribute(product.url || "");
  const checkoutUrl = escapeAttribute(product.checkoutUrl || "");
  const watchKey = getProductWatchKey(product);
  const isWatched =
    state.orbitItemIds.has(product.id) ||
    state.orbitItemIds.has(product.url) ||
    state.orbitItemIds.has(product.checkoutUrl) ||
    state.orbitItemIds.has(watchKey);
  const images = getProductImages(product);
  const image = images.length
    ? renderProductMedia(product, images)
    : `<div class="product-image-empty">No image</div>`;
  const confidence = product.sellerConfidence || {};
  const trustEvidence = renderTrustEvidence(product, confidence);
  const viewLink = url
    ? `<a class="product-link" href="${url}" target="_blank" rel="noreferrer">View</a>`
    : `<span class="product-link disabled">No page</span>`;
  const buyLink = checkoutUrl
    ? canBuyDirectly(product)
      ? `<a class="product-link secondary" href="${checkoutUrl}" target="_blank" rel="noreferrer">Buy</a>`
      : `<span class="product-link secondary disabled" title="Seller needs more confidence before direct buy.">Review</span>`
    : "";
  const watchButton = `
    <button class="product-link watch" type="button" data-watch-product="${escapeAttribute(watchKey)}" ${
      isWatched ? "disabled" : ""
    }>
      ${isWatched ? "Watching" : "Watch"}
    </button>
  `;

  return `
    <article class="product-card" data-product-card-key="${escapeAttribute(watchKey)}" data-image-index="0">
      ${image}
      <div class="product-body">
        <div class="product-meta">
          <span>${escapeHtml(product.matchLabel || "Catalog match")}</span>
          <span>${escapeHtml(product.merchant || "Shopify merchant")}</span>
        </div>
        ${trustEvidence}
        <h3>${escapeHtml(product.title)}</h3>
        <div class="price-row">
          <span class="price">${escapeHtml(product.price || "Price varies")}</span>
          <span class="product-actions">
            ${viewLink}
            ${buyLink}
            ${watchButton}
          </span>
        </div>
      </div>
    </article>
  `;
}

function canBuyDirectly(product) {
  return new Set(["preferred", "checked", "reviewed"]).has(product.sellerConfidence?.level);
}

function renderTrustEvidence(product, confidence = {}) {
  const evidence = getMockTrustEvidence(product, confidence);
  if (!evidence.length) return "";

  const chips = evidence
    .map(
      (item) => `
        <span class="trust-chip ${escapeAttribute(item.kind || "info")}" title="${escapeAttribute(item.detail)}">
          ${escapeHtml(item.label)}
        </span>
      `,
    )
    .join("");

  return `<div class="trust-evidence" aria-label="Shop evidence">${chips}</div>`;
}

function renderProductMedia(product, images) {
  const title = product.title || "Product image";
  const primaryImage = images[0];
  const controls =
    images.length > 1
      ? `
        <button class="product-image-nav previous" type="button" data-product-image-step="-1" aria-label="${escapeAttribute(
          `Show previous photo of ${title}`,
        )}">&lsaquo;</button>
        <button class="product-image-nav next" type="button" data-product-image-step="1" aria-label="${escapeAttribute(
          `Show next photo of ${title}`,
        )}">&rsaquo;</button>
        <span class="product-image-count" data-product-image-count>1/${images.length}</span>
      `
      : "";

  return `
    <div class="product-media">
      <img class="product-main-image" alt="${escapeAttribute(primaryImage.alt || title)}" src="${escapeAttribute(
        primaryImage.url,
      )}" loading="lazy" />
      ${controls}
    </div>
  `;
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

function getMockTrustEvidence(product, confidence = {}) {
  const level = confidence.level || "unknown";

  if (level === "unknown") {
    return [
      {
        kind: "caution",
        label: "Look before buying",
        detail: "Seller details still need a look.",
      },
    ];
  }

  const evidence = [];
  const reviewCount = Number(confidence.reviewCount || confidence.ratingCount || product.rating?.count || 0);

  if (level === "preferred") {
    evidence.push({
      kind: "preferred",
      label: "Saved shop",
      detail: "Part of your saved shops.",
    });
  }

  evidence.push({
    kind: reviewCount > 0 ? "review" : "muted",
    label: `${reviewCount} reviews`,
    detail: reviewCount > 0 ? `${reviewCount} shopper reviews found.` : "No shopper reviews found yet.",
  });

  return evidence.concat(getMockPolicyEvidence(product));
}

function getMockPolicyEvidence(product) {
  const profiles = [
    [
      {
        kind: "policy",
        label: "30-day returns",
        detail: "Returns appear to be accepted within 30 days.",
      },
      {
        kind: "policy",
        label: "Contact found",
        detail: "A customer support email, contact form, or help path was found.",
      },
      {
        kind: "policy",
        label: "Ships from US",
        detail: "Shipping evidence mentions US fulfillment or delivery.",
      },
    ],
    [
      {
        kind: "policy",
        label: "14-day returns",
        detail: "Returns appear to be accepted within 14 days.",
      },
      {
        kind: "policy",
        label: "Email support",
        detail: "A customer support email was found.",
      },
      {
        kind: "policy",
        label: "Shipping policy",
        detail: "A shipping policy page was found.",
      },
    ],
    [
      {
        kind: "policy",
        label: "Return policy",
        detail: "Return or refund language was found, but the exact window is unclear.",
      },
      {
        kind: "policy",
        label: "Contact found",
        detail: "A contact page or support form was found.",
      },
      {
        kind: "policy",
        label: "Shipping details",
        detail: "Delivery timing or region information was found.",
      },
    ],
    [
      {
        kind: "caution",
        label: "Exchange only",
        detail: "Purchases appear allowed, but returns look limited to exchanges or store credit.",
      },
      {
        kind: "policy",
        label: "Contact found",
        detail: "A support path was found.",
      },
      {
        kind: "policy",
        label: "Shipping policy",
        detail: "A shipping policy page was found.",
      },
    ],
  ];

  const seed = `${product.merchant || ""}|${product.url || ""}|${product.title || ""}`;
  return profiles[hashString(seed) % profiles.length];
}

function hashString(value) {
  const text = String(value ?? "");
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return hash;
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
