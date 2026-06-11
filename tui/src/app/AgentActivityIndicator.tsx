/** @jsxImportSource @opentui/solid */
import { useTimeline } from '@opentui/solid';
import { Index, Show, createEffect, createSignal, onCleanup } from 'solid-js';

const BLOCK_COUNT = 10;
const ACTIVE_COUNT = 2;
const FRAME_COUNT = BLOCK_COUNT - ACTIVE_COUNT + 1;
const ANIMATION_DURATION_MS = 900;

function slotIsActive(frame: number, slot: number): boolean {
  return slot >= frame && slot < frame + ACTIVE_COUNT;
}

interface AgentActivityIndicatorProps {
  active: boolean;
  accentColor: string;
  mutedColor: string;
}

function AgentActivityIndicator(props: AgentActivityIndicatorProps) {
  const timeline = useTimeline({ autoplay: false });
  const [frame, setFrame] = createSignal(0);

  const animTarget = { _progress: 0 };

  timeline.add(animTarget, {
    _progress: 1,
    duration: ANIMATION_DURATION_MS,
    ease: 'linear',
    loop: true,
    onUpdate: (anim: { progress: number }) => {
      const f = Math.min(Math.floor(anim.progress * FRAME_COUNT), FRAME_COUNT - 1);
      setFrame(f);
    },
  });

  createEffect(() => {
    if (props.active) {
      if (!timeline.isPlaying) {
        timeline.restart();
      }
    } else {
      timeline.pause();
      setFrame(0);
    }
  });

  onCleanup(() => {
    timeline.pause();
    setFrame(0);
  });

  return (
    <Show when={props.active} fallback={null}>
      <Index each={Array.from({ length: BLOCK_COUNT })}>
        {(_, i) => (
          <text fg={slotIsActive(frame(), i) ? props.accentColor : props.mutedColor}>▰</text>
        )}
      </Index>
    </Show>
  );
}

export { AgentActivityIndicator };
export type { AgentActivityIndicatorProps };
