import {
  assessPassword,
  strengthSteps,
  STRENGTH_LABELS,
  type StrengthBand,
} from '../password-strength';

const BAR: Record<StrengthBand, string> = {
  weak: 'bg-red-500',
  fair: 'bg-amber-500',
  good: 'bg-lime-600',
  strong: 'bg-green-600',
};

const TEXT: Record<StrengthBand, string> = {
  weak: 'text-red-700',
  fair: 'text-amber-700',
  good: 'text-lime-800',
  strong: 'text-green-800',
};

/**
 * Advice on the password being chosen. Never a gate.
 *
 * The verdict is always written out as a word as well as drawn as a bar, because colour
 * alone carries no meaning to somebody who cannot distinguish red from green — and because
 * "three bars" means nothing without a scale beside it.
 *
 * `role="status"` announces the band when it changes rather than on every keystroke: the
 * text only changes when the assessment crosses a boundary, so a screen reader hears
 * "Strong" once instead of a running commentary on typing.
 */
export function PasswordStrength({
  password,
  context,
}: {
  password: string;
  /** What the person has already typed on this form, to catch a password made of it. */
  context: readonly string[];
}) {
  const assessment = assessPassword(password, context);
  if (!assessment) return null;

  const steps = strengthSteps(assessment.band);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={`h-1 flex-1 rounded-full ${
              step <= steps ? BAR[assessment.band] : 'bg-slate-200'
            }`}
          />
        ))}
      </div>

      <p role="status" className="text-xs text-slate-600">
        <span className={`font-medium ${TEXT[assessment.band]}`}>
          {STRENGTH_LABELS[assessment.band]}
        </span>
        {' — '}
        {assessment.advice}
      </p>
    </div>
  );
}
