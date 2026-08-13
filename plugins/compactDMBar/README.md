# CompactDMBar

Compacts Discord's Home/Friends direct-message sidebar into a server-list-style rail while leaving guild channel sidebars alone.

## Behaviour

- compact width is 72 px, with 40 px DM avatars centered inside compact rows;
- search is replaced visually by a magnifying-glass icon while preserving Discord's native search target;
- top Home navigation entries and DM rows become icon/avatar-only in compact mode;
- the Direct Messages heading, row text/details, close buttons and scrollbar are hidden in compact mode;
- Discord's native account avatar/profile control stays mounted and anchors the native profile popout;
- a single native-styled compact toggle reveals Discord's real mute, deafen and settings buttons instead of cloning or proxying them;
- Discord's native sidebar resize handle stays visible and keeps its native styling;
- double-clicking the native handle toggles compact/default mode;
- sidebar resizing is blocked only while compact; default mode keeps Discord's normal resize behaviour;
- the compact/default choice persists through Vencord settings.

The plugin deliberately keeps Discord's existing navigation, account profile flow and account actions mounted. Runtime DOM work is limited to locating the Home/Friends sidebar and its native resize handle; Discord's account controls are integrated through the same account-panel React patch pattern used by Vencord's built-in plugins.
