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
          {wheels.map((wheel, i) => {
            if (wheel.hidden) return null;
            const label = (o: number) =>
              wheel.pad ? String(o).padStart(wheel.pad, '0') : String(o);

            // The cascade can leave a wheel with exactly one reachable value: the 10,000m
            // book lists roughly one mark per second, so for 79% of its minute:second
            // pairs the hundredths are fully determined. Rendering that as a spinner
            // invites a drag that cannot do anything, so show the digit instead. The slot
            // keeps its place either way, so the row does not reflow.
            if (wheel.options.length === 1) {
              return (
                <div className="wheel-fixed" key={wheel.key} aria-label={wheel.key} role="img">
                  {label(wheel.options[0])}
                </div>
              );
            }

            return (
              <WheelPicker
                key={wheel.key}
                options={wheel.options.map<WheelOption>((o) => ({
                  value: o,
                  label: label(o),
                }))}
                value={selection[i]}
                onChange={(next) => handle(i, next)}
                ariaLabel={wheel.key}
                rows={rows}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
