# Quick Look preview

This file exercises **pirep's existing Markdown renderer**.

## Table

| Item | Status | Note |
| --- | --- | --- |
| Markdown | Ready | CommonMark + GFM |
| Preview | Prototype | Quick Look extension |

## Checklists

- [x] Parse Markdown
- [ ] Inspect layout in Quick Look

## Callouts

> [!note] Preview scope
> Content is rendered locally. The app shell is not included.

> [!warning] Images
> Image loading is intentionally omitted from this prototype.

## Inline and block math

Euler's identity is inline: $e^{i\pi} + 1 = 0$.

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

## Mermaid

```mermaid
flowchart LR
  File[Markdown file] --> Parse[parseDoc]
  Parse --> Preview[Quick Look preview]
```
