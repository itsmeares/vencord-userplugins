# CompactDMBar

Compacts Discord's Home/Friends direct-message sidebar into a server-list-style rail while leaving guild channel sidebars alone.

## Behaviour

- compact width is 72 px, with 40 px DM avatars centered inside 56 px rows;
- search is replaced visually by a magnifying-glass icon while preserving Discord's native search click target;
- top Home navigation entries and DM rows become icon/avatar-only in compact mode;
- the Direct Messages heading, row text/details, close buttons and scrollbar are hidden in compact mode;
- the bottom account area becomes two compact controls: a profile/avatar button and an expandable audio/settings button that proxies Discord's native controls;
- the right edge can be dragged between 72 px and 360 px;
- crossing 144 px restores Discord's normal labels/layout and native account panel;
- double-clicking the resize handle toggles compact/last-expanded width;
- the current width and last expanded width persist through Vencord's DataStore;
- keyboard users can focus the resize handle and use Left/Right, Home/End, or Enter/Space.

The plugin deliberately reuses Discord's existing navigation, avatar, account-menu, mute/deafen and settings actions rather than reimplementing those behaviours. Discord UI class modules change over time, so runtime DOM discovery uses semantic class-name fragments instead of fixed hash suffixes where possible.
