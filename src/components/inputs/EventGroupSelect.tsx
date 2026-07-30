import type { Gender } from '../../data/types';
import { eventGroupsFor, type EventGroup } from '../../data/events';

/**
 * 18 event groups per gender is too many for a toggle row, so this is a native
 * select — grouped into the three families a track & field athlete would look
 * under. Membership is by main event rather than by mark kind: a pole vault and a
 * long jump are both jumps even though one measures height and one distance.
 */
const JUMPS = ['High Jump', 'Pole Vault', 'Long Jump', 'Triple Jump'];
const THROWS = ['Shot Put', 'Discus Throw', 'Hammer Throw', 'Javelin Throw'];

function familyOf(group: EventGroup): 'Track' | 'Jumps' | 'Throws' {
  if (JUMPS.includes(group.mainEvent)) return 'Jumps';
  if (THROWS.includes(group.mainEvent)) return 'Throws';
  return 'Track';
}

const FAMILIES = ['Track', 'Jumps', 'Throws'] as const;

export function EventGroupSelect({
  value,
  gender,
  onChange,
  label = 'Event',
}: {
  value: EventGroup;
  gender: Gender;
  onChange: (g: EventGroup) => void;
  label?: string;
}) {
  const groups = eventGroupsFor(gender);
  return (
    <label className="field">
      <span>{label}</span>
      <select
        value={value.slug}
        aria-label={label}
        onChange={(e) => {
          const next = groups.find((g) => g.slug === e.target.value);
          if (next) onChange(next);
        }}
      >
        {FAMILIES.map((family) => {
          const members = groups.filter((g) => familyOf(g) === family);
          if (members.length === 0) return null;
          return (
            <optgroup key={family} label={family}>
              {members.map((g) => (
                <option key={g.slug} value={g.slug}>
                  {g.mainEvent}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </label>
  );
}
