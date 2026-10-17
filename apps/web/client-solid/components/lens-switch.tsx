import { For } from 'solid-js'
import { LENSES, type Lens } from '../lens.ts'

const LABELS: Readonly<Record<Lens, string>> = { answers: 'Answers', timeline: 'Timeline' }

/** The strip's switch between the two ways the middle column reads a session. */
export const LensSwitch = (props: { lens: Lens; onChoose: (lens: Lens) => void }) => (
  <div class="lens" role="group" aria-label="How the session reads">
    <For each={LENSES}>
      {(lens) => (
        <button
          class="lens-option"
          type="button"
          data-lens={lens}
          aria-pressed={props.lens === lens}
          onClick={() => props.onChoose(lens)}
        >
          {LABELS[lens]}
        </button>
      )}
    </For>
  </div>
)
