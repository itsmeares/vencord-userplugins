/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import definePlugin from "@utils/types";

const MODE_STORAGE_KEY = "vc-compact-dm-bar:mode:v1";
const COMPACT_WIDTH = 72;
const SIDEBAR_SELECTOR = '#app-mount [class*="sidebarList_"]:has([class*="privateChannels_"])';

let running = false;
let observer: MutationObserver | null = null;
let animationFrame = 0;
let sidebar: HTMLElement | null = null;
let toggleEdge: HTMLDivElement | null = null;
let nativeResizeHandle: HTMLElement | null = null;
let accountDock: HTMLDivElement | null = null;
let controlsMenu: HTMLDivElement | null = null;
let compactMode = true;
let controlsOpen = false;
let avatarSignature = "";
let hiddenNativePanels: {
    element: HTMLElement;
    opacity: string;
    visibility: string;
    pointerEvents: string;
} | null = null;

function readStoredMode() {
    try {
        return localStorage.getItem(MODE_STORAGE_KEY) !== "default";
    } catch {
        return true;
    }
}

function persistMode() {
    try {
        localStorage.setItem(MODE_STORAGE_KEY, compactMode ? "compact" : "default");
    } catch (error) {
        console.warn("[CompactDMBar] Failed to persist compact mode", error);
    }
}

function getNativePanels() {
    if (!sidebar) return null;

    const parent = sidebar.parentElement;
    return parent?.querySelector<HTMLElement>(':scope > [class*="panels_"]')
        ?? parent?.querySelector<HTMLElement>('[class*="panels_"]')
        ?? null;
}

function restoreNativePanels() {
    if (!hiddenNativePanels) return;

    const { element, opacity, visibility, pointerEvents } = hiddenNativePanels;
    element.style.setProperty("opacity", opacity);
    element.style.setProperty("visibility", visibility);
    element.style.setProperty("pointer-events", pointerEvents);
    hiddenNativePanels = null;
}

function syncNativePanelsVisibility() {
    const panels = getNativePanels();

    if (hiddenNativePanels && hiddenNativePanels.element !== panels) {
        restoreNativePanels();
    }

    if (!panels || !compactMode) {
        restoreNativePanels();
        return;
    }

    if (!hiddenNativePanels) {
        hiddenNativePanels = {
            element: panels,
            opacity: panels.style.getPropertyValue("opacity"),
            visibility: panels.style.getPropertyValue("visibility"),
            pointerEvents: panels.style.getPropertyValue("pointer-events")
        };
    }

    panels.style.setProperty("opacity", "0", "important");
    panels.style.setProperty("visibility", "hidden", "important");
    panels.style.setProperty("pointer-events", "none", "important");
}

function getNativeProfileButton() {
    const panels = getNativePanels();
    if (!panels) return null;

    return panels.querySelector<HTMLElement>('[role="button"][class*="accountPopoutButton_"]')
        ?? panels.querySelector<HTMLElement>('[class*="avatarWrapper_"]')
        ?? panels.querySelector<HTMLElement>('[class*="accountPopoutButtonWrapper_"]')
        ?? null;
}

function getNativeControlButton(...labels: string[]) {
    const panels = getNativePanels();
    if (!panels) return null;

    const buttons = Array.from(panels.querySelectorAll<HTMLButtonElement>('[class*="buttons_"] button'));
    return buttons.find(button => labels.includes(button.getAttribute("aria-label") ?? "")) ?? null;
}

function getPresenceColor() {
    const panels = getNativePanels();
    const source = `${panels?.textContent ?? ""} ${panels?.innerHTML ?? ""}`.toLowerCase();

    if (source.includes("do not disturb") || source.includes("dnd")) return "#ff6269";
    if (source.includes("idle")) return "#ffd166";
    if (source.includes("online")) return "#45d483";
    if (source.includes("stream")) return "#a586ff";
    return "#b5bac1";
}

function clearSidebarWidth() {
    if (!sidebar) return;

    for (const property of ["width", "min-width", "max-width", "flex-basis"]) {
        sidebar.style.removeProperty(property);
    }
    sidebar.style.removeProperty("--vc-compact-dm-width");
}

function syncNativeResizeHandle() {
    if (!sidebar) return;

    const parent = sidebar.parentElement;
    const next = parent?.querySelector<HTMLElement>(':scope > [class*="sidebarResizeHandle_"]')
        ?? parent?.querySelector<HTMLElement>('[class*="sidebarResizeHandle_"]')
        ?? null;

    if (nativeResizeHandle && nativeResizeHandle !== next) {
        nativeResizeHandle.style.removeProperty("pointer-events");
        nativeResizeHandle.style.removeProperty("opacity");
    }

    nativeResizeHandle = next;
    if (!nativeResizeHandle) return;

    nativeResizeHandle.style.setProperty("pointer-events", "none", "important");
    nativeResizeHandle.style.setProperty("opacity", "0", "important");
}

