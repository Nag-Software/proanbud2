/**
 * Ytterkontur fra vegger.
 *
 * «Legg inn gulv/tak etter ytterveggene» er den vanligste handlingen etter at
 * planet er tegnet, og den skal koste ett klikk. Konturen tas fra den ytre
 * flaten i vegg-grafen, ikke fra et konvekst skall — ellers ville en L-formet
 * bolig fått et gulv som stakk ut i hagen.
 */

import { outerOutline } from "./rooms"
import type { Point, Wall } from "./types"

export function buildOutlineFromWalls(walls: Wall[]): Point[] | null {
  const exterior = walls.filter((wall) => wall.type === "exterior")
  // Prøv ytterveggene først: de gir riktig kontur også når skillevegger
  // stikker utenfor. Faller tilbake på alle vegger for enkle skisser der
  // ingen er merket som yttervegg.
  return outerOutline(exterior.length >= 3 ? exterior : walls)
}
