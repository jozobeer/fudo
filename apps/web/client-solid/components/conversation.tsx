import { For, Match, Show, Switch, createEffect, createSignal } from 'solid-js'
import {
  plainText,
  type Conversation as ConversationState,
  type ConversationBlock,
} from '@jozo-harness/ui-view'
import { renderMarkdown } from '../../client/markdown.ts'
import { followsBottom } from '../../client/scroll.ts'
import type { SessionStore } from '../store.ts'

type ToolBlock = Extract<ConversationBlock, { kind: 'tool' }>

const Markdown = (props: { text: string }) => (
  <div class="body markdown" innerHTML={renderMarkdown(plainText(props.text))} />
)

const toolState = (status: ToolBlock['status']): string =>
  status === 'error' ? 'failed' : status === 'running' ? 'running' : 'done'

const ToolHead = (props: { block: ToolBlock }) => (
  <>
    <span class="tool-name">{props.block.name}</span>
    <span class="tool-summary">{props.block.summary}</span>
    <span class="tool-state">{toolState(props.block.status)}</span>
  </>
)

const Tool = (props: { block: ToolBlock }) => (
  <Show
    when={props.block.output !== ''}
    fallback={
      <article class={'block tool ' + props.block.status}>
        <div class="tool-head">
          <ToolHead block={props.block} />
        </div>
      </article>
    }
  >
    <article class={'block tool ' + props.block.status}>
      <details class="tool-card" open={props.block.status === 'error'}>
        <summary class="tool-head">
          <ToolHead block={props.block} />
        </summary>
        <pre class="tool-output">{plainText(props.block.output)}</pre>
      </details>
    </article>
  </Show>
)

const Block = (props: { block: ConversationBlock }) => (
  <Switch>
    <Match when={props.block.kind === 'user' ? props.block : undefined}>
      {(block) => (
        <article class="block user">
          <div class="role">you</div>
          <div class="body">{plainText(block().text)}</div>
        </article>
      )}
    </Match>
    <Match when={props.block.kind === 'assistant' ? props.block : undefined}>
      {(block) => (
        <article class="block assistant">
          <div class="role">agent</div>
          <Markdown text={block().text} />
        </article>
      )}
    </Match>
    <Match when={props.block.kind === 'tool' ? props.block : undefined}>
      {(block) => <Tool block={block()} />}
    </Match>
    <Match when={props.block.kind === 'ask' ? props.block : undefined}>
      {(block) => (
        <article class="block ask">
          <div
            class="ask-question markdown"
            innerHTML={renderMarkdown(plainText(block().question))}
          />
          <Show when={block().answer !== undefined}>
            <div class="ask-answer">{'answered: ' + (block().answer ?? '')}</div>
          </Show>
        </article>
      )}
    </Match>
    <Match when={props.block.kind === 'notice' ? props.block : undefined}>
      {(block) => (
        <article class={'block notice ' + block().level}>{plainText(block().text)}</article>
      )}
    </Match>
  </Switch>
)

const Welcome = () => (
  <section class="welcome">
    <h2>New session</h2>
    <p class="welcome-lead">Nothing has been said yet. Type below and press Enter.</p>
    <ul class="welcome-hints">
      <li>
        <code>/help</code> lists what a session answers; <code>/status</code> says where it stands
      </li>
      <li>a shell command asks before it runs</li>
      <li>
        the sheet on the right carries what the session works toward, its turns, jobs and settings
      </li>
    </ul>
  </section>
)

/** A session nobody has said anything to yet, and nothing waiting for an answer. */
const isEmpty = (conversation: ConversationState): boolean =>
  conversation.blocks.length === 0 &&
  conversation.live === '' &&
  conversation.approval === undefined &&
  conversation.ask === undefined

/**
 * The conversation column. It follows the tail while the reader is at the
 * bottom; reading further up keeps the place it was at.
 */
export const Conversation = (props: { store: SessionStore }) => {
  let element: HTMLElement | undefined
  const [atBottom, setAtBottom] = createSignal(true)

  createEffect(() => {
    // Reading the conversation is what subscribes this effect to every event.
    const conversation = props.store.state().conversation
    // The effect runs after the blocks land; a reader at the bottom follows them.
    if (element !== undefined && atBottom() && !isEmpty(conversation)) {
      element.scrollTop = element.scrollHeight
    }
  })

  return (
    <main
      id="conversation"
      tabindex="0"
      ref={(node) => {
        element = node
        node.addEventListener('scroll', () => setAtBottom(followsBottom(node)))
      }}
    >
      <Show when={!isEmpty(props.store.state().conversation)} fallback={<Welcome />}>
        <For each={props.store.state().conversation.blocks}>
          {(block) => <Block block={block} />}
        </For>
        <Show when={props.store.state().conversation.live !== ''}>
          <article class="block assistant live">
            <Markdown text={props.store.state().conversation.live} />
          </article>
        </Show>
      </Show>
    </main>
  )
}
