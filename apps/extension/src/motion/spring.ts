const SPRING_DURATION_MS = 480;
const SPRING_FRAME_COUNT = 20;

function springProgress(
  time: number,
  stiffness: number,
  damping: number,
): number {
  const decay = damping / 2;
  const frequency = Math.sqrt(Math.max(stiffness - decay * decay, 0));
  if (frequency === 0) return 1 - Math.exp(-decay * time) * (1 + decay * time);
  return (
    1 -
    Math.exp(-decay * time) *
      (Math.cos(frequency * time) +
        (decay / frequency) * Math.sin(frequency * time))
  );
}

export function springFrames(
  stiffness: number,
  damping: number,
  opening: boolean,
  distance: string,
  fade = false,
): Keyframe[] {
  return Array.from({ length: SPRING_FRAME_COUNT + 1 }, (_, index) => {
    const progress =
      index === SPRING_FRAME_COUNT
        ? 1
        : springProgress(
            (index / SPRING_FRAME_COUNT) * (SPRING_DURATION_MS / 1_000),
            stiffness,
            damping,
          );
    const offset = opening ? 1 - progress : progress;
    return {
      offset: index / SPRING_FRAME_COUNT,
      transform: `translateY(calc(${distance} * ${offset}))`,
      ...(fade
        ? {
            opacity: opening
              ? Math.min(progress, 1)
              : Math.max(1 - progress, 0),
          }
        : {}),
    };
  });
}

export function playSpring(
  element: HTMLElement,
  opening: boolean,
  distance: string,
  fade = false,
): Animation | null {
  if (
    !element.animate ||
    matchMedia('(prefers-reduced-motion: reduce)').matches
  )
    return null;
  const tokens = getComputedStyle(document.documentElement);
  const stiffness =
    Number(tokens.getPropertyValue('--deck-motion-spring-stiffness')) || 380;
  const damping =
    Number(tokens.getPropertyValue('--deck-motion-spring-damping')) || 32;
  element.style.animation = 'none';
  element.style.transform = opening
    ? 'translateY(0)'
    : `translateY(${distance})`;
  const animation = element.animate(
    springFrames(stiffness, damping, opening, distance, fade),
    {
      duration: SPRING_DURATION_MS,
      fill: 'forwards',
    },
  );
  void animation.finished.catch((error: unknown) => {
    if (!(error instanceof Error && error.name === 'AbortError')) throw error;
  });
  return animation;
}

export { SPRING_DURATION_MS };
