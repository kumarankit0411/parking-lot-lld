# Regenerating the diagrams and the PDF

Notes to myself. Nothing here is needed to review the submission.

## Diagrams

The Mermaid sources are in `docs/diagrams/*.mmd` and the exported PNGs sit next
to them. After editing one:

```bash
npx -y @mermaid-js/mermaid-cli \
  -i docs/diagrams/class-diagram.mmd \
  -o docs/diagrams/class-diagram.png \
  -b white -s 2
```

Swap the filename for `er-diagram`, `spot-state`, `sequence-checkin` or
`sequence-checkout`.

## PDF

```bash
npx -y md-to-pdf --css docs/pdf.css docs/DESIGN.md
```

`docs/pdf.css` only sets page margins and stops diagrams splitting across pages.
