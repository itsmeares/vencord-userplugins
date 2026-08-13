/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { MediaEngineStore } from "@webpack/common";

const COMPACT_WIDTH = 72;
const SIDEBAR_SELECTOR = '#app-mount [class*="sidebarList_"]:has([class*="privateChannels_"])';

const settings = definePluginSettings({
    compactMode: {
        type: OptionType.BOOLEAN,
        description: "Remember whether the direct-message sidebar is compact or default width",
        default: true,
        hidden: true
    }
});

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
let profilePopoutObserver: MutationObserver | null = null;
let profilePopoutAnimationFrame = 0;
let positionedProfilePopout: {
    element: HTMLElement;
    translate: string;
    priority: string;
} | null = null;
let hiddenNativePanels: {
    element: HTMLElement;
    display: string;
} | null = null;

function readStoredMode() {
    return settings.store.compactMode;
}

function persistMode() {
    settings.store.compactMode = compactMode;
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

    const { element, display } = hiddenNativePanels;
    if (display) element.style.setProperty("display", display);
    else element.style.removeProperty("display");
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
            display: panels.style.getPropertyValue("display")
        };
    }

    panels.style.setProperty("display", "none", "important");
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

    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = controlsMenu.getBoundingClientRect();
    controlsMenu.style.left = `${Math.round(triggerRect.right + 8)}px`;
    controlsMenu.style.top = `${Math.round(triggerRect.top + triggerRect.height / 2 - menuRect.height / 2)}px`;
    controlsMenu.style.removeProperty("bottom");
}

function setControlsOpen(open: boolean) {
    controlsOpen = open && compactMode;

    if (accountDock) accountDock.dataset.controlsOpen = String(controlsOpen);
    if (controlsMenu) controlsMenu.dataset.open = String(controlsOpen);

    if (controlsOpen) {
        refreshControlActions();
        syncControlsMenuPosition();
    }
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

function restoreProfilePopoutPosition() {
    if (!positionedProfilePopout) return;

    const { element, translate, priority } = positionedProfilePopout;
    if (element.isConnected) {
        if (translate) element.style.setProperty("translate", translate, priority);
        else element.style.removeProperty("translate");
    }

    positionedProfilePopout = null;
}

function stopProfilePopoutTracking(restorePosition = false) {
    profilePopoutObserver?.disconnect();
    profilePopoutObserver = null;

    if (profilePopoutAnimationFrame) {
        cancelAnimationFrame(profilePopoutAnimationFrame);
        profilePopoutAnimationFrame = 0;
    }

    if (restorePosition) restoreProfilePopoutPosition();
    else if (positionedProfilePopout && !positionedProfilePopout.element.isConnected) positionedProfilePopout = null;
}

function getProfilePopoutCandidate() {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>("body div")).filter(element => {
        const rect = element.getBoundingClientRect();
        if (rect.width < 280 || rect.width > 700 || rect.height < 300 || rect.height > 800) return false;

        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;

        return true;
    });

    const byArea = (a: HTMLElement, b: HTMLElement) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return aRect.width * aRect.height - bRect.width * bRect.height;
    };

    const accountTextMatch = candidates
        .filter(element => {
            const text = element.textContent ?? "";
            return text.includes("Edit Profile") && text.includes("Switch Accounts");
        })
        .sort(byArea)[0];

    if (accountTextMatch) return accountTextMatch;

    return candidates
        .filter(element => {
            const className = element.className;
            return element.getAttribute("role") === "dialog"
                || (typeof className === "string" && /(?:user|profile).*popout|popout.*(?:user|profile)/i.test(className));
        })
        .sort(byArea)[0]
        ?? null;
}

function positionProfilePopout(profileButton: HTMLButtonElement) {
    const popout = getProfilePopoutCandidate();
    if (!popout) return false;

    if (positionedProfilePopout?.element !== popout) {
        restoreProfilePopoutPosition();
        positionedProfilePopout = {
            element: popout,
            translate: popout.style.getPropertyValue("translate"),
            priority: popout.style.getPropertyPriority("translate")
        };
    }

    const originalTranslate = positionedProfilePopout.translate;
    const originalPriority = positionedProfilePopout.priority;
    if (originalTranslate) popout.style.setProperty("translate", originalTranslate, originalPriority);
    else popout.style.removeProperty("translate");

    const buttonRect = profileButton.getBoundingClientRect();
    const popoutRect = popout.getBoundingClientRect();
    const desiredLeft = Math.max(8, Math.min(buttonRect.right + 10, window.innerWidth - popoutRect.width - 8));
    const desiredTop = Math.max(8, Math.min(buttonRect.bottom - popoutRect.height, window.innerHeight - popoutRect.height - 8));

    popout.style.setProperty(
        "translate",
        `${Math.round(desiredLeft - popoutRect.left)}px ${Math.round(desiredTop - popoutRect.top)}px`,
        "important"
    );

    return true;
}

