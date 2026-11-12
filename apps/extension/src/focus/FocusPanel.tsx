import { useEffect, useRef, useState } from 'react';
import type { Card, Deck, Page } from 'deck-schema';
import type { DeckRepository } from '../storage/repository';
import { panelStrings as strings } from '../i18n/panelStrings';
import { taskRecords } from '../tasks/taskRecords';
import { useFocus } from './useFocus';
import {
  DEFAULT_FOCUS_MINUTES,
  MAX_FOCUS_MINUTES,
  FOCUS_MINUTE_MS,
  FOCUS_SECOND_MS,
  focusElapsed,
  focusSummary,
  type FocusAction,
  type FocusState,
} from './model';
import './focus.css';

interface FocusProps {
  isOpen: boolean;
  repository: Pick<DeckRepository, 'changeFocus'>;
  cards: Card[];
  decks: Deck[];
  pages: Page[];
  onError: (message: string) => void;
}
type Controls = {
  state: FocusState | null;
  isSaving: boolean;
  run: (action: FocusAction) => Promise<void>;
};

function countdown(milliseconds: number): string {
  const seconds = Math.ceil(milliseconds / FOCUS_SECOND_MS);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function focusMinutes(milliseconds: number): string {
  return strings.focusMinutes(
    Math.floor((milliseconds / FOCUS_MINUTE_MS) * 10) / 10,
  );
}

function DurationField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {strings.focusDuration}
      <input
        data-deck="focus-duration"
        type="number"
        required
        min={1}
        max={MAX_FOCUS_MINUTES}
        step={1}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function TaskField({
  value,
  onChange,
  choices,
}: {
  value: string;
  onChange: (value: string) => void;
  choices: { id: string; title: string }[];
}) {
  return (
    <div className="deck-focus__field" data-deck="focus-field">
      <label htmlFor="deck-focus-task">{strings.focusTask}</label>
      <select
        id="deck-focus-task"
        data-deck="focus-task"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        <option value="">{strings.focusStandalone}</option>
        {choices.map((task) => (
          <option key={task.id} value={task.id}>
            {task.title}
          </option>
        ))}
      </select>
    </div>
  );
}

function FocusFields({
  state,
  isSaving,
  run,
  tasks,
  minutes,
  setMinutes,
}: Controls & {
  tasks: Card[];
  minutes: string;
  setMinutes: (value: string) => void;
}) {
  const [taskId, setTaskId] = useState('');
  const active = state?.active;
  const choices = tasks.map(({ id, title }) => ({ id, title }));
  if (active?.task && !choices.some(({ id }) => id === active.task?.id))
    choices.push(active.task);
  return (
    <form
      data-deck="focus-form"
      onSubmit={(event) => {
        event.preventDefault();
        void run({
          type: 'start',
          minutes: Number(minutes),
          ...(taskId ? { taskId } : {}),
        });
      }}
    >
      <fieldset disabled={!state || Boolean(active) || isSaving}>
        <DurationField value={minutes} onChange={setMinutes} />
        <TaskField
          value={active ? (active.task?.id ?? '') : taskId}
          onChange={setTaskId}
          choices={choices}
        />
      </fieldset>
      {!active ? (
        <button
          data-deck="focus-start"
          type="submit"
          disabled={!state || isSaving}
        >
          {strings.focusStart}
        </button>
      ) : null}
    </form>
  );
}

function FocusActions({ state, isSaving, run }: Controls) {
  const active = state?.active;
  if (!active) return null;
  const isPaused = active.runningSince === null;
  return (
    <div data-deck="focus-controls" className="deck-focus__controls">
      <button
        data-deck="focus-pause"
        type="button"
        disabled={isSaving}
        aria-label={isPaused ? strings.focusResume : strings.focusPause}
        onClick={() =>
          void run({ type: isPaused ? 'resume' : 'pause', id: active.id })
        }
      >
        {isPaused ? strings.focusResume : strings.focusPause}
      </button>
      <button
        data-deck="focus-stop"
        type="button"
        disabled={isSaving}
        onClick={() => void run({ type: 'stop', id: active.id })}
      >
        {strings.focusStop}
      </button>
    </div>
  );
}

function FocusTotals({ state, now }: { state: FocusState; now: number }) {
  const summary = focusSummary(state, now);
  return (
    <section
      data-deck="focus-history"
      className="deck-focus__history"
      aria-label={strings.focusTotals}
    >
      <dl data-deck="focus-summary">
        <div>
          <dt>{strings.focusTotal}</dt>
          <dd>{focusMinutes(summary.totalMs)}</dd>
        </div>
        <div>
          <dt>{strings.focusDailyStreak}</dt>
          <dd>{strings.focusStreak(summary.streak)}</dd>
        </div>
      </dl>
      <h3>{strings.focusByTask}</h3>
      {summary.byTask.length ? (
        <ul>
          {summary.byTask.map(({ task, elapsedMs }) => (
            <li key={task.id}>
              <span>{task.title}</span>
              <strong>{focusMinutes(elapsedMs)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p>{strings.focusNoTaskTime}</p>
      )}
    </section>
  );
}

function FocusClock({
  state,
  now,
  minutes,
}: {
  state: FocusState | null;
  now: number;
  minutes: number;
}) {
  const active = state?.active;
  const remaining = active
    ? active.durationMs - focusElapsed(active, now)
    : minutes * FOCUS_MINUTE_MS;
  const status = active
    ? active.runningSince === null
      ? strings.focusPaused
      : strings.focusRunning
    : strings.focusReady;
  return (
    <div className="deck-focus__timer" data-deck="focus-timer">
      <output
        data-deck="focus-countdown"
        role="timer"
        aria-label={strings.focusRemaining}
        aria-live="off"
      >
        {countdown(remaining)}
      </output>
      <p role="status">{status}</p>
      {active?.task ? <p>{active.task.title}</p> : null}
    </div>
  );
}

function FocusEditor({
  controls,
  tasks,
  now,
}: {
  controls: Controls;
  tasks: Card[];
  now: number;
}) {
  const [minutes, setMinutes] = useState(
    String(controls.state?.minutes ?? DEFAULT_FOCUS_MINUTES),
  );
  const value = Number(minutes);
  const preview =
    Number.isInteger(value) && value >= 1 && value <= MAX_FOCUS_MINUTES
      ? value
      : (controls.state?.minutes ?? DEFAULT_FOCUS_MINUTES);
  return (
    <>
      <FocusClock state={controls.state} now={now} minutes={preview} />
      <FocusFields
        {...controls}
        tasks={tasks}
        minutes={minutes}
        setMinutes={setMinutes}
      />
    </>
  );
}

function usePanelClock(isOpen: boolean) {
  const [now, setNow] = useState(Date.now);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (isOpen) panel.current?.focus();
  }, [isOpen]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), FOCUS_SECOND_MS);
    return () => window.clearInterval(timer);
  }, []);
  return { now, panel };
}

export default function FocusPanel({
  isOpen,
  repository,
  cards,
  decks,
  pages,
  onError,
}: FocusProps) {
  const controls = useFocus(repository, onError);
  const { state } = controls;
  const { now, panel } = usePanelClock(isOpen);
  return (
    <section
      ref={panel}
      data-deck="focus"
      className="deck-focus"
      tabIndex={-1}
      aria-label={strings.focus}
      aria-busy={!state}
    >
      <header>
        <h2>{strings.focus}</h2>
        <p>{strings.focusDescription}</p>
      </header>
      <FocusEditor
        key={state?.minutes ?? DEFAULT_FOCUS_MINUTES}
        controls={controls}
        now={now}
        tasks={taskRecords(cards, decks, pages).filter((card) => !card.done)}
      />
      <FocusActions {...controls} />
      <p className="deck-focus__hint">{strings.focusAccounting}</p>
      {state ? <FocusTotals state={state} now={now} /> : null}
    </section>
  );
}
