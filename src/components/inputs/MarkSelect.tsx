import { WheelPicker, type WheelOption } from './WheelPicker';
import { compose, decompose, snapSelection, wheelsFor } from '../../engine/markWheels';
import { formatMark } from '../../engine/mark';
import type { ParsedTable } from '../../engine/scoring';

/**
 * A mark picker for any event group: one wheel per digit group, cascading so every
 * reachable combination is a mark the book actually lists. Replaces HeightSelect in the
 * simulator; HeightSelect stays for the high-jump-only Calculator and Compare.
 */
export function MarkSelect({
  table,
  value,
  onChange,
  rows,
}: {
  table: ParsedTable;
  value: number;
  onChange: (mark: number) => void;
  rows?: number;
}) {
  const selection = decompose(value, table.spec);
  const wheels = wheelsFor(table, selection);

  function handle(index: number, next: number) {
    const wanted = [...selection];
    wanted[index] = next;
    // Everything below the moved wheel may now be stranded; snap it back onto the table.
    onChange(compose(snapSelection(table, wanted), table.spec));
  }

  return (
    // .field is a two-column grid (label, control), so the wheels and the readout share
    // one wrapper rather than becoming a third child that would land in the label column.
    <div className="field mark-select">
      <span>Mark</span>
      <div className="mark-control">
        <div className="mark-wheels">
          {wheels.map((wheel, i) =>
            wheel.hidden ? null : (
              <WheelPicker
                key={wheel.key}
                options={wheel.options.map<WheelOption>((o) => ({
                  value: o,
                  label: wheel.pad ? String(o).padStart(wheel.pad, '0') : String(o),
                }))}
                value={selection[i]}
                onChange={(next) => handle(i, next)}
                ariaLabel={wheel.key}
                rows={rows}
              />
            ),
          )}
        </div>
        {/* The wheels show digit groups; this is the mark they add up to, written the way
            the feeds write it. It is also the only place a time over an hour reads
            correctly - the minutes wheel counts total minutes, so a 1:13:43 shows 73. */}
        <output className="mark-readout">{formatMark(value, table.spec)}</output>
      </div>
    </div>
  );
}
