# Findings

| # | area | repro (one line) | commit found | status |
|---|------|------------------|--------------|--------|
| #167 | round-trip/code | ````md fence containing ``` inner fence → saved with a 3-backtick fence, inner fence now closes the block early | 595d050 | fixed |
| #168 | round-trip/html | `<!-- comment -->` paragraph deleted on first save; `<div>raw</div>` rewritten as `<div>\nraw\n\n</div>` | 595d050 | fixed (comment @26c5e95; `<div>` body escaping @ DivBlock commit — issue text understated it: `<div align=center>` + `**hi**` became `\*\*hi\*\*` on the 2nd save) |
| #169 | round-trip/table | header cell with escaped pipe `b \| c` saved as `b | c` → header 4 cells vs 3-col delimiter row | 595d050 | fixed |
| #170 | round-trip/footnote | `[^n]: text\n    continuation` → continuation turned into a ``` code fence | 595d050 | fixed |
| #171 | round-trip/escape | `\[\[x\]\]` saved as `[[x]]` (becomes a wiki-link on reload) | 595d050 | fixed |
| - | round-trip/html | block after `</div>` or `</details>` is swallowed into the raw-HTML block and gets more backslashes on every save | 595d050 | fixed (no issue filed) |
