(() => {
  const NODE_ID = "poe2zh-hover-originals";
  const EVENT_NAME = "poe2zh:hover-originals";
  const known = new Map();
  const pending = new Map();
  const conflicts = new Set();
  let scheduled = false;

  function normalize(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function flush() {
    scheduled = false;
    if (!pending.size) return;
    let node = document.getElementById(NODE_ID);
    if (!node) {
      node = document.createElement("script");
      node.id = NODE_ID;
      node.type = "application/json";
      node.hidden = true;
      (document.head || document.documentElement).append(node);
    }
    node.textContent = JSON.stringify([...pending]);
    pending.clear();
    document.dispatchEvent(new Event(EVENT_NAME));
    node.textContent = "";
  }

  function register(rendered, original) {
    const translatedText = normalize(rendered);
    const englishText = normalize(original);
    if (!translatedText || !englishText || translatedText === englishText || conflicts.has(translatedText)) {
      return;
    }
    const previous = known.get(translatedText);
    if (previous && previous !== englishText) {
      known.delete(translatedText);
      pending.delete(translatedText);
      conflicts.add(translatedText);
      return;
    }
    known.set(translatedText, englishText);
    pending.set(translatedText, englishText);
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  }

  globalThis.POE2ZHHoverOriginals = Object.freeze({ register, normalize });
})();
