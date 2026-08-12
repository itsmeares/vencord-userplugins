/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import * as DataStore from "@api/DataStore";
import definePlugin from "@utils/types";

const WIDTH_KEY = "CompactDMBar_width";
const EXPANDED_WIDTH_KEY = "CompactDMBar_expandedWidth";

const COMPACT_WIDTH = 72;
const DEFAULT_EXPANDED_WIDTH = 240;
const EXPANDED_THRESHOLD = 180;
const MAX_WIDTH = 360;
const WIDTH_STEP = 16;
const DRAG_SLOP = 4;

const SIDEBAR_SELECTOR = '#app-mount [class*="sidebarList_"]:has([class*="privateChannels_"])';

let observer: MutationObserver | null = null;
let animationFrame = 0;
let sidebar: HTMLElement | null = null;
let resizeHandle: HTMLDivElement | null = null;
let accountDock: HTMLDivElement | null = null;
let currentWidth = COMPACT_WIDTH;
let lastExpandedWidth = DEFAULT_EXPANDED_WIDTH;
let controlsOpen = false;
let avatarSignature = "";
let controlsSignature = "";

function clampWidth(width: number) {
    return Math.min(MAX_WIDTH, Math.max(COMPACT_WIDTH, Math.round(width)));
}

function isExpanded(width = currentWidth) {
    return width >= EXPANDED_THRESHOLD;
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
    if (accountDock) {
        accountDock.dataset.controlsOpen = String(open);
    }
}

async function persistWidth() {
    await DataStore.set(WIDTH_KEY, currentWidth);
    await DataStore.set(EXPANDED_WIDTH_KEY, lastExpandedWidth);
}

function applyWidth(width: number, rememberExpanded = true) {
    currentWidth = clampWidth(width);

    if (rememberExpanded && isExpanded(currentWidth)) {
        lastExpandedWidth = currentWidth;
    }

    if (!sidebar) return;

    const cssWidth = `${currentWidth}px`;

    sidebar.style.setProperty("--vc-compact-dm-width", cssWidth);
    sidebar.style.setProperty("width", cssWidth, "important");
    sidebar.style.setProperty("min-width", cssWidth, "important");
    sidebar.style.setProperty("max-width", cssWidth, "important");
    sidebar.style.setProperty("flex", `0 0 ${cssWidth}`, "important");
    sidebar.dataset.vcCompactDmExpanded = String(isExpanded());
}

function applyDraggedWidth(width: number) {
    const nextWidth = clampWidth(width);

    if (nextWidth < EXPANDED_THRESHOLD) {
        applyWidth(COMPACT_WIDTH, false);
    } else {
        applyWidth(nextWidth);
    }
}

function applyPointerWidth(clientX: number, sidebarLeft: number) {
    const requestedWidth = clientX - sidebarLeft;

    if (requestedWidth < EXPANDED_THRESHOLD) {
        applyWidth(COMPACT_WIDTH, false);
    } else {
        applyWidth(requestedWidth);
    }
}

function toggleWidth() {
    if (isExpanded()) {
        applyWidth(COMPACT_WIDTH, false);
    } else {
        applyWidth(lastExpandedWidth || DEFAULT_EXPANDED_WIDTH);
    }

    void persistWidth();
}

