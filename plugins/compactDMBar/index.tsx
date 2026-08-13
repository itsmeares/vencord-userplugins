/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType, StartAt } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { React, SelectedGuildStore } from "@webpack/common";

const SIDEBAR_SELECTOR = '#app-mount [class*="sidebarList_"]:has([class*="privateChannels_"])';
const WIDTH_PROPERTIES = ["width", "min-width", "max-width", "flex-basis"] as const;
const NATIVE_HANDLE_SELECTOR = ':scope > [class*="sidebarResizeHandle_"]';

const AccountPanelButton = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");

const settings = definePluginSettings({
    compactMode: {
        type: OptionType.BOOLEAN,
        description: "Remember whether the direct-message sidebar is compact or default width",
        default: true,
        hidden: true
    }
});

type InlineWidthSnapshot = Record<(typeof WIDTH_PROPERTIES)[number], {
    value: string;
    priority: string;
}>;

let sidebar: HTMLElement | null = null;
let resizeHandle: HTMLElement | null = null;
let parentObserver: MutationObserver | null = null;
let animationFrame = 0;
let inlineWidth: InlineWidthSnapshot | null = null;

function ControlsIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path
                fill="currentColor"
                d="M4 7h10.2a3 3 0 1 0 0-2H4a1 1 0 0 0 0 2Zm0 6h4.2a3 3 0 1 0 0-2H4a1 1 0 1 0 0 2Zm0 6h12.2a3 3 0 1 0 0-2H4a1 1 0 1 0 0 2Z"
            />
        </svg>
    );
}

const ControlsToggleButton = ErrorBoundary.wrap(() => {
    const { compactMode } = settings.use(["compactMode"]);
    const [open, setOpen] = React.useState(false);
    const buttonRef = React.useRef<HTMLButtonElement | null>(null);

    React.useEffect(() => {
        if (!compactMode) setOpen(false);
    }, [compactMode]);

    React.useEffect(() => {
        if (!open) return;

        const closeOutside = (event: PointerEvent) => {
            if (!(event.target instanceof Node)) return;

            const button = buttonRef.current;
            const accountPanel = button?.parentElement;
            const nativeButtons = accountPanel?.querySelector<HTMLElement>(':scope > [class*="buttons_"]');

            if (button?.contains(event.target) || nativeButtons?.contains(event.target)) return;
            setOpen(false);
        };

        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };

        document.addEventListener("pointerdown", closeOutside, true);
        document.addEventListener("keydown", closeOnEscape, true);

        return () => {
            document.removeEventListener("pointerdown", closeOutside, true);
            document.removeEventListener("keydown", closeOnEscape, true);
        };
    }, [open]);

    if (!compactMode) return null;

    return (
        <AccountPanelButton
            ref={buttonRef}
            className={`vc-cdm-controls-toggle${open ? " vc-cdm-controls-open" : ""}`}
            tooltipText="Audio and settings"
            icon={ControlsIcon}
            ariaExpanded={open}
            onClick={() => setOpen(value => !value)}
        />
    );
}, { noop: true });

function snapshotInlineWidth(element: HTMLElement): InlineWidthSnapshot {
    return Object.fromEntries(WIDTH_PROPERTIES.map(property => [
        property,
        {
            value: element.style.getPropertyValue(property),
            priority: element.style.getPropertyPriority(property)
        }
    ])) as InlineWidthSnapshot;
}

function clearInlineWidth(element: HTMLElement) {
    for (const property of WIDTH_PROPERTIES) {
        element.style.removeProperty(property);
    }

    // Removed by older CompactDMBar builds.
    element.style.removeProperty("--vc-compact-dm-width");
}

function restoreInlineWidth(element: HTMLElement) {
    if (!inlineWidth) return;

    for (const property of WIDTH_PROPERTIES) {
        const { value, priority } = inlineWidth[property];

        if (value) element.style.setProperty(property, value, priority);
        else element.style.removeProperty(property);
    }

    inlineWidth = null;
}

function applyMode() {
    if (!sidebar) return;

    if (settings.store.compactMode) {
        if (!inlineWidth) inlineWidth = snapshotInlineWidth(sidebar);
        clearInlineWidth(sidebar);
        sidebar.dataset.vcCdmState = "compact";
    } else {
        delete sidebar.dataset.vcCdmState;
        restoreInlineWidth(sidebar);
    }
}

function toggleMode() {
    settings.store.compactMode = !settings.store.compactMode;
    applyMode();
}

function onHandleDoubleClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    toggleMode();
}

function blockCompactResize(event: Event) {
    if (!settings.store.compactMode) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
}

function onHandleKeyDown(event: KeyboardEvent) {
    if (!settings.store.compactMode) return;

    if (event.key === "Enter" || event.key === " ") {
        blockCompactResize(event);
        toggleMode();
        return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") {
        blockCompactResize(event);
    }
}

