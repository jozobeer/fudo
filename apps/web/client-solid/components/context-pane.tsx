import { For, Match, Show, Switch } from 'solid-js'
import type { RunStateView, SettingsView } from '../../src/shared/rpc.ts'
import type { Pane } from '../../client/state.ts'
import { THEMES, type Theme } from '../../client/theme.ts'
import type { TurnView } from '../../client/trajectory.ts'
import { childSessionsOf } from '../lib.ts'
import type { SessionStore } from '../store.ts'

const Goal = (props: { goal: RunStateView['goal'] }) => (
  <Show when={props.goal} fallback={<div class="run-empty">no goal</div>}>
    {(goal) => (
      <div class="run-goal">
        <span class="run-objective">{goal().objective}</span>
        <span class={'run-phase ' + goal().phase}>{goal().phase}</span>
        <span class="run-rounds">{String(goal().rounds) + '/' + String(goal().maxRounds)}</span>
      </div>
    )}
  </Show>
)

const Run = (props: { store: SessionStore }) => {
  const run = () => props.store.state().run
  return (
    <>
      <h2 class="pane-title">Run</h2>
      <Show when={run()} fallback={<div class="run-empty">reading…</div>}>
        {(state) => (
          <>
            <Goal goal={state().goal} />
            <Show when={state().schedules.length > 0}>
              <ul class="run-schedules">
                <For each={state().schedules}>
                  {(schedule) => (
                    <li>
                      <span class="run-when">{schedule.when}</span>
                      <span class="run-prompt">{schedule.prompt}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={state().jobs.length > 0}>
              <ul class="run-jobs">
                <For each={state().jobs}>
                  {(job) => (
                    <li>
                      <button
                        class={'run-job ' + (job.running ? 'running' : 'done')}
                        type="button"
                        onClick={() => props.store.openJob(job.id)}
                      >
                        <span class="run-job-state">{job.running ? 'running' : 'done'}</span>
                        <span class="run-job-command">{job.command}</span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <Show when={childSessionsOf(props.store.state().conversation.blocks).length > 0}>
              <ul class="run-children">
                <For each={childSessionsOf(props.store.state().conversation.blocks)}>
                  {(id) => (
                    <li>
                      <button
                        class="run-child"
                        type="button"
                        onClick={() => props.store.moveTo(id)}
                      >
                        {'subagent · ' + id.slice(0, 8)}
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </>
        )}
      </Show>
    </>
  )
}

const row = (name: string, value: string) => (
  <div class="panel-row">
    <span class="panel-name">{name}</span>
    <span class="panel-value">{value}</span>
  </div>
)

const Settings = (props: { store: SessionStore; settings: SettingsView | undefined }) => (
  <>
    <h2 class="pane-title">Settings</h2>
    <span class="pane-label">theme</span>
    <div class="theme-choice">
      <For each={THEMES}>
        {(theme: Theme) => (
          <button
            class={'theme' + (theme === props.store.state().theme ? ' active' : '')}
            type="button"
            onClick={() => props.store.chooseTheme(theme)}
          >
            {theme}
          </button>
        )}
      </For>
    </div>
    <Show when={props.settings} fallback={<div class="card-hint">reading the settings…</div>}>
      {(settings) => (
        <>
          <span class="pane-label">run</span>
          <div class="panel-rows">
            {row('model', settings().model)}
            {row('effort', settings().effort === '' ? '(the provider chooses)' : settings().effort)}
            {row('cwd', settings().cwd)}
            {row('sessions', settings().sessionRoot)}
            {row('settings', settings().settingsPath === '' ? '(none)' : settings().settingsPath)}
          </div>
          <Show
            when={props.store.state().models.length > 0}
            fallback={
              <div class="panel-actions">
                <button type="button" onClick={() => props.store.askModels()}>
                  List models
                </button>
              </div>
            }
          >
            <div class="panel-actions">
              <select id="model-choice">
                <For each={props.store.state().models}>
                  {(route) => <option value={route}>{route}</option>}
                </For>
              </select>
              <button
                class="primary"
                type="button"
                onClick={() => {
                  const choice = document.getElementById('model-choice')
                  if (choice instanceof HTMLSelectElement && choice.value !== '') {
                    props.store.setModel(choice.value)
                  }
                }}
              >
                Use for later runs
              </button>
            </div>
            <div class="card-hint">the next run reads it from the settings file</div>
          </Show>
        </>
      )}
    </Show>
  </>
)

const durationOf = (turn: TurnView): string =>
  turn.endedAt === undefined ? 'running' : ((turn.endedAt - turn.startedAt) / 1000).toFixed(1) + 's'

const Trajectory = (props: { turns: ReadonlyArray<TurnView> }) => (
  <>
    <Show
      when={props.turns.length > 0}
      fallback={<div class="card-hint">this session has not run a turn yet</div>}
    >
      <ul class="turns">
        <For each={props.turns}>
          {(turn) => (
            <li class={'turn' + (turn.endedAt === undefined ? ' open' : '')}>
              <span class="turn-number">{'turn ' + String(turn.turn)}</span>
              <span class="turn-duration">{durationOf(turn)}</span>
              <span class="turn-counts">
                {String(turn.steps) + ' steps · ' + String(turn.tools) + ' calls'}
              </span>
              <span class="turn-outcome">{turn.outcome === '' ? '—' : turn.outcome}</span>
            </li>
          )}
        </For>
      </ul>
    </Show>
  </>
)

const Job = (props: { store: SessionStore; pane: Extract<Pane, { kind: 'job' }> }) => (
  <>
    <h2 class="pane-title">{'Job ' + props.pane.id.slice(0, 8)}</h2>
    <Show when={props.pane.detail} fallback={<div class="card-hint">reading the job…</div>}>
      {(detail) => (
        <>
          <div class="panel-rows">
            {row('command', detail().command)}
            {row('state', detail().running ? 'running' : 'done')}
          </div>
          <pre class="job-output">
            {detail().output === '' ? '(no output yet)' : detail().output}
          </pre>
          <div class="panel-actions">
            <Show when={detail().running}>
              <button type="button" onClick={() => props.store.stopJob(props.pane.id)}>
                Stop
              </button>
            </Show>
          </div>
        </>
      )}
    </Show>
  </>
)

const PANES = [
  { kind: 'run', label: 'run' },
  { kind: 'settings', label: 'settings' },
  { kind: 'trajectory', label: 'turns' },
] as const

/** The right column: what the session runs toward, is set to, did, or one job. */
export const ContextPane = (props: { store: SessionStore }) => {
  const pane = () => props.store.state().pane
  const active = (kind: 'run' | 'settings' | 'trajectory'): boolean => pane()?.kind === kind
  const toggle = (kind: 'run' | 'settings' | 'trajectory'): void =>
    props.store.showPane(active(kind) ? undefined : { kind })
  return (
    <>
      <header class="context-head">
        <nav class="tabs" aria-label="What the pane shows">
          <For each={PANES}>
            {(entry) => (
              <button
                class={'tab' + (active(entry.kind) ? ' active' : '')}
                type="button"
                onClick={() => toggle(entry.kind)}
              >
                {entry.label}
              </button>
            )}
          </For>
          <Show
            when={pane()?.kind === 'job' ? (pane() as Extract<Pane, { kind: 'job' }>) : undefined}
          >
            {(job) => (
              <button class="tab active" type="button">
                {'job ' + job().id.slice(0, 8)}
              </button>
            )}
          </Show>
        </nav>
        <button
          class="pane-close"
          type="button"
          aria-label="hide the pane"
          onClick={() => props.store.showPane(undefined)}
        >
          ×
        </button>
      </header>
      <div class="context-body">
        <Switch>
          <Match when={pane()?.kind === 'run'}>
            <Run store={props.store} />
          </Match>
          <Match when={pane()?.kind === 'settings'}>
            <Settings store={props.store} settings={props.store.state().settings} />
          </Match>
          <Match when={pane()?.kind === 'trajectory'}>
            <Trajectory turns={props.store.state().turns} />
          </Match>
          <Match
            when={pane()?.kind === 'job' ? (pane() as Extract<Pane, { kind: 'job' }>) : undefined}
          >
            {(job) => <Job store={props.store} pane={job()} />}
          </Match>
        </Switch>
      </div>
    </>
  )
}
