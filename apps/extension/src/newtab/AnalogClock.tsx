import './analogClock.css';

const HOURS_PER_DIAL = 12;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const FULL_TURN = 360;

function ClockMarks() {
  return (
    <g data-deck="analog-marks">
      {Array.from({ length: HOURS_PER_DIAL }, (_, index) => (
        <path
          data-deck="analog-tick"
          key={index}
          d="M50 9V14"
          transform={`rotate(${(index * FULL_TURN) / HOURS_PER_DIAL} 50 50)`}
        />
      ))}
    </g>
  );
}

function ClockHands({ now, showSeconds }: { now: Date; showSeconds: boolean }) {
  const seconds = now.getSeconds();
  const minutes = now.getMinutes() + seconds / SECONDS_PER_MINUTE;
  const hours = (now.getHours() % HOURS_PER_DIAL) + minutes / MINUTES_PER_HOUR;
  return (
    <g data-deck="analog-hands">
      <path
        data-deck="analog-hour"
        d="M50 50V29"
        strokeWidth={3}
        transform={`rotate(${(hours * FULL_TURN) / HOURS_PER_DIAL} 50 50)`}
      />
      <path
        data-deck="analog-minute"
        d="M50 50V19"
        strokeWidth={2}
        transform={`rotate(${(minutes * FULL_TURN) / MINUTES_PER_HOUR} 50 50)`}
      />
      {showSeconds ? (
        <path
          data-deck="analog-second"
          d="M50 57V16"
          strokeWidth={1}
          transform={`rotate(${(seconds * FULL_TURN) / SECONDS_PER_MINUTE} 50 50)`}
        />
      ) : null}
    </g>
  );
}

export default function AnalogClock({
  now,
  label,
  showSeconds,
}: {
  now: Date;
  label: string;
  showSeconds: boolean;
}) {
  return (
    <>
      <span
        data-deck="clock-text"
        className="deck-analog-clock__sizing"
        aria-hidden="true"
      >
        {label}
      </span>
      <svg
        data-deck="analog-clock"
        className="deck-analog-clock"
        viewBox="0 0 100 100"
        role="img"
        aria-label={label}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
      >
        <title>{label}</title>
        <circle data-deck="analog-face" cx={50} cy={50} r={46} />
        <ClockMarks />
        <ClockHands now={now} showSeconds={showSeconds} />
        <circle
          data-deck="analog-center"
          cx={50}
          cy={50}
          r={2}
          fill="currentColor"
          stroke="none"
        />
      </svg>
    </>
  );
}
