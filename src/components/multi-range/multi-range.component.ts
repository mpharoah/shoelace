import { html } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { property, query, queryAll } from 'lit/decorators.js';
import ShoelaceElement from '../../internal/shoelace-element.js';
import styles from './multi-range.styles.js';
import type { CSSResultGroup, PropertyValues } from 'lit';

const numericSort = function (a: number, b: number): number {
  return a - b;
};

const arraysDiffer = function (a: readonly number[], b: readonly number[]): boolean {
  a ||= [];
  b ||= [];
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return true;
  }
  return false;
};

/**
 * @summary Multi-Ranges allow the user to select multiple values within a given range using a slider with multiple handles.
 * @documentation https://shoelace.style/components/multi-range
 * @status experimental
 * @since next
 *
 * @event sl-change - Emitted when an alteration to the control's value is committed by the user.
 * @event sl-input - Emitted when the control receives input.
 *
 * @cssproperty --thumb-size - The size of the thumb.
 * @cssproperty --track-color-active - The color of the portion of the track that represents the current value.
 * @cssproperty --track-color-inactive - The of the portion of the track that represents the remaining value.
 * @cssproperty --track-height - The height of the track.
 */
export default class SlMultiRange extends ShoelaceElement {
  static styles: CSSResultGroup = [styles];

  /** The range's label. */
  @property() label = '';

  /** Disables the range. */
  @property({ type: Boolean, reflect: true }) disabled = false;

  /** The minimum acceptable value of the range. */
  @property({ type: Number }) min = 0;

  /** The maximum acceptable value of the range. */
  @property({ type: Number }) max = 100;

  /** The interval at which the range will increase and decrease. */
  @property({ type: Number }) step = 1;

  /** The current values of the range */
  @property({ type: Array })
  set value(value: readonly number[]) {
    this.#value = value || [];
  }
  get value() {
    return this.#value;
  }

  /**
   * A function used to format the tooltip's value. The range's value is passed as the first and only argument. The
   * function should return a string to display in the tooltip.
   */
  @property({ attribute: false }) tooltipFormatter: (value: number) => string = (value: number) => value.toString();

  @query('.base') baseDiv: HTMLDivElement;
  @query('.active-track') activeTrack: HTMLDivElement;
  @queryAll('.handle') handles: NodeListOf<HTMLDivElement>;

  #value: readonly number[] = [0, 100];
  #sliderValues = new Map<number, number>();
  #nextId = 1;

