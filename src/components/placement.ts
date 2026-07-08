/** Maps a place value ("1.", "1st", 1, ...) to a podium CSS class, or undefined past 3rd. */
export function placeClass(place: number | string | null | undefined): string | undefined {
  if (place == null) return undefined;
  const n = typeof place === 'number' ? place : parseInt(place, 10);
  switch (n) {
    case 1:
      return 'place-1';
    case 2:
      return 'place-2';
    case 3:
      return 'place-3';
    default:
      return undefined;
  }
}
