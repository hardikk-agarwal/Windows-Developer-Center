# Age-rating board icons

Drop the **official, licensed** rating images here and they render automatically in the
"Your rating across territories" preview (questionnaire + IARC-ID dialogs). Until a file
exists, that badge falls back to the styled chip — no broken images.

## Filename convention

```
<code>-<band>.png
```

- `<code>` — lowercase board code (see table below)
- `<band>` — the IARC age band the icon represents: `0`, `7`, `12`, `16`, or `18`
- extension — `png` by default. If your assets are SVG, change `RATING_IMG_EXT` in
  `publishing/publish.html` from `'png'` to `'svg'`.

Examples: `esrb-0.png` (ESRB Everyone), `pegi-12.png` (PEGI 12), `usk-18.png`, `iarc-0.png`.

You only need the bands you want to show; at minimum add the `-0` (3+) set, since that's
the default rating. Add `-7 / -12 / -16 / -18` to cover Teen/Mature/Adult apps.

## Board codes

| code        | board                                         | region        |
|-------------|-----------------------------------------------|---------------|
| `acb`       | Australian Classification Board               | Australia     |
| `ccc`       | Cinematographic Qualification Council         | Chile         |
| `dgsc`      | Digital Game Self-regulation Committee        | Taiwan        |
| `djctq`     | Brazilian Advisory Rating System              | Brazil        |
| `esrb`      | Entertainment Software Rating Board           | United States |
| `gamr`      | General Authority for Media Regulation        | Saudi Arabia  |
| `iarc`      | International Age Ratings Coalition            | Global        |
| `microsoft` | Microsoft Store                               | Global        |
| `pcbp`      | Russian Age Rating System                     | Russia        |
| `pegi`      | Pan European Game Information                 | Europe        |
| `usk`       | Entertainment Software Self-Regulation Body   | Germany       |

The images render at 46×46 on a white background (`object-fit: contain`), so square logos
look best. These are trademarked marks — only add assets you're licensed to use.