function positionProfilePopoutWhenMounted(profileButton: HTMLButtonElement) {
    stopProfilePopoutTracking(false);

    let attempts = 0;
    const attemptPosition = () => {
        profilePopoutAnimationFrame = 0;

        if (!running || !compactMode || !profileButton.isConnected) {
            profilePopoutObserver?.disconnect();
            profilePopoutObserver = null;
            return;
        }

        if (positionProfilePopout(profileButton)) {
            profilePopoutObserver?.disconnect();
            profilePopoutObserver = null;
            return;
        }

        attempts += 1;
        if (attempts >= 24) {
            profilePopoutObserver?.disconnect();
            profilePopoutObserver = null;
            return;
        }

        profilePopoutAnimationFrame = requestAnimationFrame(attemptPosition);
    };

    profilePopoutObserver = new MutationObserver(() => {
        if (!profilePopoutAnimationFrame) profilePopoutAnimationFrame = requestAnimationFrame(attemptPosition);
    });
    profilePopoutObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    profilePopoutAnimationFrame = requestAnimationFrame(attemptPosition);
}

type ControlKind = "mute" | "deafen" | "settings";

const CONTROL_LABELS: Record<ControlKind, string[]> = {
    mute: ["Mute", "Unmute"],
    deafen: ["Deafen", "Undeafen"],
    settings: ["User Settings"]
};

function getNeutralControlColor() {
    const settingsButton = getNativeControlButton("User Settings");
    return settingsButton ? getComputedStyle(settingsButton).color : null;
}

function getControlActiveState(kind: ControlKind) {
    if (kind === "settings") return false;

    const mediaSettings = MediaEngineStore?.getSettings?.();
    if (!mediaSettings) return false;

    return kind === "mute" ? !!mediaSettings.mute : !!mediaSettings.deaf;
}

function cloneNativeControlVisual(nativeButton: HTMLButtonElement, target: HTMLButtonElement) {
    const visual = nativeButton.querySelector<HTMLElement>("svg")
        ?? nativeButton.firstElementChild as HTMLElement | null;

    target.replaceChildren();

    if (visual) {
        const clone = visual.cloneNode(true) as HTMLElement;
        clone.removeAttribute("class");
        clone.classList.add("vc-cdm-native-control-icon");
        clone.setAttribute("aria-hidden", "true");
        target.appendChild(clone);
    }

    const neutralColor = getNeutralControlColor();
    if (neutralColor) target.style.setProperty("color", neutralColor, "important");
    else target.style.removeProperty("color");
}

function syncControlAction(button: HTMLButtonElement) {
    const kind = button.dataset.controlKind as ControlKind | undefined;
    if (!kind) return;

    const nativeButton = getNativeControlButton(...CONTROL_LABELS[kind]);
    if (!nativeButton) return;

    const label = nativeButton.getAttribute("aria-label") ?? CONTROL_LABELS[kind][0];
    button.title = label;
    button.setAttribute("aria-label", label);
    button.dataset.vcActive = String(getControlActiveState(kind));
    cloneNativeControlVisual(nativeButton, button);
}

function refreshControlActions() {
    if (!controlsMenu) return;

    controlsMenu.querySelectorAll<HTMLButtonElement>(".vc-cdm-control-action").forEach(syncControlAction);
}

function createControlAction(kind: ControlKind) {
    const button = document.createElement("button");
    button.className = "vc-cdm-control-action";
    button.type = "button";
    button.dataset.controlKind = kind;

    button.addEventListener("click", event => {
        event.stopPropagation();
        const nativeButton = getNativeControlButton(...CONTROL_LABELS[kind]);
        nativeButton?.click();

        if (kind === "settings") {
            setControlsOpen(false);
            return;
        }

        // Keep the compact controls open and refresh state-driven icon paint.
        window.setTimeout(() => {
            if (controlsOpen) refreshControlActions();
        }, 50);
    });

    syncControlAction(button);
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
        createControlAction("mute"),
        createControlAction("deafen"),
        createControlAction("settings")
    );

    document.body.appendChild(menu);
    controlsMenu = menu;
    refreshControlActions();
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
        event.preventDefault();
        event.stopPropagation();
        getNativeProfileButton()?.click();
        setControlsOpen(false);
        positionProfilePopoutWhenMounted(profileButton);
    });

    const controlsButton = document.createElement("button");
    controlsButton.className = "vc-cdm-controls-button";
    controlsButton.type = "button";
    controlsButton.setAttribute("aria-label", "Audio and settings");
    controlsButton.setAttribute("aria-haspopup", "true");
    controlsButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 7h10.2a3 3 0 1 0 0-2H4a1 1 0 0 0 0 2Zm0 6h4.2a3 3 0 1 0 0-2H4a1 1 0 1 0 0 2Zm0 6h12.2a3 3 0 1 0 0-2H4a1 1 0 1 0 0 2Z"/></svg>';

    const neutralColor = getNeutralControlColor();
    if (neutralColor) controlsButton.style.setProperty("color", neutralColor, "important");

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

    const controlsButton = accountDock.querySelector<HTMLButtonElement>(".vc-cdm-controls-button");
    const neutralColor = getNeutralControlColor();
    if (controlsButton && neutralColor) {
        controlsButton.style.setProperty("color", neutralColor, "important");
    }

    if (!controlsMenu?.isConnected) createControlsMenu();
    if (controlsOpen) refreshControlActions();
    syncControlsMenuPosition();
}

function detachSidebar() {
    setControlsOpen(false);
    stopProfilePopoutTracking(true);

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
    settings,

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