// tiny-d20's client code (specs §8.10): one custom node, packed by `vtt-plugin pack`.
import { defineClient, useField, useTranslate, type NodeProps } from '@vtt/sdk/client';

const toNumber = (value: unknown): number => (typeof value === 'number' ? value : 0);

/** Hit points as a bar: `props.path` names an object with `value` and `max`. */
function HpBar({ props }: NodeProps) {
  const path = typeof props.path === 'string' ? props.path : 'hp';
  const label = typeof props.label === 'string' ? props.label : 'field.hp';
  const [value] = useField(`${path}.value`);
  const [max] = useField(`${path}.max`);
  const t = useTranslate();
  const current = toNumber(value);
  const top = Math.max(1, toNumber(max));
  const filled = Math.min(100, Math.max(0, (current / top) * 100));
  return (
    <div
      className="hpBar"
      role="meter"
      aria-label={t(label)}
      aria-valuemin={0}
      aria-valuemax={top}
      aria-valuenow={current}
      data-low={current <= top / 4 || undefined}
    >
      <div className="hpBar-track">
        <div className="hpBar-fill" style={{ width: `${String(filled)}%` }} />
      </div>
      <span className="hpBar-text">
        {current} / {top}
      </span>
    </div>
  );
}

export default defineClient({ nodes: { hpBar: HpBar } });
