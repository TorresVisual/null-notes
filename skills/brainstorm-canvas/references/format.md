# Canvas file format

Valid [JSON Canvas](https://jsoncanvas.org) (`nodes`, `edges`) plus a few extension fields other tools ignore. Pretty-printed JSON, 2-space indent, trailing newline.

## Top level

| Key | Meaning |
| --- | --- |
| `nodes` | array of nodes |
| `edges` | array of edges |
| `lastPass` | highest pass number ever allocated; only goes up (a deleted pass never frees its number) |

Preserve any other top-level key you find.

## Nodes

Every node has a unique string `id`, a `type`, and integer `x`, `y`, `width`, `height`.

| `type` | Extra fields |
| --- | --- |
| `text` | `text`: Markdown string |
| `file` | `file`: path relative to the workspace root, forward slashes; optional `"line": <n>` (extension field). A `.md` path opens that note; other files open in the user's editor at the line |
| `group` | `label`: string |

Use only these three. `link` is not used.

## Agent extension fields

Every node and edge an agent writes carries both:

- `"pass": <n>` — positive integer, the pass it belongs to. Permanent identity; never strip or change it.
- `"author": "agent"`.

User-made elements have neither; leave them untouched. A card with `"edited": true` was changed by the user after you wrote it.

## Passes

One pass = one `group` node labelled `Pass <n> · <short topic>` (note the middle dot `·`), containing the pass's cards. Its first card is the question card (`text`). Cards, edges and the group all carry the same `pass`.

## Edges

`id`, `fromNode`, `toNode` (node ids), optional `label`. An arrow points at `toNode` by default. Add `pass` and `author` as above.

## Worked example: one pass

```json
{
  "nodes": [
    {
      "id": "p1-group",
      "type": "group",
      "label": "Pass 1 · retry strategy",
      "x": 0,
      "y": 0,
      "width": 940,
      "height": 240,
      "pass": 1,
      "author": "agent"
    },
    {
      "id": "p1-question",
      "type": "text",
      "text": "Which calls in the client are safe to retry?",
      "x": 40,
      "y": 60,
      "width": 260,
      "height": 140,
      "pass": 1,
      "author": "agent"
    },
    {
      "id": "p1-fetch",
      "type": "file",
      "file": "src/net/retry.ts",
      "line": 42,
      "x": 340,
      "y": 60,
      "width": 260,
      "height": 140,
      "pass": 1,
      "author": "agent"
    },
    {
      "id": "p1-idempotent",
      "type": "text",
      "text": "Only idempotent requests. POST /orders is not (unverified: no idempotency key found).",
      "x": 640,
      "y": 60,
      "width": 260,
      "height": 140,
      "pass": 1,
      "author": "agent"
    }
  ],
  "edges": [
    {
      "id": "p1-e1",
      "fromNode": "p1-question",
      "toNode": "p1-fetch",
      "label": "current retry loop",
      "pass": 1,
      "author": "agent"
    },
    {
      "id": "p1-e2",
      "fromNode": "p1-fetch",
      "toNode": "p1-idempotent",
      "label": "retries everything",
      "pass": 1,
      "author": "agent"
    }
  ],
  "lastPass": 1
}
```

Ids need only be unique; prefixing with the pass (`p2-…`) keeps them so.
