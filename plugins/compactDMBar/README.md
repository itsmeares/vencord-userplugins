# CompactDMBar

Compacts Discord's Home/Friends direct-message sidebar to a 64 px icon rail while leaving normal guild channel sidebars alone.

Current first-pass behaviour:

- search is reduced to its native icon;
- top Home navigation entries keep their icons and hide labels;
- DM rows keep avatars/status presentation and hide the name/details column;
- the Direct Messages heading is hidden;
- the DM close button and scrollbar are hidden to avoid crowding the rail.

This is intentionally a first live-testable pass. Discord UI class modules change over time, so the plugin uses semantic class-name fragments rather than fixed hash suffixes where possible.
