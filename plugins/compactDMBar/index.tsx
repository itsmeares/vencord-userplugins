/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { getIntlMessage } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { React, SelectedGuildStore, useStateFromStores } from "@webpack/common";

const SIDEBAR_SELECTOR = '#app-mount [class*="sidebarList_"]:has([class*="privateChannels_"])';
const GLOBAL_RESIZE_HANDLE_SELECTOR = '#app-mount [class*="sidebarResizeHandle_"]';
const WIDTH_PROPERTIES = ["width", "min-width", "max-width", "flex-basis"] as const;
const NATIVE_HANDLE_SELECTOR = ':scope > [class*="sidebarResizeHandle_"]';
const SIDEBAR_WIDTH_TOKEN = "--custom-guild-sidebar-width";
const COMPACT_WIDTH_TOKEN = "--vc-cdm-width";
const NATIVE_OVERDRAG_TOKEN = "--custom-overdrag";
const HOME_NORMAL_MIN_CONTENT_WIDTH = 200;
const HOME_NORMAL_MAX_CONTENT_WIDTH = 400;
const MIN_PAGE_REMAINDER = 320;
const MODE_SNAP_THRESHOLD = 24;
const WIDTH_EPSILON = 0.5;

const AccountPanelButton = findComponentByCodeLazy(".GREEN,positionKeyStemOverride:");

const settings = definePluginSettings({
    compactMode: {
        type: OptionType.BOOLEAN,
        description: "Remember whether the direct-message sidebar is compact or default width",
        default: true,
        hidden: true
    },
    homeWidth: {
        type: OptionType.NUMBER,
        description: "Remember the Home/Friends sidebar width independently",
        default: 0,
        hidden: true
    },
    guildWidth: {
        type: OptionType.NUMBER,
        description: "Remember the guild channel sidebar width independently",
        default: 0,
        hidden: true
    }
});

type SidebarRoute = "home" | "guild";
type WidthTokenMode = "total" | "content";

interface RouteResizeGesture {
    pointerId: number;
    root: HTMLElement;
    scope: HTMLElement;
    railWidth: number;
    tokenMode: WidthTokenMode;
    startTokenWidth: number;
    lastTokenWidth: number;
}

interface HomeResizeGesture {
    pointerId: number;
    startX: number;
    startCompact: boolean;
    startNormalTokenWidth: number;
    lastNormalTokenWidth: number;
    root: HTMLElement;
    scope: HTMLElement;
    tokenMode: WidthTokenMode;
}

interface StyleSnapshot {
    element: HTMLElement;
    properties: Record<string, { value: string; priority: string; }>;
}

let sidebar: HTMLElement | null = null;
let sidebarRoot: HTMLElement | null = null;
let resizeHandle: HTMLElement | null = null;
let parentObserver: MutationObserver | null = null;
let inlineWidth: StyleSnapshot | null = null;
let homeResizeGesture: HomeResizeGesture | null = null;
let reconcileFrame: number | null = null;

