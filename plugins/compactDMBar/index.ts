/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import * as DataStore from "@api/DataStore";
import definePlugin from "@utils/types";

const MODE_KEY = "CompactDMBar_compactModeV3";
const EXPANDED_WIDTH_KEY = "CompactDMBar_expandedWidth";

const COMPACT_WIDTH = 72;
const DEFAULT_EXPANDED_WIDTH = 280;
const COMPACT_TRIGGER = 190;
const MAX_WIDTH = 480;

const SIDEBAR_SELECTOR = '#app-mount [class*="sidebarList_"]:has([class*="privateChannels_"])';

let observer: MutationObserver | null = null;
let animationFrame = 0;
let sidebar: HTMLElement | null = null;
let floatingHandle: HTMLButtonElement | null = null;
let accountDock: HTMLDivElement | null = null;
let compactMode = true;
let lastExpandedWidth = DEFAULT_EXPANDED_WIDTH;
let controlsOpen = false;
let avatarSignature = "";
let controlsSignature = "";
let dragSession: {
    pointerId: number;
    startX: number;
    startWidth: number;
    moved: boolean;
} | null = null;

function clampExpandedWidth(width: number) {
    return Math.min(MAX_WIDTH, Math.max(COMPACT_TRIGGER, Math.round(width)));
}

function getNativePanels() {
    if (!sidebar) return null;

    const parent = sidebar.parentElement;
    return parent?.querySelector<HTMLElement>(':scope > [class*="panels_"]')
        ?? parent?.querySelector<HTMLElement>('[class*="panels_"]')
        ?? null;
}

function getNativeAvatarButton() {
    const panels = getNativePanels();
    if (!panels) return null;

    return panels.querySelector<HTMLElement>('[class*="avatarWrapper_"]')
        ?? panels.querySelector<HTMLElement>('[class*="accountPopoutButtonWrapper_"]')
        ?? null;
}

function getNativeControlButtons() {
    const panels = getNativePanels();
    if (!panels) return [];

    const buttons = panels.querySelector<HTMLElement>('[class*="buttons_"]');
    if (!buttons) return [];

    return Array.from(buttons.querySelectorAll<HTMLButtonElement>("button"));
}

function setControlsOpen(open: boolean) {
    controlsOpen = open;
    if (accountDock) accountDock.dataset.controlsOpen = String(open);
}

async function persistState() {
    await DataStore.set(MODE_KEY, compactMode);
    await DataStore.set(EXPANDED_WIDTH_KEY, lastExpandedWidth);
}

function clearSidebarWidth() {
    if (!sidebar) return;

    for (const property of ["width", "min-width", "max-width", "flex-basis"]) {
        sidebar.style.removeProperty(property);
    }
}

function forceSidebarWidth(width: number) {
    if (!sidebar) return;

    const value = `${Math.round(width)}px`;
    sidebar.style.setProperty("width", value, "important");
    sidebar.style.setProperty("min-width", value, "important");
    sidebar.style.setProperty("max-width", value, "important");
    sidebar.style.setProperty("flex-basis", value, "important");
    sidebar.style.setProperty("--vc-compact-dm-width", value);
}

function syncHandlePosition() {
    if (!sidebar || !floatingHandle) return;

    const rect = sidebar.getBoundingClientRect();
    floatingHandle.style.left = `${Math.round(rect.right - 10)}px`;
    floatingHandle.style.top = `${Math.round(rect.top + rect.height / 2 - 17)}px`;
    floatingHandle.dataset.compact = String(compactMode);
    floatingHandle.setAttribute("aria-label", compactMode ? "Expand direct messages sidebar" : "Compact direct messages sidebar");
    floatingHandle.title = compactMode
        ? "Drag right or click to expand"
        : "Drag left or click to compact";
}

function applyMode() {
    if (!sidebar) return;

    sidebar.dataset.vcCompactDmBar = "true";
    sidebar.dataset.vcCompactDmExpanded = String(!compactMode);

    if (compactMode) {
        forceSidebarWidth(COMPACT_WIDTH);
    } else {
        forceSidebarWidth(lastExpandedWidth);
    }

    syncHandlePosition();
}

function setCompact(compact: boolean, expandedWidth?: number) {
    compactMode = compact;

    if (!compact) {
        if (typeof expandedWidth === "number" && Number.isFinite(expandedWidth)) {
            lastExpandedWidth = clampExpandedWidth(expandedWidth);
        }
    } else {
        setControlsOpen(false);
    }

    applyMode();
}

function toggleMode() {
    setCompact(!compactMode);
    void persistState();
}