function createResizeHandle() {
    if (!sidebar) return;

    resizeHandle?.remove();

    const handle = document.createElement("div");
    handle.className = "vc-cdm-resize-handle";
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-label", "Resize direct messages sidebar");
    handle.setAttribute("aria-orientation", "vertical");
    handle.title = "Drag to resize. Click to toggle compact mode.";
    handle.tabIndex = 0;

    const grip = document.createElement("div");
    grip.className = "vc-cdm-resize-grip";
    grip.setAttribute("aria-hidden", "true");
    grip.innerHTML = `
        <svg viewBox="0 0 20 20" width="14" height="14">
            <path fill="currentColor" d="M7.8 4.6 2.4 10l5.4 5.4 1.4-1.4L5.2 10l4-4-1.4-1.4Zm4.4 0L10.8 6l4 4-4 4 1.4 1.4 5.4-5.4-5.4-5.4Z"/>
        </svg>`;
    handle.appendChild(grip);

    handle.addEventListener("keydown", event => {
        switch (event.key) {
            case "Enter":
            case " ":
                event.preventDefault();
                toggleWidth();
                break;
            case "ArrowLeft":
                event.preventDefault();
                applyDraggedWidth(currentWidth - WIDTH_STEP);
                void persistWidth();
                break;
            case "ArrowRight":
                event.preventDefault();
                applyDraggedWidth(currentWidth + WIDTH_STEP);
                void persistWidth();
                break;
            case "Home":
                event.preventDefault();
                applyWidth(COMPACT_WIDTH, false);
                void persistWidth();
                break;
            case "End":
                event.preventDefault();
                applyWidth(lastExpandedWidth || DEFAULT_EXPANDED_WIDTH);
                void persistWidth();
                break;
        }
    });

    handle.addEventListener("pointerdown", event => {
        if (event.button !== 0 || !sidebar) return;

        event.preventDefault();
        event.stopPropagation();

        const pointerId = event.pointerId;
        const startX = event.clientX;
        const sidebarLeft = sidebar.getBoundingClientRect().left;
        let dragged = false;

        handle.dataset.dragging = "true";
        document.body.classList.add("vc-cdm-resizing");

        const onMove = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== pointerId) return;

            if (Math.abs(moveEvent.clientX - startX) >= DRAG_SLOP) {
                dragged = true;
            }

            if (!dragged) return;
            applyPointerWidth(moveEvent.clientX, sidebarLeft);
        };

        const finish = (upEvent: PointerEvent) => {
            if (upEvent.pointerId !== pointerId) return;

            window.removeEventListener("pointermove", onMove, true);
            window.removeEventListener("pointerup", finish, true);
            window.removeEventListener("pointercancel", finish, true);
            delete handle.dataset.dragging;
            document.body.classList.remove("vc-cdm-resizing");

            if (upEvent.type !== "pointercancel" && !dragged) {
                toggleWidth();
                return;
            }

            void persistWidth();
        };

        window.addEventListener("pointermove", onMove, true);
        window.addEventListener("pointerup", finish, true);
        window.addEventListener("pointercancel", finish, true);
    });

    sidebar.appendChild(handle);
    resizeHandle = handle;
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
    resizeHandle?.remove();
    accountDock?.remove();

    resizeHandle = null;
    accountDock = null;
    avatarSignature = "";
    controlsSignature = "";
    controlsOpen = false;

    if (sidebar) {
        delete sidebar.dataset.vcCompactDmBar;
        delete sidebar.dataset.vcCompactDmExpanded;
        sidebar.style.removeProperty("--vc-compact-dm-width");
        sidebar.style.removeProperty("width");
        sidebar.style.removeProperty("min-width");
        sidebar.style.removeProperty("max-width");
        sidebar.style.removeProperty("flex");
    }

    sidebar = null;
}

function refresh() {
    animationFrame = 0;

    const nextSidebar = document.querySelector<HTMLElement>(SIDEBAR_SELECTOR);

    if (!nextSidebar) {
        if (sidebar) detachSidebar();
        return;
    }

    if (sidebar !== nextSidebar) {
        detachSidebar();
        sidebar = nextSidebar;
        sidebar.dataset.vcCompactDmBar = "true";
        applyWidth(currentWidth, false);
        createResizeHandle();
        createAccountDock();
        return;
    }

    sidebar.dataset.vcCompactDmBar = "true";
    applyWidth(currentWidth, false);

    if (!resizeHandle?.isConnected) createResizeHandle();
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
        const storedWidth = await DataStore.get<number>(WIDTH_KEY);
        const storedExpandedWidth = await DataStore.get<number>(EXPANDED_WIDTH_KEY);

        if (typeof storedExpandedWidth === "number" && Number.isFinite(storedExpandedWidth)) {
            lastExpandedWidth = Math.max(EXPANDED_THRESHOLD, clampWidth(storedExpandedWidth));
        }

        if (typeof storedWidth === "number" && Number.isFinite(storedWidth)) {
            currentWidth = clampWidth(storedWidth);
            if (isExpanded(currentWidth)) {
                lastExpandedWidth = currentWidth;
            } else {
                currentWidth = COMPACT_WIDTH;
            }
        }

        document.addEventListener("pointerdown", onDocumentPointerDown, true);

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
        document.body.classList.remove("vc-cdm-resizing");

        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
            animationFrame = 0;
        }

        detachSidebar();
    }
});
