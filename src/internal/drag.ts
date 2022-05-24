interface DragOptions {
  /**
   * When an initial event is passed, the first drag will be triggered immediately using the coordinates therein. This
   * is useful when the drag is initiated by a mousedown/touchstart event but you want the initial "click" to activate
   * a drag (e.g. positioning a handle initially at the click target).
   */
  initialEvent: PointerEvent;
}

export function drag(container: HTMLElement, onMove: (x: number, y: number) => void, options?: Partial<DragOptions>) {
  function move(pointerEvent: PointerEvent) {
    const dims = container.getBoundingClientRect();
    const defaultView = container.ownerDocument.defaultView!;
    const offsetX = dims.left + defaultView.pageXOffset;
    const offsetY = dims.top + defaultView.pageYOffset;
    const x = pointerEvent.pageX - offsetX;
    const y = pointerEvent.pageY - offsetY;

    onMove(x, y);
  }

  function stop() {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', stop);
  }

  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerup', stop);

  // If an initial event is set, trigger the first drag immediately
  if (options?.initialEvent) {
    move(options.initialEvent);
  }
}
