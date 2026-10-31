# Documentation coverage: Obsidian Help

Audit date 2026-10-31. Root: <https://obsidian.md/help/>.

## Method

1. `https://obsidian.md/help/sitemap.xml` lists **179** page URLs (the Help site is an Obsidian Publish site; `llms.txt` returned only the JS shell, not a page index).
2. The Publish site's file index (`publish-01.obsidian.md/cache/<site id>`) lists 323 files, of which **179** are Markdown pages. The same host serves each page's Markdown source, so pages were read as source text rather than scraped from rendered HTML.
3. Every one of the 179 Markdown sources was fetched (HTTP 200, 0 retries needed beyond curl's built-in, 0 failures). Sitemap URLs and page permalinks agree: 0 sitemap URLs have no page with a matching `permalink` (none; the Home page has permalink `/`, which was matched to the `Home` sitemap entry).

## Totals

| Measure | Count |
|---|---|
| Discovered URLs (sitemap) | 179 |
| Pages fetched successfully | 179 |
| Failed / inaccessible | 0 |
| Skipped | 0 |
| Redirects | `/help/` serves the Home page; `help.obsidian.md/sitemap.xml` serves the same sitemap |
| Total source size | 740 KB |
| Inventory entries produced | 211 |

## Depth of reading (important)

Reading depth was not uniform. This is stated so nobody mistakes coverage of a URL for a line-by-line review of it.

- **Tier A: digest-read.** Every heading, list, table and the opening paragraph of each section was read (code examples and callout bodies were skipped). Folders: Editing and formatting, Files and folders, Getting started, Linking notes and files, Plugins, User interface. These pages drive most of the inventory and the implementation audit.
- **Tier B: heading-level.** Headings, command/section names and descriptions were read, not the full prose. Folders: Bases, Import notes, Extending Obsidian, Obsidian Web Clipper, Obsidian Sync, Obsidian Publish, Teams, Licenses and payment, Obsidian (about/mobile/etc.), Contributing to Obsidian, Help and support, Home. Most of these describe external services, importers or developer surfaces and were classified by capability, not audited for detail. Bases, the CLI command list and the Web Clipper variables/filters are inventoried as clusters, not one entry per function or filter.

## Coverage by Help section

| Section | Pages | Tier | Inventory entries citing it |
|---|---|---|---|
| Bases | 11 | B | 2 |
| Contributing to Obsidian | 4 | B | 0 |
| Editing and formatting | 14 | A | 37 |
| Extending Obsidian | 8 | B | 8 |
| Files and folders | 6 | A | 13 |
| Getting started | 11 | A | 7 |
| (root) | 2 | B | 1 |
| Import notes | 18 | B | 16 |
| Licenses and payment | 6 | B | 0 |
| Linking notes and files | 4 | A | 18 |
| Obsidian Publish | 16 | B | 2 |
| Obsidian Sync | 15 | B | 6 |
| Obsidian Web Clipper | 10 | B | 5 |
| Obsidian | 8 | B | 2 |
| Plugins | 28 | A | 61 |
| Teams | 6 | B | 1 |
| User interface | 12 | A | 32 |

## Not covered / needs further investigation

- Pages outside the Help site were not crawled: the Obsidian changelog, the community plugin/theme directory, the forum and the developer docs. The Help pages describe the plugin ecosystem; no individual community plugin was enumerated or audited.
- Tier B pages were read at heading level only (see above). A second pass over Bases functions, Importer per-app pages and the Web Clipper filter list would only matter if those areas are brought into scope.
- Rendered-page behaviour (screenshots, interactive demos) was not inspected; images in the Help pages were skipped.
- The Help site has no dedicated accessibility page, so accessibility parity cannot be derived from it.

## Page list

| URL | Source file | Tier | Size | Inspected |
|---|---|---|---|---|
| <https://obsidian.md/help/resources> | Help and support | B | 5679 B | yes |
| <https://obsidian.md/help/> | Home | B | 2055 B | yes |
| <https://obsidian.md/help/bases/syntax> | Bases / Bases syntax | B | 18390 B | yes |
| <https://obsidian.md/help/bases/create-base> | Bases / Create a base | B | 1220 B | yes |
| <https://obsidian.md/help/formulas> | Bases / Formulas | B | 5423 B | yes |
| <https://obsidian.md/help/bases/functions> | Bases / Functions | B | 19144 B | yes |
| <https://obsidian.md/help/bases> | Bases / Introduction to Bases | B | 2030 B | yes |
| <https://obsidian.md/help/bases/views/cards> | Bases / Layouts / Cards view | B | 1352 B | yes |
| <https://obsidian.md/help/bases/views/kanban> | Bases / Layouts / Kanban view | B | 2668 B | yes |
| <https://obsidian.md/help/bases/views/list> | Bases / Layouts / List view | B | 1005 B | yes |
| <https://obsidian.md/help/bases/views/map> | Bases / Layouts / Map view | B | 6013 B | yes |
| <https://obsidian.md/help/bases/views/table> | Bases / Layouts / Table view | B | 5889 B | yes |
| <https://obsidian.md/help/bases/views> | Bases / Views | B | 8565 B | yes |
| <https://obsidian.md/help/developers> | Contributing to Obsidian / Developers | B | 2019 B | yes |
| <https://obsidian.md/help/financial-contributions> | Contributing to Obsidian / Financial contributions | B | 816 B | yes |
| <https://obsidian.md/help/style-guide> | Contributing to Obsidian / Style guide | B | 17164 B | yes |
| <https://obsidian.md/help/translations> | Contributing to Obsidian / Translations | B | 584 B | yes |
| <https://obsidian.md/help/advanced-syntax> | Editing and formatting / Advanced formatting syntax | A | 5545 B | yes |
| <https://obsidian.md/help/attachments> | Editing and formatting / Attachments | A | 1774 B | yes |
| <https://obsidian.md/help/syntax> | Editing and formatting / Basic formatting syntax | A | 16149 B | yes |
| <https://obsidian.md/help/callouts> | Editing and formatting / Callouts | A | 6176 B | yes |
| <https://obsidian.md/help/editing-shortcuts> | Editing and formatting / Editing shortcuts | A | 5080 B | yes |
| <https://obsidian.md/help/embed-web-pages> | Editing and formatting / Embed web pages | A | 1435 B | yes |
| <https://obsidian.md/help/find-and-replace> | Editing and formatting / Find and replace | A | 1586 B | yes |
| <https://obsidian.md/help/folding> | Editing and formatting / Folding | A | 1349 B | yes |
| <https://obsidian.md/help/html> | Editing and formatting / HTML content | A | 3145 B | yes |
| <https://obsidian.md/help/multiple-cursors> | Editing and formatting / Multiple cursors | A | 706 B | yes |
| <https://obsidian.md/help/obsidian-flavored-markdown> | Editing and formatting / Obsidian Flavored Markdown | A | 2564 B | yes |
| <https://obsidian.md/help/properties> | Editing and formatting / Properties | A | 10453 B | yes |
| <https://obsidian.md/help/tags> | Editing and formatting / Tags | A | 2209 B | yes |
| <https://obsidian.md/help/edit-and-read> | Editing and formatting / Views and editing mode | A | 3499 B | yes |
| <https://obsidian.md/help/snippets> | Extending Obsidian / CSS snippets | B | 4593 B | yes |
| <https://obsidian.md/help/community-directory> | Extending Obsidian / Community directory | B | 4569 B | yes |
| <https://obsidian.md/help/community-plugins> | Extending Obsidian / Community plugins | B | 3632 B | yes |
| <https://obsidian.md/help/cli> | Extending Obsidian / Obsidian CLI | B | 32586 B | yes |
| <https://obsidian.md/help/headless> | Extending Obsidian / Obsidian Headless | B | 1928 B | yes |
| <https://obsidian.md/help/uri> | Extending Obsidian / Obsidian URI | B | 9763 B | yes |
| <https://obsidian.md/help/plugin-security> | Extending Obsidian / Plugin security | B | 2378 B | yes |
| <https://obsidian.md/help/themes> | Extending Obsidian / Themes | B | 1719 B | yes |
| <https://obsidian.md/help/file-formats> | Files and folders / Accepted file formats | A | 1083 B | yes |
| <https://obsidian.md/help/configuration-folder> | Files and folders / Configuration folder | A | 2017 B | yes |
| <https://obsidian.md/help/data-storage> | Files and folders / How Obsidian stores data | A | 3473 B | yes |
| <https://obsidian.md/help/manage-notes> | Files and folders / Manage notes | A | 3220 B | yes |
| <https://obsidian.md/help/manage-vaults> | Files and folders / Manage vaults | A | 4366 B | yes |
| <https://obsidian.md/help/symlinks> | Files and folders / Symbolic links and junctions | A | 2563 B | yes |
| <https://obsidian.md/help/backup> | Getting started / Back up your Obsidian files | A | 6452 B | yes |
| <https://obsidian.md/help/vault> | Getting started / Create a vault | A | 1055 B | yes |
| <https://obsidian.md/help/create-note> | Getting started / Create your first note | A | 1398 B | yes |
| <https://obsidian.md/help/install> | Getting started / Download and install Obsidian | A | 3242 B | yes |
| <https://obsidian.md/help/glossary> | Getting started / Glossary | A | 4783 B | yes |
| <https://obsidian.md/help/import> | Getting started / Import notes | A | 2760 B | yes |
| <https://obsidian.md/help/link-notes> | Getting started / Link notes | A | 2963 B | yes |
| <https://obsidian.md/help/mobile> | Getting started / Mobile app | A | 3841 B | yes |
| <https://obsidian.md/help/sandbox> | Getting started / Sandbox vault | A | 1222 B | yes |
| <https://obsidian.md/help/sync-notes> | Getting started / Sync your notes across devices | A | 12796 B | yes |
| <https://obsidian.md/help/updates> | Getting started / Update Obsidian | A | 2213 B | yes |
| <https://obsidian.md/help/import/csv> | Import notes / Import CSV files | B | 2048 B | yes |
| <https://obsidian.md/help/import/html> | Import notes / Import HTML files | B | 2395 B | yes |
| <https://obsidian.md/help/import/markdown> | Import notes / Import Markdown files | B | 1495 B | yes |
| <https://obsidian.md/help/import/textbundle> | Import notes / Import Textbundle files | B | 2110 B | yes |
| <https://obsidian.md/help/import/airtable> | Import notes / Import from Airtable | B | 5640 B | yes |
| <https://obsidian.md/help/import/apple-journal> | Import notes / Import from Apple Journal | B | 2397 B | yes |
| <https://obsidian.md/help/import/apple-notes> | Import notes / Import from Apple Notes | B | 2552 B | yes |
| <https://obsidian.md/help/import/bear> | Import notes / Import from Bear | B | 1609 B | yes |
| <https://obsidian.md/help/import/craft> | Import notes / Import from Craft | B | 819 B | yes |
| <https://obsidian.md/help/import/evernote> | Import notes / Import from Evernote | B | 2577 B | yes |
| <https://obsidian.md/help/import/google-keep> | Import notes / Import from Google Keep | B | 2715 B | yes |
| <https://obsidian.md/help/import/logseq> | Import notes / Import from Logseq | B | 4166 B | yes |
| <https://obsidian.md/help/import/onenote> | Import notes / Import from Microsoft OneNote | B | 7708 B | yes |
| <https://obsidian.md/help/import/notion> | Import notes / Import from Notion | B | 7399 B | yes |
| <https://obsidian.md/help/import/roam> | Import notes / Import from Roam Research | B | 1591 B | yes |
| <https://obsidian.md/help/import/tomboy> | Import notes / Import from Tomboy and Gnote | B | 1239 B | yes |
| <https://obsidian.md/help/plugins/importer> | Import notes / Importer | B | 1404 B | yes |
| <https://obsidian.md/help/import/templates> | Import notes / Importer templates | B | 4753 B | yes |
| <https://obsidian.md/help/catalyst> | Licenses and payment / Catalyst license | B | 3069 B | yes |
| <https://obsidian.md/help/discounts> | Licenses and payment / Education and non-profit discount | B | 3121 B | yes |
| <https://obsidian.md/help/payment> | Licenses and payment / Introduction to licenses and payment | B | 2649 B | yes |
| <https://obsidian.md/help/credit> | Licenses and payment / Obsidian Credit | B | 2935 B | yes |
| <https://obsidian.md/help/refunds> | Licenses and payment / Refund policy | B | 2674 B | yes |
| <https://obsidian.md/help/sales-tax> | Licenses and payment / Sales tax | B | 2248 B | yes |
| <https://obsidian.md/help/aliases> | Linking notes and files / Aliases | A | 1777 B | yes |
| <https://obsidian.md/help/embeds> | Linking notes and files / Embed files | A | 3125 B | yes |
| <https://obsidian.md/help/links> | Linking notes and files / Internal links | A | 8992 B | yes |
| <https://obsidian.md/help/pdf> | Linking notes and files / PDFs | A | 5834 B | yes |
| <https://obsidian.md/help/2fa> | Obsidian / 2-factor authentication | B | 4165 B | yes |
| <https://obsidian.md/help/obsidian> | Obsidian / About Obsidian | B | 3557 B | yes |
| <https://obsidian.md/help/community-code-of-conduct> | Obsidian / Community code of conduct | B | 10791 B | yes |
| <https://obsidian.md/help/credits> | Obsidian / Credits | B | 8101 B | yes |
| <https://obsidian.md/help/early-access> | Obsidian / Early access versions | B | 3404 B | yes |
| <https://obsidian.md/help/android> | Obsidian / Obsidian for Android | B | 5345 B | yes |
| <https://obsidian.md/help/ios> | Obsidian / Obsidian for iOS and iPadOS | B | 9282 B | yes |
| <https://obsidian.md/help/official-site> | Obsidian / Official website | B | 470 B | yes |
| <https://obsidian.md/help/publish/analytics> | Obsidian Publish / Analytics | B | 2215 B | yes |
| <https://obsidian.md/help/publish/collaborate> | Obsidian Publish / Collaborate on a Publish site | B | 2901 B | yes |
| <https://obsidian.md/help/publish/domains> | Obsidian Publish / Custom domains | B | 7226 B | yes |
| <https://obsidian.md/help/publish/customize> | Obsidian Publish / Customize your site | B | 5486 B | yes |
| <https://obsidian.md/help/publish/headless> | Obsidian Publish / Headless Publish | B | 3944 B | yes |
| <https://obsidian.md/help/publish> | Obsidian Publish / Introduction to Obsidian Publish | B | 1222 B | yes |
| <https://obsidian.md/help/publish/sites> | Obsidian Publish / Manage sites | B | 6863 B | yes |
| <https://obsidian.md/help/publish/media> | Obsidian Publish / Media files | B | 1662 B | yes |
| <https://obsidian.md/help/publish/permalinks> | Obsidian Publish / Permalinks | B | 1975 B | yes |
| <https://obsidian.md/help/publish/limitations> | Obsidian Publish / Publish limitations | B | 2506 B | yes |
| <https://obsidian.md/help/publish/publish> | Obsidian Publish / Publish your content | B | 4008 B | yes |
| <https://obsidian.md/help/publish/seo> | Obsidian Publish / SEO | B | 2075 B | yes |
| <https://obsidian.md/help/publish/security> | Obsidian Publish / Security and privacy | B | 2859 B | yes |
| <https://obsidian.md/help/publish/setup> | Obsidian Publish / Set up Obsidian Publish | B | 3944 B | yes |
| <https://obsidian.md/help/publish/social-share> | Obsidian Publish / Social media link previews | B | 1632 B | yes |
| <https://obsidian.md/help/publish/troubleshoot> | Obsidian Publish / Troubleshoot Obsidian Publish | B | 1712 B | yes |
| <https://obsidian.md/help/sync/collaborate> | Obsidian Sync / Collaborate on a shared vault | B | 2544 B | yes |
| <https://obsidian.md/help/sync/faq> | Obsidian Sync / Frequently asked questions | B | 4566 B | yes |
| <https://obsidian.md/help/sync/headless> | Obsidian Sync / Headless Sync | B | 6545 B | yes |
| <https://obsidian.md/help/sync> | Obsidian Sync / Introduction to Obsidian Sync | B | 2112 B | yes |
| <https://obsidian.md/help/sync/vault-types> | Obsidian Sync / Local and remote vaults | B | 5734 B | yes |
| <https://obsidian.md/help/sync/plans> | Obsidian Sync / Plans and storage limits | B | 5169 B | yes |
| <https://obsidian.md/help/sync/security> | Obsidian Sync / Security and privacy | B | 8503 B | yes |
| <https://obsidian.md/help/sync/setup> | Obsidian Sync / Set up Obsidian Sync | B | 10899 B | yes |
| <https://obsidian.md/help/sync/messages> | Obsidian Sync / Status icon and messages | B | 8090 B | yes |
| <https://obsidian.md/help/sync/switch> | Obsidian Sync / Switch to Obsidian Sync | B | 4162 B | yes |
| <https://obsidian.md/help/sync/region> | Obsidian Sync / Sync regions | B | 3238 B | yes |
| <https://obsidian.md/help/sync/settings> | Obsidian Sync / Sync settings and selective syncing | B | 7831 B | yes |
| <https://obsidian.md/help/sync/troubleshoot> | Obsidian Sync / Troubleshoot Obsidian Sync | B | 6019 B | yes |
| <https://obsidian.md/help/sync/migrate> | Obsidian Sync / Upgrade Sync encryption | B | 2953 B | yes |
| <https://obsidian.md/help/sync/version-history> | Obsidian Sync / Version history | B | 7009 B | yes |
| <https://obsidian.md/help/web-clipper/capture> | Obsidian Web Clipper / Clip web pages | B | 3711 B | yes |
| <https://obsidian.md/help/web-clipper/filters> | Obsidian Web Clipper / Filters | B | 16685 B | yes |
| <https://obsidian.md/help/web-clipper/highlight> | Obsidian Web Clipper / Highlighter | B | 2462 B | yes |
| <https://obsidian.md/help/web-clipper/interpreter> | Obsidian Web Clipper / Interpreter | B | 9594 B | yes |
| <https://obsidian.md/help/web-clipper> | Obsidian Web Clipper / Introduction to Obsidian Web Clipper | B | 2009 B | yes |
| <https://obsidian.md/help/web-clipper/logic> | Obsidian Web Clipper / Logic | B | 6271 B | yes |
| <https://obsidian.md/help/web-clipper/reader> | Obsidian Web Clipper / Reader | B | 1973 B | yes |
| <https://obsidian.md/help/web-clipper/templates> | Obsidian Web Clipper / Templates | B | 3732 B | yes |
| <https://obsidian.md/help/web-clipper/troubleshoot> | Obsidian Web Clipper / Troubleshoot Web Clipper | B | 3906 B | yes |
| <https://obsidian.md/help/web-clipper/variables> | Obsidian Web Clipper / Variables | B | 9698 B | yes |
| <https://obsidian.md/help/plugins/audio-recorder> | Plugins / Audio recorder | A | 1029 B | yes |
| <https://obsidian.md/help/plugins/backlinks> | Plugins / Backlinks | A | 3045 B | yes |
| <https://obsidian.md/help/plugins/bookmarks> | Plugins / Bookmarks | A | 3955 B | yes |
| <https://obsidian.md/help/plugins/canvas> | Plugins / Canvas | A | 17505 B | yes |
| <https://obsidian.md/help/plugins/command-palette> | Plugins / Command palette | A | 1793 B | yes |
| <https://obsidian.md/help/plugins> | Plugins / Core plugins | A | 3261 B | yes |
| <https://obsidian.md/help/plugins/daily-notes> | Plugins / Daily notes | A | 2341 B | yes |
| <https://obsidian.md/help/plugins/file-explorer> | Plugins / File explorer | A | 6489 B | yes |
| <https://obsidian.md/help/plugins/file-recovery> | Plugins / File recovery | A | 3486 B | yes |
| <https://obsidian.md/help/plugins/footnotes> | Plugins / Footnotes view | A | 260 B | yes |
| <https://obsidian.md/help/plugins/format-converter> | Plugins / Format converter | A | 988 B | yes |
| <https://obsidian.md/help/plugins/graph> | Plugins / Graph view | A | 3976 B | yes |
| <https://obsidian.md/help/plugins/note-composer> | Plugins / Note composer | A | 3661 B | yes |
| <https://obsidian.md/help/plugins/outgoing-links> | Plugins / Outgoing links | A | 1444 B | yes |
| <https://obsidian.md/help/plugins/outline> | Plugins / Outline | A | 282 B | yes |
| <https://obsidian.md/help/plugins/page-preview> | Plugins / Page preview | A | 703 B | yes |
| <https://obsidian.md/help/plugins/properties> | Plugins / Properties view | A | 780 B | yes |
| <https://obsidian.md/help/plugins/quick-switcher> | Plugins / Quick switcher | A | 1615 B | yes |
| <https://obsidian.md/help/plugins/random-note> | Plugins / Random note | A | 302 B | yes |
| <https://obsidian.md/help/plugins/search> | Plugins / Search | A | 12207 B | yes |
| <https://obsidian.md/help/plugins/slash-commands> | Plugins / Slash commands | A | 794 B | yes |
| <https://obsidian.md/help/plugins/slides> | Plugins / Slides | A | 1160 B | yes |
| <https://obsidian.md/help/plugins/tags> | Plugins / Tags view | A | 734 B | yes |
| <https://obsidian.md/help/plugins/templates> | Plugins / Templates | A | 3917 B | yes |
| <https://obsidian.md/help/plugins/unique-note> | Plugins / Unique note creator | A | 1126 B | yes |
| <https://obsidian.md/help/plugins/web-viewer> | Plugins / Web viewer | A | 1978 B | yes |
| <https://obsidian.md/help/plugins/word-count> | Plugins / Word count | A | 431 B | yes |
| <https://obsidian.md/help/plugins/workspaces> | Plugins / Workspaces | A | 1800 B | yes |
| <https://obsidian.md/help/teams/license> | Teams / Commercial license | B | 4424 B | yes |
| <https://obsidian.md/help/teams/deploy> | Teams / Deploy Obsidian across your team | B | 3901 B | yes |
| <https://obsidian.md/help/teams> | Teams / Obsidian for teams | B | 1287 B | yes |
| <https://obsidian.md/help/teams/publish> | Teams / Publishing for teams | B | 2020 B | yes |
| <https://obsidian.md/help/teams/security> | Teams / Security considerations for teams | B | 5528 B | yes |
| <https://obsidian.md/help/teams/sync> | Teams / Syncing for teams | B | 2476 B | yes |
| <https://obsidian.md/help/appearance> | User interface / Appearance | A | 2187 B | yes |
| <https://obsidian.md/help/drag-and-drop> | User interface / Drag and drop | A | 1603 B | yes |
| <https://obsidian.md/help/hotkeys> | User interface / Hotkeys | A | 1883 B | yes |
| <https://obsidian.md/help/language> | User interface / Language settings | A | 489 B | yes |
| <https://obsidian.md/help/more-options-menu> | User interface / More options menu | A | 4208 B | yes |
| <https://obsidian.md/help/pop-out-windows> | User interface / Pop-out windows | A | 1350 B | yes |
| <https://obsidian.md/help/ribbon> | User interface / Ribbon | A | 3542 B | yes |
| <https://obsidian.md/help/settings> | User interface / Settings | A | 14713 B | yes |
| <https://obsidian.md/help/sidebar> | User interface / Sidebar | A | 3894 B | yes |
| <https://obsidian.md/help/status-bar> | User interface / Status bar | A | 978 B | yes |
| <https://obsidian.md/help/tabs> | User interface / Tabs | A | 4893 B | yes |
| <https://obsidian.md/help/workspace> | User interface / Workspace | A | 1494 B | yes |