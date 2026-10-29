const TAP_MS = 300;

export interface DoubleMetaState {
  downAt: number | null;
  firstTapAt: number | null;
  secondTap: boolean;
}

export type DoubleMetaEvent =
  | { type: "keydown" | "keyup"; key: string; at: number; blocked?: boolean; repeat?: boolean }
  | { type: "cancel" };

export const initialDoubleMetaState: DoubleMetaState = {
  downAt: null,
  firstTapAt: null,
  secondTap: false,
};

export function updateDoubleMeta(
  state: DoubleMetaState,
  event: DoubleMetaEvent,
): { state: DoubleMetaState; triggered: boolean } {
  if (event.type === "cancel" || event.blocked) {
    return { state: initialDoubleMetaState, triggered: false };
  }

  if (event.key !== "Meta") {
    return { state: initialDoubleMetaState, triggered: false };
  }

  if (event.type === "keydown") {
    if (event.repeat || state.downAt !== null) return { state, triggered: false };
    const secondTap = state.firstTapAt !== null && event.at - state.firstTapAt <= TAP_MS;
    return {
      state: {
        downAt: event.at,
        firstTapAt: secondTap ? state.firstTapAt : null,
        secondTap,
      },
      triggered: false,
    };
  }

  if (state.downAt === null || event.at - state.downAt > TAP_MS) {
    return { state: initialDoubleMetaState, triggered: false };
  }
  if (state.secondTap) {
    return { state: initialDoubleMetaState, triggered: true };
  }
  return {
    state: { downAt: null, firstTapAt: event.at, secondTap: false },
    triggered: false,
  };
}
