import { LitElement, html } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { emit } from 'src/internal/event';
import { clamp } from 'src/internal/math';
import { watch } from 'src/internal/watch';
import { LocalizeController } from '../../utilities/localize';
import { isTreeItem } from '../tree-item/tree-item';
import styles from './tree.styles';
import type SlTreeItem from '../tree-item/tree-item';

function syncCheckboxes(changedTreeItem: SlTreeItem) {
  function syncAncestors(treeItem: SlTreeItem) {
    const parentItem: SlTreeItem | null = treeItem.parentElement as SlTreeItem;

    if (isTreeItem(parentItem)) {
      const children = parentItem.getChildrenItems({ includeDisabled: false });
      const allChecked = children.every(item => item.selected);
      const allUnchecked = children.every(item => !item.selected && !item.indeterminate);

      parentItem.selected = allChecked;
      parentItem.indeterminate = !allChecked && !allUnchecked;

      syncAncestors(parentItem);
    }
  }

  function syncDescendants(treeItem: SlTreeItem) {
    for (const childItem of treeItem.getChildrenItems()) {
      childItem.selected = !childItem.disabled && treeItem.selected;
      syncDescendants(childItem);
    }
  }

  syncAncestors(changedTreeItem);
  syncDescendants(changedTreeItem);
}

/**
 * @since 2.0
 * @status experimental
 *
 * @event {{ selection: this.selectedItems }} sl-selection-change - Emitted when an item gets selected or deselected
 *
 * @slot - The default slot.
 *
 * @csspart base - The component's internal wrapper.
 *
 * @cssproperty [--indent-size=var(--sl-spacing-medium)] - The size of the indentation for nested items.
 * @cssproperty [--indent-guide-color=var(--sl-color-neutral-200)] - The color of the indentation line.
 * @cssproperty [--indent-guide-offset=0] - The amount of vertical spacing to leave between the top and bottom of the indentation line's starting position.
 * @cssproperty [--indent-guide-style=solid] - The style of the indentation line, e.g. solid, dotted, dashed.
 * @cssproperty [--indent-guide-width=0] - The width of the indentation line.
 */
@customElement('sl-tree')
export default class SlTree extends LitElement {
  static styles = styles;

  @query('slot') defaultSlot: HTMLSlotElement;

  /** Specifies the selection behavior of the Tree */
  @property() selection: 'single' | 'multiple' | 'leaf' = 'single';

  //
  // A collection of all the items in the tree, in the order they appear. The collection is live, meaning it is
  // automatically updated when the underlying document is changed.
  //
  private treeItems: HTMLCollectionOf<SlTreeItem> = this.getElementsByTagName('sl-tree-item');
  private lastFocusedItem: SlTreeItem;
  private readonly localize = new LocalizeController(this);
  private mutationObserver: MutationObserver;

  connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'tree');
    this.setAttribute('tabindex', '0');

    this.mutationObserver = new MutationObserver(this.handleTreeChanged);

    this.addEventListener('focusin', this.handleFocusIn);
    this.addEventListener('focusout', this.handleFocusOut);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();

    this.mutationObserver.disconnect();

    this.removeEventListener('focusin', this.handleFocusIn);
    this.removeEventListener('focusout', this.handleFocusOut);
  }

  protected firstUpdated(): void {
    this.mutationObserver.observe(this, { childList: true, subtree: true });
  }

  handleTreeChanged = (mutations: MutationRecord[]) => {
    for (const mutation of mutations) {
      const addedNodes: SlTreeItem[] = [...mutation.addedNodes].filter(isTreeItem) as SlTreeItem[];
      const removedNodes = [...mutation.removedNodes].filter(isTreeItem) as SlTreeItem[];

      for (const item of addedNodes) {
        item.selectable = this.selection === 'multiple';
        syncCheckboxes(item);
      }

      // If the focused item has been removed form the DOM, move the focus on the first node
      if (removedNodes.includes(this.lastFocusedItem)) {
        this.focusItem(this.treeItems[0]);
      }
    }
  };

  @watch('selection')
  handleSelectionChange() {
    this.setAttribute('aria-multiselectable', this.selection === 'multiple' ? 'true' : 'false');

    for (const item of this.treeItems) {
      item.selectable = this.selection === 'multiple';
    }
  }

  syncTreeItems(selectedItem: SlTreeItem) {
    if (this.selection === 'multiple') {
      syncCheckboxes(selectedItem);
    } else {
      for (const item of this.treeItems) {
        if (item !== selectedItem) {
          item.selected = false;
        }
      }
    }
  }

  selectItem(selectedItem: SlTreeItem) {
    if (this.selection === 'multiple') {
      selectedItem.selected = !selectedItem.selected;
      if (selectedItem.lazy) {
        selectedItem.expanded = true;
      }
      this.syncTreeItems(selectedItem);
    } else if (this.selection === 'single' || selectedItem.isLeaf) {
      selectedItem.selected = true;

      this.syncTreeItems(selectedItem);
    } else if (this.selection === 'leaf') {
      selectedItem.expanded = !selectedItem.expanded;
    }

    emit(this, 'sl-selection-change', { detail: { selection: this.selectedItems } });
  }

  // Returns the list of tree items that are selected in the tree.
  get selectedItems(): SlTreeItem[] {
    const items = [...this.treeItems];
    const isSelected = (item: SlTreeItem) => item.selected;

    return items.filter(isSelected);
  }

  getFocusableItems() {
    return [...this.treeItems].filter(item => {
      // Exclude disabled elements
      if (item.disabled) return false;

      // Exclude those whose parent is collapsed or loading
      const parent: SlTreeItem | null | undefined = item.parentElement?.closest('[role=treeitem]');

      return !parent || (parent.expanded && !parent.loading);
    });
  }

  focusItem(item?: SlTreeItem | null) {
    item?.focus();
  }

  handleKeyDown(event: KeyboardEvent) {
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      return;
    }

    const items = this.getFocusableItems();
    const isLtr = this.localize.dir() === 'ltr';
    const isRtl = this.localize.dir() === 'rtl';

    if (items.length > 0) {
      event.preventDefault();
      const activeItemIndex = items.findIndex(item => document.activeElement === item);
      const activeItem: SlTreeItem | undefined = items[activeItemIndex];

      const focusItemAt = (index: number) => {
        const item = items[clamp(index, 0, items.length - 1)];
        this.focusItem(item);
      };
      const toggleExpand = (expanded: boolean) => {
        activeItem.expanded = expanded;
      };

      if (event.key === 'ArrowDown') {
        // Moves focus to the next node that is focusable without opening or closing a node.
        focusItemAt(activeItemIndex + 1);
      } else if (event.key === 'ArrowUp') {
        // Moves focus to the next node that is focusable without opening or closing a node.
        focusItemAt(activeItemIndex - 1);
      } else if ((isLtr && event.key === 'ArrowRight') || (isRtl && event.key === 'ArrowLeft')) {
        //
        // When focus is on a closed node, opens the node; focus does not move.
        // When focus is on a open node, moves focus to the first child node.
        // When focus is on an end node (a tree item with no children), does nothing.
        //
        if (!activeItem || activeItem.expanded || (activeItem.isLeaf && !activeItem.lazy)) {
          focusItemAt(activeItemIndex + 1);
        } else {
          toggleExpand(true);
        }
      } else if ((isLtr && event.key === 'ArrowLeft') || (isRtl && event.key === 'ArrowRight')) {
        //
        // When focus is on an open node, closes the node.
        // When focus is on a child node that is also either an end node or a closed node, moves focus to its parent node.
        // When focus is on a closed `tree`, does nothing.
        //
        if (!activeItem || activeItem.isLeaf || !activeItem.expanded) {
          focusItemAt(activeItemIndex - 1);
        } else {
          toggleExpand(false);
        }
      } else if (event.key === 'Home') {
        // Moves focus to the first node in the tree without opening or closing a node.
        focusItemAt(0);
      } else if (event.key === 'End') {
        // Moves focus to the last node in the tree that is focusable without opening the node.
        focusItemAt(items.length - 1);
      } else if (event.key === 'Enter' || event.key === ' ') {
        // Selects the focused node.
        this.selectItem(activeItem);
      }
    }
  }

  handleClick(event: Event) {
    const target = event.target as HTMLElement;
    const treeItem = target.closest('sl-tree-item')!;

    if (!treeItem.disabled) {
      this.selectItem(treeItem);
    }
  }

  handleFocusOut = (event: FocusEvent) => {
    const relatedTarget = event.relatedTarget as HTMLElement;

    // If the element that got the focus is not in the tree
    if (!relatedTarget || !this.contains(relatedTarget)) {
      this.tabIndex = 0;
    }
  };

  handleFocusIn = (event: FocusEvent) => {
    const target = event.target as SlTreeItem;

    // If the tree has been focused, move the focus to the last focused item
    if (event.target === this) {
      this.focusItem(this.lastFocusedItem || this.treeItems[0]);
    }

    // If the target is a tree item, update the tabindex
    if (isTreeItem(target) && !target.disabled) {
      if (this.lastFocusedItem) {
        this.lastFocusedItem.tabIndex = -1;
      }
      this.lastFocusedItem = target;
      this.tabIndex = -1;

      target.tabIndex = 0;
    }
  };

  render() {
    return html`
      <div part="base" class="tree" @click="${this.handleClick}" @keydown="${this.handleKeyDown}">
        <slot></slot>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sl-tree': SlTree;
  }
}