let widthScope: HTMLElement | null = null;
let widthRoot: HTMLElement | null = null;
let widthRoute: SidebarRoute | null = null;
let widthTokenSnapshot: StyleSnapshot | null = null;
let widthTokenMode: WidthTokenMode | null = null;
let rootStyleSnapshot: StyleSnapshot | null = null;
let routeResizeGesture: RouteResizeGesture | null = null;
let routeResizeObserver: MutationObserver | null = null;

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
    const selectedGuildId = useStateFromStores([SelectedGuildStore], () => SelectedGuildStore.getGuildId());
    const [open, setOpen] = React.useState(false);
    const buttonRef = React.useRef<HTMLButtonElement | null>(null);

    React.useEffect(() => {
        if (!compactMode || selectedGuildId != null) setOpen(false);
    }, [compactMode, selectedGuildId]);

    React.useEffect(() => {
        if (!open) return;

        const nativeButtons = buttonRef.current?.parentElement;
        const panels = nativeButtons?.closest<HTMLElement>('[class*="panels_"]');

        const closeOutside = (event: PointerEvent) => {
            if (!(event.target instanceof Node)) return;

            const voicePanel = panels?.querySelector<HTMLElement>(
                ':scope > [class*="wrapper_"]:has([class*="connection_"])'
            );
            const activityPanel = panels?.querySelector<HTMLElement>(
                ':scope > [class*="activityPanel_"]'
            );

            if (
                nativeButtons?.contains(event.target)
                || voicePanel?.contains(event.target)
                || activityPanel?.contains(event.target)
            ) {
                return;
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

    if (!compactMode || selectedGuildId != null) return null;

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

function currentRoute(): SidebarRoute {
    return SelectedGuildStore.getGuildId() == null ? "home" : "guild";
}

function storedRouteWidth(route: SidebarRoute) {
    return route === "home" ? settings.store.homeWidth : settings.store.guildWidth;
}

function setStoredRouteWidth(route: SidebarRoute, width: number) {
    if (!Number.isFinite(width) || width <= 0) return;

    if (route === "home") settings.store.homeWidth = width;
    else settings.store.guildWidth = width;
}

function snapshotStyles(element: HTMLElement, properties: readonly string[]): StyleSnapshot {
    return {
        element,
        properties: Object.fromEntries(properties.map(property => [property, {
            value: element.style.getPropertyValue(property),
            priority: element.style.getPropertyPriority(property)
        }]))
    };
}

function restoreStyles(snapshot: StyleSnapshot | null) {
    if (!snapshot) return;

    for (const [property, { value, priority }] of Object.entries(snapshot.properties)) {
        if (value) snapshot.element.style.setProperty(property, value, priority);
        else snapshot.element.style.removeProperty(property);
    }
}

function clearInlineWidth(element: HTMLElement) {
    for (const property of WIDTH_PROPERTIES) element.style.removeProperty(property);
}

function restoreInlineWidth() {
    if (!inlineWidth) return;
    restoreStyles(inlineWidth);
    inlineWidth = null;
}

function restoreWidthTokenBaseline() {
    restoreStyles(widthTokenSnapshot);
}

function restoreRootStyleBaseline() {
    restoreStyles(rootStyleSnapshot);
    rootStyleSnapshot = null;
}

function disconnectRouteResizeObserver() {
    routeResizeObserver?.disconnect();
    routeResizeObserver = null;
}

function clearRouteResizeGesture() {
    disconnectRouteResizeObserver();
    routeResizeGesture = null;
    document.removeEventListener("pointerup", onRouteResizePointerUp, true);
    document.removeEventListener("pointercancel", onRouteResizePointerCancel, true);
}

function detachWidthScope() {
    clearRouteResizeGesture();
    restoreWidthTokenBaseline();
    restoreRootStyleBaseline();
    widthScope = null;
    widthRoot = null;
    widthRoute = null;
    widthTokenSnapshot = null;
    widthTokenMode = null;
}

function attachWidthScope(scope: HTMLElement, root: HTMLElement) {
    if (widthScope !== scope) {
        detachWidthScope();
        widthScope = scope;
        widthTokenSnapshot = snapshotStyles(scope, [SIDEBAR_WIDTH_TOKEN]);
    }

    if (widthRoot === root) return;

    if (routeResizeGesture) clearRouteResizeGesture();

    restoreRootStyleBaseline();
    widthRoot = root;
    rootStyleSnapshot = snapshotStyles(root, ["width", NATIVE_OVERDRAG_TOKEN]);

    if (!widthTokenMode) widthTokenMode = detectWidthTokenMode(scope, root);
}

function compactSidebarWidth() {
    const width = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(COMPACT_WIDTH_TOKEN)
    );
    return Number.isFinite(width) && width > 0 ? width : 72;
}

function directSidebarList(root: HTMLElement) {
    return root.querySelector<HTMLElement>(':scope > [class*="sidebarList_"]');
}

function railWidthForRoot(root: HTMLElement) {
    const list = directSidebarList(root);
    if (list) {
        const offset = list.getBoundingClientRect().left - root.getBoundingClientRect().left;
        if (Number.isFinite(offset) && offset >= 0) return offset;
    }

    const semanticRailWidth = Number.parseFloat(
        getComputedStyle(root).getPropertyValue("--custom-guild-list-width")
    );
    return Number.isFinite(semanticRailWidth) && semanticRailWidth >= 0
        ? semanticRailWidth
        : 64;
}

function readWidthToken(scope: HTMLElement) {
    const width = Number.parseFloat(
        getComputedStyle(scope).getPropertyValue(SIDEBAR_WIDTH_TOKEN)
    );
    return Number.isFinite(width) && width > 0 ? width : 0;
}

function detectWidthTokenMode(scope: HTMLElement, root: HTMLElement): WidthTokenMode {
    const tokenWidth = readWidthToken(scope);
    const rootWidth = root.getBoundingClientRect().width;
    const contentWidth = directSidebarList(root)?.getBoundingClientRect().width ?? 0;

    if (!(tokenWidth > 0) || !(rootWidth > 0) || !(contentWidth > 0)) return "total";

    return Math.abs(tokenWidth - rootWidth) <= Math.abs(tokenWidth - contentWidth)
        ? "total"
        : "content";
}

function readRouteWidth(scope: HTMLElement, root: HTMLElement, mode: WidthTokenMode) {
    const tokenWidth = readWidthToken(scope);
    if (tokenWidth > 0) return tokenWidth;

    const rootWidth = root.getBoundingClientRect().width;
    return mode === "total"
        ? rootWidth
        : Math.max(0, rootWidth - railWidthForRoot(root));
}

function contentWidthToTokenWidth(root: HTMLElement, width: number, mode: WidthTokenMode) {
    return mode === "total" ? railWidthForRoot(root) + width : width;
}

function writeWidthToken(scope: HTMLElement, width: number) {
    const current = Number.parseFloat(scope.style.getPropertyValue(SIDEBAR_WIDTH_TOKEN));
    if (!Number.isFinite(current) || Math.abs(current - width) >= WIDTH_EPSILON) {
        scope.style.setProperty(SIDEBAR_WIDTH_TOKEN, `${width}px`);
    }
}

function nativeTotalToTokenWidth(totalWidth: number, railWidth: number, mode: WidthTokenMode) {
    return mode === "total" ? totalWidth : totalWidth - railWidth;
}

function syncNativeRootWidth(root: HTMLElement, width: number, mode: WidthTokenMode) {
    const totalWidth = mode === "total" ? width : railWidthForRoot(root) + width;
    const current = Number.parseFloat(root.style.width);

    if (!Number.isFinite(current) || Math.abs(current - totalWidth) >= WIDTH_EPSILON) {
        root.style.width = `${totalWidth}px`;
    }

    if (root.style.getPropertyValue(NATIVE_OVERDRAG_TOKEN) !== "0px") {
        root.style.setProperty(NATIVE_OVERDRAG_TOKEN, "0px");
    }
}

function applyRouteWidth() {
    if (!widthScope || !widthRoot || !widthRoute) return;

    const mode = widthTokenMode ?? detectWidthTokenMode(widthScope, widthRoot);
    widthTokenMode = mode;

    const compact = widthRoute === "home" && settings.store.compactMode;
    let width = compact
        ? contentWidthToTokenWidth(widthRoot, compactSidebarWidth(), mode)
        : storedRouteWidth(widthRoute);

    if (!(storedRouteWidth(widthRoute) > 0)) {
        restoreWidthTokenBaseline();
        const normalWidth = readRouteWidth(widthScope, widthRoot, mode);
        if (normalWidth > 0) setStoredRouteWidth(widthRoute, normalWidth);
        if (!compact) width = normalWidth;
    }

    if (!(width > 0)) return;

    if (!compact && widthRoute === "home") {
        const clampedWidth = clampHomeNormalTokenWidth(widthScope, widthRoot, mode, width);
        if (Math.abs(clampedWidth - width) >= WIDTH_EPSILON) {
            width = clampedWidth;
            setStoredRouteWidth("home", width);
        }
    }

    writeWidthToken(widthScope, width);

    if (!routeResizeGesture || routeResizeGesture.root !== widthRoot) {
        syncNativeRootWidth(widthRoot, width, mode);
    }
}

function layoutForHandle(handle: HTMLElement) {
    const root = handle.parentElement;
    const content = root?.parentElement;
    const scope = content?.parentElement;

    if (!(root instanceof HTMLElement) || !(scope instanceof HTMLElement)) return null;
    return { root, scope };
}

function clampHomeNormalTokenWidth(
    scope: HTMLElement,
    root: HTMLElement,
    mode: WidthTokenMode,
    width: number
) {
    const minWidth = contentWidthToTokenWidth(root, HOME_NORMAL_MIN_CONTENT_WIDTH, mode);
    const maxContentWidth = Math.max(
        HOME_NORMAL_MIN_CONTENT_WIDTH,
        Math.min(
            HOME_NORMAL_MAX_CONTENT_WIDTH,
            scope.getBoundingClientRect().width - railWidthForRoot(root) - MIN_PAGE_REMAINDER
        )
    );
    const maxWidth = contentWidthToTokenWidth(root, maxContentWidth, mode);
    return Math.min(maxWidth, Math.max(minWidth, width));
}

function mirrorNativeResize() {
    const gesture = routeResizeGesture;
    if (!gesture || currentRoute() !== "guild") return;

    const nativeTotalWidth = Number.parseFloat(gesture.root.style.width);
    const tokenWidth = nativeTotalWidth > 0
        ? nativeTotalToTokenWidth(nativeTotalWidth, gesture.railWidth, gesture.tokenMode)
        : gesture.lastTokenWidth;
    if (!(tokenWidth > 0)) return;
    if (Math.abs(tokenWidth - gesture.lastTokenWidth) < WIDTH_EPSILON) return;

    gesture.lastTokenWidth = tokenWidth;

    if (
        widthScope === gesture.scope
        && widthRoot === gesture.root
        && widthRoute === "guild"
    ) {
        writeWidthToken(gesture.scope, tokenWidth);
    }
}

function reconcileRouteWidth() {
    const handle = Array.from(document.querySelectorAll<HTMLElement>(GLOBAL_RESIZE_HANDLE_SELECTOR))
        .find(handle => handle.getClientRects().length > 0) ?? null;
    const layout = handle ? layoutForHandle(handle) : null;
    if (!layout) return;

    const route = currentRoute();
    if (routeResizeGesture && route !== "guild") clearRouteResizeGesture();

    attachWidthScope(layout.scope, layout.root);
    widthRoute = route;
    applyRouteWidth();
}

function onRouteResizePointerDown(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary) return;

    const handle = event.target instanceof Element
        ? event.target.closest<HTMLElement>(GLOBAL_RESIZE_HANDLE_SELECTOR)
        : null;
    if (!handle || handle.getClientRects().length === 0) return;

    const route = currentRoute();
    if (route === "home") return;

    const layout = layoutForHandle(handle);
    if (!layout) return;

    attachWidthScope(layout.scope, layout.root);
    widthRoute = route;
    clearRouteResizeGesture();

    const tokenMode = widthTokenMode ?? detectWidthTokenMode(layout.scope, layout.root);
    widthTokenMode = tokenMode;
    const railWidth = railWidthForRoot(layout.root);
    const renderedTotalWidth = layout.root.getBoundingClientRect().width;
    const renderedTokenWidth = nativeTotalToTokenWidth(renderedTotalWidth, railWidth, tokenMode);
    const startTokenWidth = renderedTokenWidth > 0
        ? renderedTokenWidth
        : readRouteWidth(layout.scope, layout.root, tokenMode);

    routeResizeGesture = {
        pointerId: event.pointerId,
        root: layout.root,
        scope: layout.scope,
        railWidth,
        tokenMode,
        startTokenWidth,
        lastTokenWidth: startTokenWidth
    };

    disconnectRouteResizeObserver();
    routeResizeObserver = new MutationObserver(mirrorNativeResize);
    routeResizeObserver.observe(layout.root, { attributes: true, attributeFilter: ["style"] });
    document.addEventListener("pointerup", onRouteResizePointerUp, true);
    document.addEventListener("pointercancel", onRouteResizePointerCancel, true);
}

function onRouteResizePointerUp(event: PointerEvent) {
    const gesture = routeResizeGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;

    queueMicrotask(() => {
        if (routeResizeGesture !== gesture) return;

        mirrorNativeResize();
        setStoredRouteWidth("guild", gesture.lastTokenWidth);
        clearRouteResizeGesture();

        if (widthRoute === "guild" && currentRoute() === "guild") {
            applyRouteWidth();
            scheduleReconcile();
        }
    });
}

function onRouteResizePointerCancel(event: PointerEvent) {
    const gesture = routeResizeGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;

    queueMicrotask(() => {
        if (routeResizeGesture !== gesture) return;

        setStoredRouteWidth("guild", gesture.startTokenWidth);
        clearRouteResizeGesture();

        if (widthRoute === "guild" && currentRoute() === "guild") {
            applyRouteWidth();
        }
    });
}

function applyMode() {
    if (!sidebar) return;

    if (settings.store.compactMode) {
        if (!inlineWidth) inlineWidth = snapshotStyles(sidebar, WIDTH_PROPERTIES);
        clearInlineWidth(sidebar);
        sidebar.dataset.vcCdmState = "compact";
    } else {
        delete sidebar.dataset.vcCdmState;
        restoreInlineWidth();
    }
}

function setMode(compact: boolean) {
    if (SelectedGuildStore.getGuildId() != null || settings.store.compactMode === compact) return;

    clearHomeResizeGesture();
    if (compact) clearRouteResizeGesture();

    settings.store.compactMode = compact;
    applyMode();
    applyRouteWidth();
    scheduleReconcile();
}

function clearHomeResizeGesture() {
    homeResizeGesture = null;
    document.removeEventListener("pointermove", onHandlePointerMove, true);
    document.removeEventListener("pointerup", onHandlePointerUp, true);
    document.removeEventListener("pointercancel", onHandlePointerCancel, true);
}

function renderHomeResize(gesture: HomeResizeGesture, compact: boolean, normalWidth: number) {
    if (settings.store.compactMode !== compact) {
        settings.store.compactMode = compact;
        applyMode();
    }

    const width = compact
        ? contentWidthToTokenWidth(gesture.root, compactSidebarWidth(), gesture.tokenMode)
        : normalWidth;
    writeWidthToken(gesture.scope, width);
    syncNativeRootWidth(gesture.root, width, gesture.tokenMode);
}

function updateHomeResize(gesture: HomeResizeGesture, clientX: number) {
    const delta = clientX - gesture.startX;
    const minWidth = contentWidthToTokenWidth(
        gesture.root,
        HOME_NORMAL_MIN_CONTENT_WIDTH,
        gesture.tokenMode
    );

    if (gesture.startCompact && delta < MODE_SNAP_THRESHOLD) {
        renderHomeResize(gesture, true, gesture.lastNormalTokenWidth);
        return;
    }

    const rawWidth = gesture.startCompact
        ? gesture.startNormalTokenWidth + delta - MODE_SNAP_THRESHOLD
        : gesture.startNormalTokenWidth + delta;
    if (!gesture.startCompact && rawWidth < minWidth - MODE_SNAP_THRESHOLD) {
        gesture.lastNormalTokenWidth = minWidth;
        renderHomeResize(gesture, true, minWidth);
        return;
    }

    gesture.lastNormalTokenWidth = clampHomeNormalTokenWidth(
        gesture.scope,
        gesture.root,
        gesture.tokenMode,
        rawWidth
    );
    renderHomeResize(gesture, false, gesture.lastNormalTokenWidth);
}

function onHandlePointerDown(event: PointerEvent) {
    if (
        event.button !== 0
        || !event.isPrimary
        || !sidebar
        || SelectedGuildStore.getGuildId() != null
    ) {
        return;
    }

    const handle = event.currentTarget instanceof HTMLElement ? event.currentTarget : resizeHandle;
    const layout = handle ? layoutForHandle(handle) : null;
    if (!layout) return;

    attachWidthScope(layout.scope, layout.root);
    widthRoute = "home";
    clearRouteResizeGesture();

    const tokenMode = widthTokenMode ?? detectWidthTokenMode(layout.scope, layout.root);
    widthTokenMode = tokenMode;
    const minWidth = contentWidthToTokenWidth(layout.root, HOME_NORMAL_MIN_CONTENT_WIDTH, tokenMode);
    const renderedWidth = readRouteWidth(layout.scope, layout.root, tokenMode);
    const storedWidth = storedRouteWidth("home");
    const startNormalTokenWidth = clampHomeNormalTokenWidth(
        layout.scope,
        layout.root,
        tokenMode,
        settings.store.compactMode ? storedWidth || minWidth : renderedWidth
    );

    homeResizeGesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startCompact: settings.store.compactMode,
        startNormalTokenWidth,
        lastNormalTokenWidth: startNormalTokenWidth,
        root: layout.root,
        scope: layout.scope,
        tokenMode
    };

    document.addEventListener("pointermove", onHandlePointerMove, true);
    document.addEventListener("pointerup", onHandlePointerUp, true);
    document.addEventListener("pointercancel", onHandlePointerCancel, true);
    event.stopPropagation();
}

function onHandleMouseDown(event: MouseEvent) {
    if (event.button === 0) event.stopPropagation();
}

function onHandlePointerMove(event: PointerEvent) {
    const gesture = homeResizeGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;

    updateHomeResize(gesture, event.clientX);
}

function onHandlePointerUp(event: PointerEvent) {
    const gesture = homeResizeGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;

    updateHomeResize(gesture, event.clientX);
    setStoredRouteWidth("home", gesture.lastNormalTokenWidth);
    clearHomeResizeGesture();
    applyRouteWidth();
    scheduleReconcile();
}

function onHandlePointerCancel(event: PointerEvent) {
    const gesture = homeResizeGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;

    settings.store.compactMode = gesture.startCompact;
    setStoredRouteWidth("home", gesture.startNormalTokenWidth);
    clearHomeResizeGesture();
    applyMode();
    applyRouteWidth();
}

function onHandleDoubleClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setMode(!settings.store.compactMode);
}

