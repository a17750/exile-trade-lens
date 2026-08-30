(() => {
  const TOOLTIP_ID = "poe2zh-original-tooltip";
  const ORIGINAL_ATTRIBUTE = "data-poe2zh-original";
  const SHOW_DELAY_MS = 140;
  let tooltip = null;
  let activeTarget = null;
  let showTimer = null;

  function ensureTooltip() {
    if (tooltip?.isConnected) return tooltip;
    tooltip = document.getElementById(TOOLTIP_ID);
    if (tooltip) return tooltip;
    tooltip = document.createElement("div");
    tooltip.id = TOOLTIP_ID;
    tooltip.setAttribute("role", "tooltip");
    tooltip.setAttribute("aria-hidden", "true");
    tooltip.dataset.visible = "false";
    document.body?.append(tooltip);
    return tooltip;
  }

  function position() {
    if (!tooltip || !activeTarget?.isConnected) return hide();
    const targetRect = activeTarget.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const margin = 10;
    const gap = 8;
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const left = Math.min(
      Math.max(targetRect.left + (targetRect.width - width) / 2, margin),
      Math.max(margin, viewportWidth - width - margin),
    );
    const above = targetRect.top - height - gap;
    const below = targetRect.bottom + gap;
    const top = above >= margin || below + height > viewportHeight - margin
      ? Math.max(margin, above)
      : below;
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
  }

  function show(target) {
    const original = target?.getAttribute?.(ORIGINAL_ATTRIBUTE)?.trim();
    if (!original || !target.isConnected) return;
    const node = ensureTooltip();
    if (!node) return;
    activeTarget = target;
    node.textContent = original;
    node.dataset.visible = "true";
    node.setAttribute("aria-hidden", "false");
    position();
  }

  function hide() {
    clearTimeout(showTimer);
    showTimer = null;
    activeTarget = null;
    if (!tooltip) return;
    tooltip.dataset.visible = "false";
    tooltip.setAttribute("aria-hidden", "true");
  }

  function targetFrom(eventTarget) {
    return eventTarget?.closest?.(`[${ORIGINAL_ATTRIBUTE}]`) ?? null;
  }

  function schedule(target) {
    clearTimeout(showTimer);
    if (!target) return hide();
    showTimer = setTimeout(() => {
      showTimer = null;
      show(target);
    }, SHOW_DELAY_MS);
  }

  document.addEventListener("pointerover", (event) => {
    const target = targetFrom(event.target);
    if (!target || target === targetFrom(event.relatedTarget)) return;
    schedule(target);
  }, true);
  document.addEventListener("pointerout", (event) => {
    const target = targetFrom(event.target);
    if (!target || target === targetFrom(event.relatedTarget)) return;
    hide();
  }, true);
  document.addEventListener("focusin", (event) => schedule(targetFrom(event.target)), true);
  document.addEventListener("focusout", hide, true);
  window.addEventListener("scroll", position, { passive: true, capture: true });
  window.addEventListener("resize", position, { passive: true });

  function annotate(element, original) {
    const value = String(original ?? "").replace(/\s+/g, " ").trim();
    if (!element?.setAttribute || !value) return false;
    element.setAttribute(ORIGINAL_ATTRIBUTE, value);
    return true;
  }

  globalThis.POE2ZHOriginalTooltip = Object.freeze({ annotate, hide });
})();
