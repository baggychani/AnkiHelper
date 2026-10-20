// jsdom does not implement the dialog top layer. Browser tests verify its
// focus, inertness and Escape behavior; unit tests only need the open state.
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
}

// Text geometry is absent in jsdom. Editing/selection layout is covered by
// Playwright; component tests dispatch real editor transactions without layout.
if (typeof Range !== 'undefined') {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
}
