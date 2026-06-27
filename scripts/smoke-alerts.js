const fs = require("node:fs/promises");
const path = require("node:path");

const BASE_URL = process.env.SMOKE_BASE_URL || "http://localhost:4173";
const ROOT = path.resolve(__dirname, "..");
const ALERTS_DATA_PATH = path.join(ROOT, "data", "alerts.json");
const TEMP_ITEM_ID = "alert-smoke-test-item";
const TEMP_SOURCE_ID = `item_${TEMP_ITEM_ID}`;
const TEMP_ALERT_PREFIX = `alert_item-${TEMP_ITEM_ID}`;

run().catch((error) => {
  console.error(`alerts smoke failed: ${error.message}`);
  process.exitCode = 1;
});

async function run() {
  await request("GET", "/api/alerts");

  try {
    await createTempWatchedItem();

    const inbox = await request("GET", "/api/alerts");
    const tempAlerts = getTempAlerts(inbox);
    assert(tempAlerts.length === 3, `expected 3 temp alerts, saw ${tempAlerts.length}`);
    assertTypes(tempAlerts, ["price", "restock", "shop"]);

    const priceAlert = tempAlerts.find((alert) => alert.type === "price");
    const restockAlert = tempAlerts.find((alert) => alert.type === "restock");

    await request("PATCH", `/api/alerts/${encodeURIComponent(priceAlert.id)}`, { dismissed: true });
    await request("PATCH", `/api/alerts/${encodeURIComponent(restockAlert.id)}`, { read: true });

    const persistedInbox = await request("GET", "/api/alerts");
    const persistedAlerts = getTempAlerts(persistedInbox);
    const persistedPrice = persistedAlerts.find((alert) => alert.id === priceAlert.id);
    const persistedRestock = persistedAlerts.find((alert) => alert.id === restockAlert.id);

    assert(persistedPrice.dismissed === true, "dismissed alert did not persist");
    assert(persistedPrice.read === true, "dismissed alert should also be read");
    assert(persistedRestock.read === true, "read alert did not persist");

    console.log("alerts smoke passed");
  } finally {
    await cleanupTempState();
  }
}

async function createTempWatchedItem() {
  await request("POST", "/api/orbit/sources", {
    type: "item",
    name: "Alert Smoke Test Item",
    itemId: TEMP_ITEM_ID,
    sellerName: "Smoke Test Shop",
    domain: "example.com",
    url: "https://example.com/products/alert-smoke-test-item",
    checkoutUrl: "https://example.com/checkouts/alert-smoke-test-item",
    imageUrl: "",
    source: "watch_item",
    currentPrice: 9900,
    currency: "USD",
  });
}

async function cleanupTempState() {
  await request("DELETE", `/api/orbit/sources/${encodeURIComponent(TEMP_SOURCE_ID)}`).catch(() => {});

  const alertsData = await readAlertsData();

  for (const id of Object.keys(alertsData.states)) {
    if (id.startsWith(TEMP_ALERT_PREFIX)) {
      delete alertsData.states[id];
    }
  }

  await fs.mkdir(path.dirname(ALERTS_DATA_PATH), { recursive: true });
  await fs.writeFile(ALERTS_DATA_PATH, `${JSON.stringify(alertsData, null, 2)}\n`, "utf8");
}

async function readAlertsData() {
  try {
    const raw = await fs.readFile(ALERTS_DATA_PATH, "utf8");
    const data = JSON.parse(raw);

    return {
      states: data.states && typeof data.states === "object" ? data.states : {},
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;

    return { states: {} };
  }
}

function getTempAlerts(inbox) {
  return (inbox.alerts || []).filter((alert) => alert.id.startsWith(TEMP_ALERT_PREFIX));
}

function assertTypes(alerts, types) {
  const actual = alerts.map((alert) => alert.type).sort();
  const expected = [...types].sort();

  assert(JSON.stringify(actual) === JSON.stringify(expected), `expected alert types ${expected}, saw ${actual}`);
}

async function request(method, pathname, body) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed with ${response.status}: ${data.error || "unknown error"}`);
  }

  return data;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