  override render(): unknown {
    this.#sliderValues.clear();
    const handles = this.#value.map(value => {
      const sliderId = this.#nextId++;
      this.#sliderValues.set(sliderId, value);
      return html`
        <div
          class="handle"
          tabindex="${this.disabled ? -1 : 0}"
          role="slider"
          aria-label="${this.label}"
          aria-valuemin="${this.min}"
          aria-valuemax="${this.max}"
          aria-disabled=${ifDefined(this.disabled ? 'true' : undefined)}
          aria-valuenow="${value}"
          data-slider-id="${sliderId}"
          @pointerdown=${this.#onClickHandle}
          @pointermove=${this.#onDragHandle}
          @pointerup=${this.#onReleaseHandle}
          @pointercancel=${this.#onReleaseHandle}
          @keydown=${this.#onKeyPress}
        ></div>
      `;
    });

    return html`
      <label ?hidden=${!this.label}>${this.label}</label>
      <div class="base">
        <div class="track"></div>
        <div class="active-track"></div>
        ${handles}
      </div>
    `;
  }

  protected override willUpdate(changedProperties: PropertyValues): void {
    super.willUpdate(changedProperties);

    if (this.min > this.max) {
      [this.min, this.max] = [this.max, this.min];
    }

    if (this.step > this.max - this.min) {
      this.step = this.max - this.min;
    }

    if (this.step <= 0) {
      this.step = 1;
    }

    const adjustedValue = this.#value
      .map(value => {
        if (value <= this.min) return this.min;
        if (value >= this.max) return this.max;
        value = this.min + this.step * Math.round((value - this.min) / this.step);
        if (value > this.max) return this.max;
        return value;
      })
      .sort(numericSort);

    if (arraysDiffer(this.#value, adjustedValue)) {
      this.value = adjustedValue;
      if (!changedProperties.has('value')) {
        this.emit('sl-change');
      }
    }
  }

  protected override updated(changedProperties: PropertyValues): void {
    super.updated(changedProperties);
    for (const handle of this.handles) {
      const sliderId = +handle.dataset.sliderId!;
      if (!this.#sliderValues.has(sliderId)) continue;
      this.#moveHandle(handle, this.#sliderValues.get(sliderId)!);
    }
    this.#updateActiveTrack();
  }

  override focus(options?: FocusOptions): void {
    const firstHandle = this.handles.item(0);
    if (firstHandle) {
      firstHandle.focus(options);
    } else {
      super.focus(options);
    }
  }

  #onClickHandle(event: PointerEvent): void {
    const handle = event.target as HTMLDivElement;

    if (handle.dataset.pointerId) {
      handle.releasePointerCapture(+handle.dataset.pointerId);
    }

    if (this.disabled) return;

    handle.dataset.pointerId = event.pointerId.toString();
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('grabbed');
  }

  #onDragHandle(event: PointerEvent): void {
    if (this.disabled) return;

    const handle = event.target as HTMLDivElement;
    const sliderId = +handle.dataset.sliderId!;
    if (!this.#sliderValues.has(sliderId)) return;

    const pointerId = handle.dataset.pointerId ? +handle.dataset.pointerId : null;
    if (pointerId !== event.pointerId) return;

    const pos = this.#getNormalizedValueFromClientX(handle, event.clientX);
    const unit = this.step / (this.max - this.min);
    const value = this.min + this.step * Math.round(pos / unit);
    this.#sliderValues.set(sliderId, value);
    this.#moveHandle(handle, value);

    const prevValue = this.#value;
    this.#value = Array.from(this.#sliderValues.values()).sort(numericSort);
    this.#updateActiveTrack();

    if (arraysDiffer(prevValue, this.#value)) {
      this.emit('sl-input');
    }
  }

  #getNormalizedValueFromClientX(handle: HTMLDivElement, x: number): number {
    const bounds = this.baseDiv.getBoundingClientRect();
    const size = bounds.width - handle.clientWidth;
    if (size <= 0) return 0;
    x -= bounds.left + handle.clientWidth / 2;
    if (x <= 0) return 0;
    if (x >= size) return 1;
    return x / size;
  }

  #updateActiveTrack(): void {
    const activeTrack = this.activeTrack;
    if (!activeTrack) return;

    if (this.min === this.max || this.value.length < 2) {
      activeTrack.style.display = 'none';
      activeTrack.style.left = '0';
      activeTrack.style.width = '0';
      return;
    }

    const start = (100 * (this.value[0] - this.min)) / (this.max - this.min);
    const span = (100 * (this.value[this.value.length - 1] - this.value[0])) / (this.max - this.min);

    activeTrack.style.display = 'inline-block';
    activeTrack.style.left = `${start}%`;
    activeTrack.style.width = `${span}%`;
  }

  #onKeyPress(event: KeyboardEvent): void {
    const handle = event.target as HTMLDivElement;
    const sliderId = +handle.dataset.sliderId!;

    let value = this.#sliderValues.get(sliderId);
    if (value === undefined) return;

    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
      case 'Up':
      case 'Right':
        value = Math.min(value + this.step, this.max);
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'Down':
      case 'Left':
        value = Math.max(value - this.step, this.min);
        break;
      case 'PageUp':
        value = Math.min(value + 10 * this.step, this.max);
        break;
      case 'PageDown':
        value = Math.max(value - 10 * this.step, this.min);
        break;
      case 'Home':
        value = this.min;
        break;
      case 'End':
        value = this.max;
        break;
      default:
        return;
    }

    if (value !== this.#sliderValues.get(sliderId)) {
      this.#moveHandle(handle, value);

      this.#sliderValues.set(sliderId, value);
      this.#value = Array.from(this.#sliderValues.values()).sort(numericSort);
      this.#updateActiveTrack();

      this.emit('sl-input');
      this.emit('sl-change');
    }

    event.stopPropagation();
    event.preventDefault();
  }

  #onReleaseHandle(event: PointerEvent) {
    const handle = event.target as HTMLDivElement;
    if (!handle.dataset.pointerId || event.pointerId !== +handle.dataset.pointerId) return;

    handle.classList.remove('grabbed');
    handle.releasePointerCapture(event.pointerId);
    delete handle.dataset.pointerId;
    this.emit('sl-change');
  }

  #moveHandle(handle: HTMLDivElement, value: number): void {
    handle.setAttribute('aria-valuenow', value.toString());
    handle.setAttribute('aria-valuetext', this.tooltipFormatter(value));
    const pos = (value - this.min) / (this.max - this.min);
    handle.style.left = `calc( ${100 * pos}% - var(--thumb-size) * ${pos} )`;
  }
}
