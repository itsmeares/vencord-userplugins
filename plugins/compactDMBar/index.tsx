/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { getIntlMessage } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
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
let sidebarRoot: HTMLElement | null = null;
let resizeHandle: HTMLElement | null = null;
let parentObserver: MutationObserver | null = null;
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

const ControlsToggleButton = ErrorBoundary.wrap((props: { nameplate?: any; }) => {
    const { compactMode } = settings.use(["compactMode"]);
    const [open, setOpen] = React.useState(false);
    const buttonRef = React.useRef<HTMLButtonElement | null>(null);

    React.useEffect(() => {
        if (!compactMode) setOpen(false);
    }, [compactMode]);

    React.useEffect(() => {
        if (!open) return;

        const nativeButtons = buttonRef.current?.parentElement;
        const nativePanels = nativeButtons?.closest<HTMLElement>('[class*="panels_"]');

        const closeOutside = (event: PointerEvent) => {
            if (!(event.target instanceof Node)) return;
            if (nativeButtons?.contains(event.target)) return;

            const target = event.target instanceof Element ? event.target : event.target.parentElement;
            if (target && nativePanels?.contains(target)) {
                const voicePanel = target.closest('[class*="wrapper_"]');
                const activityPanel = target.closest('[class*="activityPanel_"]');

                if (
                    activityPanel
                    || (voicePanel && voicePanel.querySelector('[class*="connection_"]'))
                ) {
                    return;
                }
            }

            setOpen(false);
        };

        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false);
        };

        const closeAfterSettings = (event: MouseEvent) => {
            if (!(event.target instanceof Element)) return;

            const clickedButton = event.target.closest("button");
            if (
                clickedButton
                && clickedButton !== buttonRef.current
                && clickedButton.getAttribute("aria-label") === getIntlMessage("USER_SETTINGS")
            ) {
                setOpen(false);
            }
        };

        document.addEventListener("pointerdown", closeOutside, true);
        document.addEventListener("keydown", closeOnEscape, true);
        nativeButtons?.addEventListener("click", closeAfterSettings);

        return () => {
            document.removeEventListener("pointerdown", closeOutside, true);
            document.removeEventListener("keydown", closeOnEscape, true);
            nativeButtons?.removeEventListener("click", closeAfterSettings);
        };
    }, [open]);

    if (!compactMode) return null;

    return (
        <AccountPanelButton
            ref={buttonRef}
            className={`vc-cdm-controls-toggle${open ? " vc-cdm-controls-open" : ""}`}
            tooltipText="Audio and settings"
            icon={ControlsIcon}
            plated={props?.nameplate != null}
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
    for (const property of WIDTH_PROPERTIES) element.style.removeProperty(property);
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

function unbindResizeHandle() {
    if (!resizeHandle) return;
    resizeHandle.removeEventListener("dblclick", onHandleDoubleClick);
    resizeHandle = null;
}

function bindResizeHandle(next: HTMLElement | null) {
    if (resizeHandle === next) return;

    unbindResizeHandle();
    resizeHandle = next;
    resizeHandle?.addEventListener("dblclick", onHandleDoubleClick);
}

function disconnectParentObserver() {
    parentObserver?.disconnect();
    parentObserver = null;
}

function observeSidebarParent() {
    disconnectParentObserver();
    if (!sidebarRoot) return;

    parentObserver = new MutationObserver(() => {
        if (!sidebar?.isConnected || !resizeHandle?.isConnected) reconcile();
    });

    parentObserver.observe(sidebarRoot, { childList: true });
}

function detachSidebar() {
    disconnectParentObserver();
    unbindResizeHandle();

    if (sidebar) {
        delete sidebar.dataset.vcCdmState;
        restoreInlineWidth(sidebar);
    }

    sidebar = null;
    sidebarRoot = null;
    inlineWidth = null;
}

function reconcile() {
    const nextSidebar = document.querySelector<HTMLElement>(SIDEBAR_SELECTOR);
    if (!nextSidebar) {
        detachSidebar();
        return;
    }

    if (sidebar !== nextSidebar) {
        detachSidebar();
        sidebar = nextSidebar;
        sidebarRoot = nextSidebar.parentElement;
    }

    bindResizeHandle(sidebarRoot?.querySelector<HTMLElement>(NATIVE_HANDLE_SELECTOR) ?? null);
    applyMode();
    observeSidebarParent();
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
                replace: "children:[$self.ControlsToggleButton(arguments[0]),"
            }
        }
    ],

    ControlsToggleButton,

    start() {
        SelectedGuildStore.addChangeListener(reconcile);
        reconcile();
    },

    stop() {
        SelectedGuildStore.removeChangeListener(reconcile);
        detachSidebar();
    }
});