function unbindResizeHandle() {
    clearHomeResizeGesture();
    if (!resizeHandle) return;

    resizeHandle.removeEventListener("pointerdown", onHandlePointerDown, true);
    resizeHandle.removeEventListener("mousedown", onHandleMouseDown, true);
    resizeHandle.removeEventListener("dblclick", onHandleDoubleClick);
    resizeHandle = null;
}

function bindResizeHandle(next: HTMLElement | null) {
    if (resizeHandle === next) return;

    unbindResizeHandle();
    resizeHandle = next;
    resizeHandle?.addEventListener("pointerdown", onHandlePointerDown, true);
    resizeHandle?.addEventListener("mousedown", onHandleMouseDown, true);
    resizeHandle?.addEventListener("dblclick", onHandleDoubleClick);
}

function disconnectParentObserver() {
    parentObserver?.disconnect();
    parentObserver = null;
}

function observeSidebarParent() {
    if (!sidebarRoot || parentObserver) return;

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
        restoreInlineWidth();
    }

    sidebar = null;
    sidebarRoot = null;
    inlineWidth = null;
}

function reconcile() {
    reconcileRouteWidth();

    if (SelectedGuildStore.getGuildId() != null) {
        detachSidebar();
        return;
    }

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
    applyRouteWidth();
    observeSidebarParent();
}

function scheduleReconcile() {
    reconcile();

    if (reconcileFrame != null) cancelAnimationFrame(reconcileFrame);
    reconcileFrame = requestAnimationFrame(() => {
        reconcileFrame = null;
        reconcile();
    });
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
            noWarn: true,
            replacement: [
                {
                    match: /(?<=\.GameActivityToggleButton\(arguments\[0\]\),)/,
                    replace: "$self.ControlsToggleButton(arguments[0]),"
                },
                {
                    match: /children:\[(?=.{0,25}?accountContainerRef)/,
                    replace: "children:[$self.ControlsToggleButton(arguments[0]),"
                }
            ]
        }
    ],

    ControlsToggleButton,

    start() {
        document.addEventListener("pointerdown", onRouteResizePointerDown, true);
        SelectedGuildStore.addChangeListener(scheduleReconcile);
        scheduleReconcile();
    },

    stop() {
        document.removeEventListener("pointerdown", onRouteResizePointerDown, true);
        SelectedGuildStore.removeChangeListener(scheduleReconcile);

        if (reconcileFrame != null) {
            cancelAnimationFrame(reconcileFrame);
            reconcileFrame = null;
        }

        clearRouteResizeGesture();
        detachSidebar();
        detachWidthScope();
    }
});
