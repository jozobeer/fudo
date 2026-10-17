import { For, Show, createMemo } from 'solid-js'
import { changedFilesOf, editsOf, type FileEdit } from '../edits.ts'
import type { SessionStore } from '../store.ts'

/** One change as a diff: the lines taken away, then the lines put in. */
const Edit = (props: { edit: FileEdit }) => (
  <section class="edit">
    <div class="edit-head">
      <span>{props.edit.tool + ' · turn ' + String(props.edit.turn)}</span>
      <span class="edit-result">{props.edit.result}</span>
    </div>
    <pre class="diff">
      <For each={props.edit.removed}>{(line) => <span class="diff-del">{'- ' + line}</span>}</For>
      <For each={props.edit.added}>{(line) => <span class="diff-add">{'+ ' + line}</span>}</For>
    </pre>
  </section>
)

/**
 * The session's changes, file by file: the list of what it wrote, and the
 * edits of the one the reader picked, in the order they happened.
 */
export const Review = (props: { store: SessionStore; path: string | undefined }) => {
  const turns = createMemo(() => props.store.state().trace)
  const files = () => changedFilesOf(turns())
  const picked = () => props.path ?? files()[0]
  return (
    <>
      <h2 class="pane-title">Changes</h2>
      <Show
        when={files().length > 0}
        fallback={<div class="run-empty">this session has not written a file</div>}
      >
        <nav class="review-files" aria-label="Changed files">
          <For each={files()}>
            {(path) => (
              <button
                class={'review-file' + (path === picked() ? ' active' : '')}
                type="button"
                onClick={() => props.store.showPane({ kind: 'changes', path })}
              >
                {path}
              </button>
            )}
          </For>
        </nav>
        <Show when={picked()}>
          {(path) => <For each={editsOf(turns(), path())}>{(edit) => <Edit edit={edit} />}</For>}
        </Show>
      </Show>
    </>
  )
}
