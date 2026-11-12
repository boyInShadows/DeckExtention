import { IdSchema, TitleSchema, TimestampSchema } from 'deck-schema';
import { z } from 'zod';
import { panelStrings as strings } from '../i18n/panelStrings';
import { localDay } from '../storage/resurface';

export const FOCUS_KEY = 'focus';
export const FOCUS_CHANNEL = 'deck-focus';
export const FOCUS_MINUTE_MS = 60_000;
export const FOCUS_SECOND_MS = 1_000;
export const DEFAULT_FOCUS_MINUTES = 25;
export const MAX_FOCUS_MINUTES = 180;
const MinutesSchema = z.number().int().min(1).max(MAX_FOCUS_MINUTES);
const ElapsedSchema = z
  .number()
  .int()
  .nonnegative()
  .max(MAX_FOCUS_MINUTES * FOCUS_MINUTE_MS);
const TaskSchema = z.strictObject({ id: IdSchema, title: TitleSchema });
const DaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((day) => {
    const date = new Date(`${day}T00:00:00Z`);
    return (
      Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day
    );
  });
const sessionFields = {
  id: IdSchema,
  task: TaskSchema.nullable(),
  startedAt: TimestampSchema,
  durationMs: z
    .number()
    .int()
    .min(FOCUS_MINUTE_MS)
    .max(MAX_FOCUS_MINUTES * FOCUS_MINUTE_MS)
    .multipleOf(FOCUS_MINUTE_MS),
  elapsedMs: ElapsedSchema,
};
const ActiveSchema = z
  .strictObject({
    ...sessionFields,
    runningSince: TimestampSchema.nullable(),
  })
  .refine(
    (session) =>
      session.elapsedMs < session.durationMs &&
      (session.runningSince === null ||
        session.runningSince >= session.startedAt),
  );
const EntrySchema = z
  .strictObject({
    ...sessionFields,
    endedAt: TimestampSchema,
    day: DaySchema,
    isCompleted: z.boolean(),
  })
  .refine(
    (entry) =>
      entry.endedAt >= entry.startedAt &&
      entry.elapsedMs <= entry.durationMs &&
      entry.elapsedMs <= entry.endedAt - entry.startedAt &&
      entry.isCompleted === (entry.elapsedMs === entry.durationMs),
  );

export const FocusStateSchema = z
  .strictObject({
    minutes: MinutesSchema,
    active: ActiveSchema.nullable(),
    history: z.array(EntrySchema),
    unreadId: IdSchema.nullable(),
  })
  .refine((state) => {
    const ids = state.history.map(({ id }) => id);
    return (
      new Set(ids).size === ids.length &&
      (!state.active || !ids.includes(state.active.id)) &&
      (!state.unreadId ||
        state.history.some(
          (entry) => entry.id === state.unreadId && entry.isCompleted,
        ))
    );
  });

export type FocusState = z.infer<typeof FocusStateSchema>;
export type FocusSession = z.infer<typeof ActiveSchema>;
export type FocusEntry = z.infer<typeof EntrySchema>;
export type FocusTask = z.infer<typeof TaskSchema>;
export const FocusActionSchema = z.union([
  z.strictObject({
    type: z.literal('start'),
    minutes: MinutesSchema,
    taskId: IdSchema.optional(),
  }),
  z.strictObject({ type: z.enum(['pause', 'resume', 'stop']), id: IdSchema }),
  z.strictObject({ type: z.literal('sync') }),
]);
export type FocusAction = z.infer<typeof FocusActionSchema>;

export function emptyFocus(): FocusState {
  return {
    minutes: DEFAULT_FOCUS_MINUTES,
    active: null,
    history: [],
    unreadId: null,
  };
}

export function focusElapsed(session: FocusSession, now: number): number {
  const running =
    session.runningSince === null ? 0 : Math.max(0, now - session.runningSince);
  return Math.min(session.durationMs, session.elapsedMs + running);
}

function finishFocus(
  state: FocusState,
  session: FocusSession,
  now: number,
): FocusState {
  const elapsedMs = focusElapsed(session, now);
  const isCompleted = elapsedMs === session.durationMs;
  const endedAt =
    isCompleted && session.runningSince !== null
      ? session.runningSince + session.durationMs - session.elapsedMs
      : Math.max(now, session.startedAt + elapsedMs);
  const { id, task, startedAt, durationMs } = session;
  return {
    ...state,
    active: null,
    history: [
      ...state.history,
      {
        id,
        task,
        startedAt,
        durationMs,
        elapsedMs,
        endedAt,
        isCompleted,
        day: localDay(endedAt),
      },
    ],
    unreadId: isCompleted ? session.id : state.unreadId,
  };
}

function startFocus(
  state: FocusState,
  minutes: number,
  now: number,
  id: string | undefined,
  task: FocusTask | null,
): FocusState {
  if (state.active) throw new Error(strings.focusAlreadyRunning);
  return FocusStateSchema.parse({
    ...state,
    minutes: MinutesSchema.parse(minutes),
    active: {
      id,
      task,
      startedAt: now,
      durationMs: minutes * FOCUS_MINUTE_MS,
      elapsedMs: 0,
      runningSince: now,
    },
  });
}

export function transitionFocus(
  stored: FocusState,
  action: FocusAction,
  now: number,
  id?: string,
  task: FocusTask | null = null,
): FocusState {
  TimestampSchema.parse(now);
  let state = stored;
  if (
    state.active &&
    focusElapsed(state.active, now) === state.active.durationMs
  )
    state = finishFocus(state, state.active, now);
  if (action.type === 'sync') return state;
  if (action.type === 'start')
    return startFocus(state, action.minutes, now, id, task);
  const session = state.active;
  if (!session && state.history.some((entry) => entry.id === action.id))
    return state;
  if (!session || session.id !== action.id)
    throw new Error(strings.focusChanged);
  if (action.type === 'stop') return finishFocus(state, session, now);
  const elapsedMs = focusElapsed(session, now);
  return {
    ...state,
    active: {
      ...session,
      elapsedMs,
      runningSince:
        action.type === 'pause'
          ? null
          : Math.max(now, session.startedAt + elapsedMs),
    },
  };
}

export function focusSummary(state: FocusState, now: number) {
  const days = new Set(
    state.history
      .filter(({ isCompleted }) => isCompleted)
      .map(({ day }) => day),
  );
  const date = new Date(now);
  if (!days.has(localDay(date.getTime()))) date.setDate(date.getDate() - 1);
  let streak = 0;
  while (days.has(localDay(date.getTime()))) {
    streak += 1;
    date.setDate(date.getDate() - 1);
  }
  const activeMs = state.active ? focusElapsed(state.active, now) : 0;
  const totals = new Map<string, { task: FocusTask; elapsedMs: number }>();
  const sessions = [
    ...state.history,
    ...(state.active ? [{ ...state.active, elapsedMs: activeMs }] : []),
  ];
  for (const { task, elapsedMs } of sessions) {
    if (task)
      totals.set(task.id, {
        task,
        elapsedMs: (totals.get(task.id)?.elapsedMs ?? 0) + elapsedMs,
      });
  }
  return {
    streak,
    byTask: [...totals.values()],
    totalMs: state.history.reduce(
      (total, entry) => total + entry.elapsedMs,
      activeMs,
    ),
  };
}
