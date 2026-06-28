const alertSections = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
];

const alertState = {
  alerts: [],
  collapsedSections: {},
  status: "loading",
  error: "",
};

const alertInbox = document.querySelector("#alert-inbox");
const alertsCount = document.querySelector("#alerts-count");

alertInbox.addEventListener("click", async (event) => {
  const sectionToggle = event.target.closest("[data-toggle-alert-section]");
  const dismissButton = event.target.closest("[data-dismiss-alert]");
  const readLink = event.target.closest("[data-read-alert]");

  if (sectionToggle) {
    const sectionId = sectionToggle.dataset.toggleAlertSection;
    alertState.collapsedSections[sectionId] = !alertState.collapsedSections[sectionId];
    renderAlerts();
    return;
  }

  if (dismissButton) {
    await patchAlert(dismissButton.dataset.dismissAlert, { dismissed: true });
    return;
  }

  if (readLink) {
    event.preventDefault();
    const href = readLink.getAttribute("href");

    await patchAlert(readLink.dataset.readAlert, { read: true });

    if (href && href !== "#") {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  }
});

loadAlerts();

async function loadAlerts() {
  alertState.status = "loading";
  renderAlerts();

  try {
    const response = await fetch("/api/alerts");
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Alerts failed with ${response.status}`);
    }

    alertState.alerts = Array.isArray(data.alerts) ? data.alerts : [];
    alertState.status = "ready";
    alertState.error = "";
  } catch (error) {
    alertState.status = "error";
    alertState.error = error.message || "Could not load alerts.";
  }

  renderAlerts();
}

async function patchAlert(alertId, patch) {
  const previousAlerts = alertState.alerts;
  alertState.alerts = alertState.alerts.map((alert) =>
    alert.id === alertId ? { ...alert, ...patch, read: patch.dismissed ? true : patch.read ?? alert.read } : alert,
  );
  renderAlerts();

  try {
    const response = await fetch(`/api/alerts/${encodeURIComponent(alertId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Alert update failed with ${response.status}`);
    }

    if (data.alert) {
      alertState.alerts = alertState.alerts.map((alert) => (alert.id === alertId ? data.alert : alert));
      renderAlerts();
    }
  } catch (error) {
    alertState.alerts = previousAlerts;
    alertState.status = "error";
    alertState.error = error.message || "Could not update alert.";
    renderAlerts();
  }
}

function renderAlerts() {
  if (alertState.status === "loading") {
    alertInbox.innerHTML = `<div class="empty-alert-state">Loading alerts.</div>`;
    alertsCount.textContent = "Loading";
    return;
  }

  if (alertState.status === "error") {
    alertInbox.innerHTML = `<div class="empty-alert-state">${escapeHtml(alertState.error)}</div>`;
    alertsCount.textContent = "Needs attention";
    return;
  }

  const activeAlerts = alertState.alerts.filter((alert) => !alert.dismissed);

  alertInbox.innerHTML =
    activeAlerts.length > 0
      ? alertSections.map((section) => renderSection(section, activeAlerts)).join("")
      : `<div class="empty-alert-state">Inbox clear. Watch an item to generate mock alerts.</div>`;

  alertsCount.textContent = `${activeAlerts.length} active`;
}

function renderSection(section, activeAlerts) {
  const sectionAlerts = activeAlerts.filter((alert) => alert.section === section.id);

  if (sectionAlerts.length === 0) return "";

  const collapsed = Boolean(alertState.collapsedSections[section.id]);
  const listId = `alert-section-${section.id}-list`;

  return `
    <section class="alert-section" aria-label="${escapeAttribute(section.label)}">
      <div class="alert-section-head">
        <h3>
          <button
            type="button"
            class="alert-section-toggle"
            data-toggle-alert-section="${escapeAttribute(section.id)}"
            aria-expanded="${collapsed ? "false" : "true"}"
            aria-controls="${escapeAttribute(listId)}"
          >
            <span class="alert-section-chevron" aria-hidden="true"></span>
            <span>${escapeHtml(section.label)}</span>
          </button>
        </h3>
        <span class="alert-section-count">${sectionAlerts.length}</span>
      </div>
      <div class="alert-list" id="${escapeAttribute(listId)}" ${collapsed ? "hidden" : ""}>
        ${sectionAlerts.map(renderAlertRow).join("")}
      </div>
    </section>
  `;
}

function renderAlertRow(alert) {
  const href = alert.url || "#";
  const image = alert.image
    ? `<img class="alert-thumb" alt="${escapeAttribute(alert.title)}" src="${escapeAttribute(alert.image)}" />`
    : `<div class="alert-thumb empty" aria-hidden="true">${escapeHtml(getInitials(alert))}</div>`;

  return `
    <article class="alert-row ${escapeAttribute(alert.type)} ${alert.read ? "read" : "unread"}">
      ${image}
      <span class="alert-badge">${escapeHtml(getAlertLabel(alert.type))}</span>
      <div class="alert-main">
        <h4>${escapeHtml(alert.title)}</h4>
        <p>${escapeHtml(alert.shop)} · ${escapeHtml(alert.detail)}</p>
      </div>
      <strong class="alert-change-text">${escapeHtml(alert.change)}</strong>
      <span class="alert-time">${escapeHtml(alert.time)}</span>
      <div class="alert-actions">
        <a href="${escapeAttribute(href)}" data-read-alert="${escapeAttribute(alert.id)}" aria-label="Open ${escapeAttribute(
          alert.title,
        )}">View</a>
        <button type="button" data-dismiss-alert="${escapeAttribute(alert.id)}">Done</button>
      </div>
    </article>
  `;
}

function getAlertLabel(type) {
  if (type === "shop") return "shop";

  return type;
}

function getInitials(alert) {
  return (alert.shop || alert.title || "L")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
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