function syncToggleEdge() {
    if (!sidebar || !toggleEdge) return;

    const rect = sidebar.getBoundingClientRect();
    toggleEdge.style.left = `${Math.round(rect.right - 4)}px`;
    toggleEdge.style.top = `${Math.round(rect.top)}px`;
    toggleEdge.style.height = `${Math.round(rect.height)}px`;
}

function syncControlsMenuPosition() {
    if (!controlsMenu || !accountDock || !controlsOpen) return;

    const trigger = accountDock.querySelector<HTMLElement>(".vc-cdm-controls-button");
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    controlsMenu.style.left = `${Math.round(rect.right + 8)}px`;
    controlsMenu.style.bottom = `${Math.round(window.innerHeight - rect.bottom)}px`;
}

function setControlsOpen(open: boolean) {
    controlsOpen = open && compactMode;

    if (accountDock) accountDock.dataset.controlsOpen = String(controlsOpen);
    if (controlsMenu) controlsMenu.dataset.open = String(controlsOpen);

    if (controlsOpen) syncControlsMenuPosition();
}

function applyMode() {
    if (!sidebar) return;

    sidebar.dataset.vcCompactDmBar = "true";
    sidebar.dataset.vcCompactDmExpanded = String(!compactMode);

    if (compactMode) {
        const width = `${COMPACT_WIDTH}px`;
        sidebar.style.setProperty("width", width, "important");
        sidebar.style.setProperty("min-width", width, "important");
        sidebar.style.setProperty("max-width", width, "important");
        sidebar.style.setProperty("flex-basis", width, "important");
        sidebar.style.setProperty("--vc-compact-dm-width", width);
    } else {
        clearSidebarWidth();
        setControlsOpen(false);
    }

    syncNativePanelsVisibility();

    if (accountDock) {
        accountDock.style.setProperty("--vc-cdm-self-status", getPresenceColor());
    }

    syncToggleEdge();
    syncControlsMenuPosition();
}

function toggleMode() {
    compactMode = !compactMode;
    applyMode();
    persistMode();
}

function createToggleEdge() {
    toggleEdge?.remove();

    const edge = document.createElement("div");
    edge.className = "vc-cdm-toggle-edge";
    edge.setAttribute("role", "separator");
    edge.setAttribute("aria-label", "Toggle compact direct messages sidebar");
    edge.setAttribute("aria-orientation", "vertical");
    edge.tabIndex = 0;

    edge.addEventListener("dblclick", event => {
        event.preventDefault();
        event.stopPropagation();
        toggleMode();
    });

    edge.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggleMode();
    });

    document.body.appendChild(edge);
    toggleEdge = edge;
    syncToggleEdge();
}

function refreshProfileButton(profileButton: HTMLButtonElement) {
    const nativeProfileButton = getNativeProfileButton();
    if (!nativeProfileButton) return;

    const image = nativeProfileButton.querySelector<HTMLImageElement>("img")
        ?? getNativePanels()?.querySelector<HTMLImageElement>('[class*="avatarWrapper_"] img')
        ?? getNativePanels()?.querySelector<HTMLImageElement>('[class*="accountPopoutButtonWrapper_"] img')
        ?? null;

    const signature = image?.src ?? "";
    if (signature === avatarSignature && profileButton.childElementCount) return;
    avatarSignature = signature;

    profileButton.replaceChildren();

    if (image) {
        const clone = image.cloneNode(true) as HTMLImageElement;
        clone.removeAttribute("class");
        clone.className = "vc-cdm-profile-image";
        clone.alt = "";
        clone.draggable = false;
        profileButton.appendChild(clone);
    }
}

const CONTROL_ICONS = {
    mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-3.07A7 7 0 0 1 5 11a1 1 0 1 1 2 0 5 5 0 0 0 10 0Z"/></svg>',
    deafen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3a9 9 0 0 0-9 9v5a3 3 0 0 0 3 3h2a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H5a7 7 0 0 1 14 0h-3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2a3 3 0 0 0 3-3v-5a9 9 0 0 0-9-9Z"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9.26 3.18 9.7 1h4.6l.44 2.18c.54.2 1.05.5 1.52.88l2.08-.72 2.3 3.98-1.65 1.47c.1.55.1 1.12 0 1.67l1.65 1.47-2.3 3.98-2.08-.72c-.47.38-.98.68-1.52.88L14.3 19h-4.6l-.44-2.18a7 7 0 0 1-1.52-.88l-2.08.72-2.3-3.98 1.65-1.47a7 7 0 0 1 0-1.67L3.36 8.07l2.3-3.98 2.08.72c.47-.38.98-.68 1.52-.88ZM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/></svg>'
};

function createControlAction(type: keyof typeof CONTROL_ICONS, title: string, labels: string[]) {
    const button = document.createElement("button");
    button.className = "vc-cdm-control-action";
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);
    button.innerHTML = CONTROL_ICONS[type];

    button.addEventListener("click", event => {
        event.stopPropagation();
        getNativeControlButton(...labels)?.click();
        setControlsOpen(false);
    });

    return button;
}