function createFloatingHandle() {
    floatingHandle?.remove();

    const handle = document.createElement("button");
    handle.className = "vc-cdm-floating-handle";
    handle.type = "button";
    handle.innerHTML = `
        <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
            <path class="vc-cdm-handle-chevron vc-cdm-handle-chevron-left" fill="currentColor" d="M12.8 4.6 7.4 10l5.4 5.4 1.4-1.4-4-4 4-4-1.4-1.4Z"/>
            <path class="vc-cdm-handle-chevron vc-cdm-handle-chevron-right" fill="currentColor" d="m7.2 4.6-1.4 1.4 4 4-4 4 1.4 1.4 5.4-5.4-5.4-5.4Z"/>
        </svg>`;

    handle.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;

        event.preventDefault();
        event.stopPropagation();

        dragSession = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startWidth: compactMode ? COMPACT_WIDTH : lastExpandedWidth,
            moved: false
        };

        handle.setPointerCapture?.(event.pointerId);
        handle.dataset.dragging = "true";
        document.body.classList.add("vc-cdm-resizing");
    });

    handle.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();

        if (dragSession?.moved) return;
        toggleMode();
    });

    handle.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggleMode();
    });

    document.body.appendChild(handle);
    floatingHandle = handle;
    syncHandlePosition();
}

function onWindowPointerMove(event: PointerEvent) {
    if (!dragSession || event.pointerId !== dragSession.pointerId) return;

    const delta = event.clientX - dragSession.startX;
    if (Math.abs(delta) >= 3) dragSession.moved = true;

    const desiredWidth = dragSession.startWidth + delta;

    if (desiredWidth <= COMPACT_TRIGGER) {
        setCompact(true);
    } else {
        setCompact(false, desiredWidth);
    }
}

function finishDrag(event: PointerEvent) {
    if (!dragSession || event.pointerId !== dragSession.pointerId) return;

    floatingHandle?.releasePointerCapture?.(event.pointerId);
    if (floatingHandle) delete floatingHandle.dataset.dragging;
    document.body.classList.remove("vc-cdm-resizing");

    const moved = dragSession.moved;
    dragSession = null;

    if (moved) void persistState();
}

function cloneNativeIcon(button: HTMLButtonElement) {
    const icon = button.querySelector<SVGElement>("svg");
    if (icon) return icon.cloneNode(true);

    const fallback = document.createElement("span");
    fallback.className = "vc-cdm-control-fallback";
    fallback.textContent = "•";
    return fallback;
}

function refreshProfileButton(profileButton: HTMLButtonElement) {
    const nativeAvatarButton = getNativeAvatarButton();
    if (!nativeAvatarButton) return;

    const image = nativeAvatarButton.querySelector<HTMLImageElement>("img");
    const signature = image?.src ?? nativeAvatarButton.innerHTML;

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
    } else {
        const visual = nativeAvatarButton.firstElementChild?.cloneNode(true);
        if (visual) {
            const wrapper = document.createElement("span");
            wrapper.className = "vc-cdm-profile-clone";
            wrapper.appendChild(visual);
            profileButton.appendChild(wrapper);
        }
    }
}

function refreshControlsMenu(menu: HTMLDivElement) {
    const nativeButtons = getNativeControlButtons();
    const signature = nativeButtons.map(button =>
        `${button.getAttribute("aria-label") ?? ""}:${button.getAttribute("aria-pressed") ?? ""}:${button.innerHTML}`
    ).join("|");

    if (signature === controlsSignature && menu.childElementCount) return;
    controlsSignature = signature;

    menu.replaceChildren();

    for (const nativeButton of nativeButtons) {
        const proxy = document.createElement("button");
        const label = nativeButton.getAttribute("aria-label")
            ?? nativeButton.getAttribute("title")
            ?? "Account control";

        proxy.className = "vc-cdm-control-action";
        proxy.type = "button";
        proxy.setAttribute("aria-label", label);
        proxy.title = label;
        proxy.appendChild(cloneNativeIcon(nativeButton));

        proxy.addEventListener("click", event => {
            event.stopPropagation();
            nativeButton.click();

            window.setTimeout(() => {
                controlsSignature = "";
                refreshDock();
            }, 0);
        });

        menu.appendChild(proxy);
    }
}