function unbindResizeHandle() {
    if (!resizeHandle) return;

    resizeHandle.removeEventListener("dblclick", onHandleDoubleClick);
    resizeHandle.removeEventListener("mousedown", blockCompactResize, true);
    resizeHandle.removeEventListener("click", blockCompactResize, true);
    resizeHandle.removeEventListener("keydown", onHandleKeyDown, true);
    resizeHandle = null;
}

function bindResizeHandle(next: HTMLElement | null) {
    if (resizeHandle === next) return;

    unbindResizeHandle();
    resizeHandle = next;
    if (!resizeHandle) return;

    // Leave Discord's native resize handle and styling intact. Compact mode only
    // blocks its resize interaction; default mode remains fully native.
    resizeHandle.addEventListener("dblclick", onHandleDoubleClick);
    resizeHandle.addEventListener("mousedown", blockCompactResize, true);
    resizeHandle.addEventListener("click", blockCompactResize, true);
    resizeHandle.addEventListener("keydown", onHandleKeyDown, true);
}

function disconnectParentObserver() {
    parentObserver?.disconnect();
    parentObserver = null;
}

function observeSidebarParent() {
    disconnectParentObserver();

    const parent = sidebar?.parentElement;
    if (!parent) return;

    parentObserver = new MutationObserver(() => {
        if (!sidebar?.isConnected || !resizeHandle?.isConnected) scheduleReconcile();
    });

    parentObserver.observe(parent, {
        childList: true,
        subtree: true
    });
}

function detachSidebar() {
    disconnectParentObserver();
    unbindResizeHandle();

    if (sidebar) {
        delete sidebar.dataset.vcCdmState;
        restoreInlineWidth(sidebar);
    }

    sidebar = null;
    inlineWidth = null;
}

function cleanupLegacyRuntime() {
    document.querySelector(".vc-cdm-toggle-edge")?.remove();
    document.querySelector(".vc-cdm-account-dock")?.remove();
    document.querySelector(".vc-cdm-controls-menu")?.remove();

    const legacySidebar = document.querySelector<HTMLElement>('[data-vc-compact-dm-bar="true"]');
    if (legacySidebar) {
        delete legacySidebar.dataset.vcCompactDmBar;
        delete legacySidebar.dataset.vcCompactDmExpanded;
        legacySidebar.style.removeProperty("--vc-compact-dm-width");

        for (const property of WIDTH_PROPERTIES) {
            if (
                legacySidebar.style.getPropertyPriority(property) === "important"
                && legacySidebar.style.getPropertyValue(property) === "72px"
            ) {
                legacySidebar.style.removeProperty(property);
            }
        }
    }

    const parent = legacySidebar?.parentElement;
    const legacyHandle = parent?.querySelector<HTMLElement>(NATIVE_HANDLE_SELECTOR);
    const legacyPanels = parent?.querySelector<HTMLElement>(':scope > [class*="panels_"]');

    legacyHandle?.style.removeProperty("pointer-events");
    legacyHandle?.style.removeProperty("opacity");
    legacyPanels?.style.removeProperty("display");
}

function reconcile() {
    animationFrame = 0;

    const nextSidebar = document.querySelector<HTMLElement>(SIDEBAR_SELECTOR);
    if (!nextSidebar) {
        detachSidebar();
        return;
    }

    if (sidebar !== nextSidebar) {
        detachSidebar();
        sidebar = nextSidebar;
    }

    const nextHandle = sidebar.parentElement?.querySelector<HTMLElement>(NATIVE_HANDLE_SELECTOR) ?? null;
    bindResizeHandle(nextHandle);
    applyMode();
    observeSidebarParent();
}

function scheduleReconcile() {
    if (animationFrame) return;
    animationFrame = requestAnimationFrame(reconcile);
}

export default definePlugin({
    name: "CompactDMBar",
    description: "Toggles the Home/Friends direct-message sidebar between Discord's default layout and a compact icon-only rail.",
    tags: ["Appearance", "Friends"],
    authors: [{ name: "itsmeares", id: 0n }],
    settings,

    patches: [
        {
            find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
            replacement: {
                match: /children:\[(?=.{0,25}?accountContainerRef)/,
                replace: "children:[$self.ControlsToggleButton(),"
            }
        }
    ],

    ControlsToggleButton,

    startAt: StartAt.WebpackReady,

    start() {
        cleanupLegacyRuntime();
        SelectedGuildStore.addChangeListener(scheduleReconcile);
        scheduleReconcile();
    },

    stop() {
        SelectedGuildStore.removeChangeListener(scheduleReconcile);

        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
            animationFrame = 0;
        }

        detachSidebar();
    }
});