function createControlsMenu() {
    controlsMenu?.remove();

    const menu = document.createElement("div");
    menu.className = "vc-cdm-controls-menu";
    menu.dataset.open = "false";
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", "Audio and settings controls");
    menu.append(
        createControlAction("mute", "Mute / Unmute", ["Mute", "Unmute"]),
        createControlAction("deafen", "Deafen / Undeafen", ["Deafen", "Undeafen"]),
        createControlAction("settings", "User Settings", ["User Settings"])
    );

    document.body.appendChild(menu);
    controlsMenu = menu;
}

function createAccountDock() {
    if (!sidebar) return;

    accountDock?.remove();

    const dock = document.createElement("div");
    dock.className = "vc-cdm-account-dock";
    dock.dataset.controlsOpen = "false";
    dock.style.setProperty("--vc-cdm-self-status", getPresenceColor());

    const profileButton = document.createElement("button");
    profileButton.className = "vc-cdm-profile-button";
    profileButton.type = "button";
    profileButton.setAttribute("aria-label", "Open profile");
    profileButton.addEventListener("click", event => {
        event.stopPropagation();
        getNativeProfileButton()?.click();
        setControlsOpen(false);
    });

    const controlsButton = document.createElement("button");
    controlsButton.className = "vc-cdm-controls-button";
    controlsButton.type = "button";
    controlsButton.setAttribute("aria-label", "Audio and settings");
    controlsButton.setAttribute("aria-haspopup", "true");
    controlsButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 7h10.2a3 3 0 1 0 0-2H4a1 1 0 0 0 0 2Zm0 6h4.2a3 3 0 1 0 0-2H4a1 1 0 1 0 0 2Zm0 6h12.2a3 3 0 1 0 0-2H4a1 1 0 1 0 0 2Z"/></svg>';

    controlsButton.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        setControlsOpen(!controlsOpen);
    });

    dock.append(profileButton, controlsButton);
    sidebar.appendChild(dock);

    accountDock = dock;
    avatarSignature = "";
    refreshProfileButton(profileButton);

    if (!controlsMenu?.isConnected) createControlsMenu();
}

function refreshDock() {
    if (!accountDock?.isConnected) {
        createAccountDock();
        return;
    }

    accountDock.style.setProperty("--vc-cdm-self-status", getPresenceColor());

    const profileButton = accountDock.querySelector<HTMLButtonElement>(".vc-cdm-profile-button");
    if (profileButton) refreshProfileButton(profileButton);

    if (!controlsMenu?.isConnected) createControlsMenu();
    syncControlsMenuPosition();
}

function detachSidebar() {
    setControlsOpen(false);

    accountDock?.remove();
    accountDock = null;
    controlsMenu?.remove();
    controlsMenu = null;
    avatarSignature = "";
    restoreNativePanels();

    if (sidebar) {
        delete sidebar.dataset.vcCompactDmBar;
        delete sidebar.dataset.vcCompactDmExpanded;
        clearSidebarWidth();
    }

    sidebar = null;
}

function refresh() {
    animationFrame = 0;
    if (!running) return;

    const nextSidebar = document.querySelector<HTMLElement>(SIDEBAR_SELECTOR);

    if (!nextSidebar) {
        if (sidebar) detachSidebar();
        toggleEdge?.remove();
        toggleEdge = null;
        return;
    }

    if (sidebar !== nextSidebar) {
        detachSidebar();
        sidebar = nextSidebar;
        createAccountDock();
        createToggleEdge();
    }

    syncNativeResizeHandle();
    applyMode();
    refreshDock();

    if (!toggleEdge?.isConnected) createToggleEdge();
    syncToggleEdge();
    syncControlsMenuPosition();
}

function scheduleRefresh() {
    if (!running || animationFrame) return;
    animationFrame = requestAnimationFrame(refresh);
}

function onDocumentPointerDown(event: PointerEvent) {
    if (!controlsOpen) return;
    if (!(event.target instanceof Node)) return;
    if (accountDock?.contains(event.target) || controlsMenu?.contains(event.target)) return;
    setControlsOpen(false);
}

export default definePlugin({
    name: "CompactDMBar",
    description: "Toggles the Home/Friends direct-message sidebar between Discord's default layout and a compact icon-only rail.",
    tags: ["Appearance", "Friends"],
    authors: [{ name: "itsmeares", id: 0n }],

    start() {
        running = true;
        compactMode = readStoredMode();

        document.addEventListener("pointerdown", onDocumentPointerDown, true);
        window.addEventListener("resize", scheduleRefresh);

        observer = new MutationObserver(scheduleRefresh);
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        scheduleRefresh();
    },

    stop() {
        running = false;

        observer?.disconnect();
        observer = null;

        document.removeEventListener("pointerdown", onDocumentPointerDown, true);
        window.removeEventListener("resize", scheduleRefresh);

        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
            animationFrame = 0;
        }

        toggleEdge?.remove();
        toggleEdge = null;

        if (nativeResizeHandle) {
            nativeResizeHandle.style.removeProperty("pointer-events");
            nativeResizeHandle.style.removeProperty("opacity");
            nativeResizeHandle = null;
        }

        detachSidebar();
    }
});