function createAccountDock() {
    if (!sidebar) return;

    accountDock?.remove();

    const dock = document.createElement("div");
    dock.className = "vc-cdm-account-dock";
    dock.dataset.controlsOpen = "false";

    const profileButton = document.createElement("button");
    profileButton.className = "vc-cdm-profile-button";
    profileButton.type = "button";
    profileButton.setAttribute("aria-label", "Open profile");

    profileButton.addEventListener("click", event => {
        event.stopPropagation();
        getNativeAvatarButton()?.click();
        setControlsOpen(false);
    });

    const controlsButton = document.createElement("button");
    controlsButton.className = "vc-cdm-controls-button";
    controlsButton.type = "button";
    controlsButton.setAttribute("aria-label", "Audio and settings");
    controlsButton.setAttribute("aria-haspopup", "true");
    controlsButton.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path fill="currentColor" d="M4 7h10.2a3 3 0 1 0 0-2H4a1 1 0 0 0 0 2Zm0 6h4.2a3 3 0 1 0 0-2H4a1 1 0 1 0 0 2Zm0 6h12.2a3 3 0 1 0 0-2H4a1 1 0 1 0 0 2Z"/>
        </svg>`;

    const menu = document.createElement("div");
    menu.className = "vc-cdm-controls-menu";
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", "Audio and settings controls");

    controlsButton.addEventListener("click", event => {
        event.stopPropagation();
        setControlsOpen(!controlsOpen);

        if (controlsOpen) {
            controlsSignature = "";
            refreshControlsMenu(menu);
        }
    });

    dock.append(profileButton, controlsButton, menu);
    sidebar.appendChild(dock);

    accountDock = dock;
    avatarSignature = "";
    controlsSignature = "";

    refreshProfileButton(profileButton);
    refreshControlsMenu(menu);
}

function refreshDock() {
    if (!accountDock || !accountDock.isConnected) {
        createAccountDock();
        return;
    }

    const profileButton = accountDock.querySelector<HTMLButtonElement>(".vc-cdm-profile-button");
    const menu = accountDock.querySelector<HTMLDivElement>(".vc-cdm-controls-menu");

    if (profileButton) refreshProfileButton(profileButton);
    if (menu && controlsOpen) refreshControlsMenu(menu);
}

function detachSidebar() {
    accountDock?.remove();
    accountDock = null;
    avatarSignature = "";
    controlsSignature = "";
    controlsOpen = false;

    if (sidebar) {
        delete sidebar.dataset.vcCompactDmBar;
        delete sidebar.dataset.vcCompactDmExpanded;
        sidebar.style.removeProperty("--vc-compact-dm-width");
        clearSidebarWidth();
    }

    sidebar = null;
}

function refresh() {
    animationFrame = 0;

    const nextSidebar = document.querySelector<HTMLElement>(SIDEBAR_SELECTOR);

    if (!nextSidebar) {
        if (sidebar) detachSidebar();
        floatingHandle?.remove();
        floatingHandle = null;
        return;
    }

    if (sidebar !== nextSidebar) {
        detachSidebar();
        sidebar = nextSidebar;
        applyMode();
        createAccountDock();
        if (!floatingHandle?.isConnected) createFloatingHandle();
        return;
    }

    applyMode();
    if (!floatingHandle?.isConnected) createFloatingHandle();
    refreshDock();
}

function scheduleRefresh() {
    if (animationFrame) return;
    animationFrame = requestAnimationFrame(refresh);
}

function onDocumentPointerDown(event: PointerEvent) {
    if (!controlsOpen || !accountDock) return;
    if (event.target instanceof Node && accountDock.contains(event.target)) return;

    setControlsOpen(false);
}

export default definePlugin({
    name: "CompactDMBar",
    description: "Turns the Home/Friends direct-message sidebar into a compact, resizable icon-first rail.",
    tags: ["Appearance", "Friends"],
    authors: [{ name: "itsmeares", id: 0n }],

    async start() {
        const storedMode = await DataStore.get<boolean>(MODE_KEY);
        const storedExpandedWidth = await DataStore.get<number>(EXPANDED_WIDTH_KEY);

        compactMode = typeof storedMode === "boolean" ? storedMode : true;

        if (typeof storedExpandedWidth === "number" && Number.isFinite(storedExpandedWidth)) {
            lastExpandedWidth = clampExpandedWidth(storedExpandedWidth);
        }

        document.addEventListener("pointerdown", onDocumentPointerDown, true);
        window.addEventListener("pointermove", onWindowPointerMove, true);
        window.addEventListener("pointerup", finishDrag, true);
        window.addEventListener("pointercancel", finishDrag, true);
        window.addEventListener("resize", scheduleRefresh);

        observer = new MutationObserver(scheduleRefresh);
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        scheduleRefresh();
    },

    stop() {
        observer?.disconnect();
        observer = null;

        document.removeEventListener("pointerdown", onDocumentPointerDown, true);
        window.removeEventListener("pointermove", onWindowPointerMove, true);
        window.removeEventListener("pointerup", finishDrag, true);
        window.removeEventListener("pointercancel", finishDrag, true);
        window.removeEventListener("resize", scheduleRefresh);
        document.body.classList.remove("vc-cdm-resizing");

        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
            animationFrame = 0;
        }

        floatingHandle?.remove();
        floatingHandle = null;
        dragSession = null;
        detachSidebar();
    }
});
