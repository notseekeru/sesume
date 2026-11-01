#!/usr/bin/env bash
set -euo pipefail

TEX="${1:-RESUME.latex}"
OUT="${2:-build}"
MARGIN_IN="${MARGIN_IN:-0.5}"
MAX_PAGES="${MAX_PAGES:-1}"
MAX_BULLET_LINES="${MAX_BULLET_LINES:-2}"
MAX_OVERFULL_PT="${MAX_OVERFULL_PT:-5}"
DPI="${DPI:-110}"
RUNT_FRACTION="${RUNT_FRACTION:-0.5}"

command -v latexmk >/dev/null || { echo "latexmk missing: run inside nix develop" >&2; exit 2; }
command -v pdftotext >/dev/null || { echo "poppler missing: run inside nix develop" >&2; exit 2; }

base="$(basename "$TEX")"
base="${base%.*}"
mkdir -p "$OUT"

if ! latexmk -pdf -outdir="$OUT" -auxdir="$OUT" -interaction=nonstopmode "$TEX" >/dev/null 2>&1; then
  echo "FAIL compile"
  tail -20 "$OUT/$base.log"
  exit 1
fi

PDF="$OUT/$base.pdf"
LOG="$OUT/$base.log"

pages=$(sed -n 's/.*Output written on .* (\([0-9]*\) page.*/\1/p' "$LOG" | tail -1 || true)
pages="${pages:-0}"

overfull=$(grep -o 'Overfull \\hbox ([0-9.]*pt' "$LOG" | grep -o '[0-9.]*' | sort -rn | head -1 || true)
overfull="${overfull:-0}"

pageh=$(pdftotext -bbox "$PDF" - | grep -o 'height="[0-9.]*"' | head -1 | cut -d'"' -f2 || true)
bottom=$(pdftotext -bbox "$PDF" - | grep -o 'yMax="[0-9.]*"' | cut -d'"' -f2 | sort -g | tail -1 || true)
fill=$(awk -v b="$bottom" -v h="$pageh" -v m="$MARGIN_IN" \
  'BEGIN { pt=m*72; printf "%.0f", (b-pt)/(h-2*pt)*100 }')
slack=$(awk -v b="$bottom" -v h="$pageh" -v m="$MARGIN_IN" \
  'BEGIN { pt=m*72; printf "%.2f", (h-pt-b)/72 }')

layout=$(pdftotext -layout "$PDF" -)
wmax=$(printf '%s\n' "$layout" | awk '{ if (length($0) > m) m = length($0) } END { print m + 0 }')

blocks=$(printf '%s\n' "$layout" | awk -v wmax="$wmax" -v maxl="$MAX_BULLET_LINES" -v runt="$RUNT_FRACTION" '
  function flush() {
    if (n > 0) {
      total++
      if (n > maxl) { long++; longline[long] = substr(head, 1, 55) "  (" n " lines)" }
      if (n >= 2 && last < runt * wmax) {
        runts++
        runtline[runts] = substr(head, 1, 55) "  (" int(last * 100 / wmax) "%)"
      }
    }
    n = 0
  }
  /^[ ]*•/ { flush(); n = 1; last = length($0); head = substr($0, index($0, "•") + 1); next }
  /^[ ]+[^ ]/ { if (n > 0) { n++; last = length($0) } next }
  { flush() }
  END {
    flush()
    print total + 0, long + 0, runts + 0
    for (i = 1; i <= long; i++) print "  long: " longline[i]
    for (i = 1; i <= runts; i++) print "  runt: " runtline[i]
  }')

bullets=$(echo "$blocks" | head -1 | cut -d' ' -f1)
longn=$(echo "$blocks" | head -1 | cut -d' ' -f2)
runtn=$(echo "$blocks" | head -1 | cut -d' ' -f3)

rm -rf "$OUT/preview"
mkdir -p "$OUT/preview"
pdftoppm -png -r "$DPI" "$PDF" "$OUT/preview/page" >/dev/null 2>&1

fail=0
row() { printf '%-10s %-30s %s\n' "$1" "$2" "$3"; }
verdict() { if [ "$1" -eq 1 ]; then echo "FAIL"; fail=1; else echo "ok"; fi; }

echo "$TEX"
row pages "$pages/$MAX_PAGES" "$(verdict "$(awk -v p="$pages" -v m="$MAX_PAGES" 'BEGIN{print (p>m)}')")"
row fill "${fill}% (${slack}in slack)" "ok"
row overfull "${overfull}pt (max ${MAX_OVERFULL_PT}pt)" \
  "$(verdict "$(awk -v o="$overfull" -v m="$MAX_OVERFULL_PT" 'BEGIN{print (o>m)}')")"
row bullets "$bullets, $longn over $MAX_BULLET_LINES lines" \
  "$(verdict "$(awk -v l="$longn" 'BEGIN{print (l>0)}')")"
row runt "$runtn under ${RUNT_FRACTION} last line" "trim"
row preview "$OUT/preview/page-1.png" "look"
echo "$blocks" | tail -n +2
echo

if [ "$pages" -gt "$MAX_PAGES" ]; then
  echo "spill, page 2 starts with:"
  pdftotext -f 2 -l 2 "$PDF" - | sed '/^$/d' | head -3
fi

exit "$fail"
