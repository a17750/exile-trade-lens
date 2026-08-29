(() => {
  const PATCHED = Symbol("poe2zhDropdownSearch");
  const MATCH_LIMIT = 60;
  const MATCH_GROUP = "中文匹配";

  function labelOf(multiselect, option) {
    if (option == null) return "";
    if (typeof option === "string") return option;
    try {
      if (typeof multiselect.customLabel === "function") {
        return String(multiselect.customLabel(option, multiselect.label) ?? "");
      }
    } catch (_) {
      // Fall back to the configured label field if the site's renderer fails.
    }
    return String(multiselect.label ? option[multiselect.label] ?? "" : option);
  }

  function eachOption(multiselect, visit) {
    const options = multiselect.options ?? [];
    if (multiselect.groupValues && multiselect.groupLabel) {
      for (const group of options) {
        if (!group || typeof group !== "object") continue;
        for (const option of group[multiselect.groupValues] ?? []) visit(option);
      }
      return;
    }
    for (const option of options) visit(option);
  }

  function appendLabelMatches(multiselect, nativeResults, rawQuery) {
    const query = String(rawQuery ?? "").trim().toLocaleLowerCase();
    if (!query) return nativeResults;

    const seen = new Set(nativeResults.filter((option) => option && !option.$isLabel));
    const matches = [];
    eachOption(multiselect, (option) => {
      if (matches.length >= MATCH_LIMIT || seen.has(option)) return;
      if (!labelOf(multiselect, option).toLocaleLowerCase().includes(query)) return;
      seen.add(option);
      matches.push(option);
    });
    if (!matches.length) return nativeResults;

    if (multiselect.groupValues && multiselect.groupLabel) {
      return [
        ...nativeResults,
        { $groupLabel: MATCH_GROUP, $isLabel: true },
        ...matches,
      ];
    }
    return [...nativeResults, ...matches];
  }

  function patchMultiselect(multiselect) {
    if (!multiselect || multiselect[PATCHED]) return false;
    const watcher = multiselect._computedWatchers?.filteredOptions;
    if (!watcher || typeof watcher.getter !== "function") return false;

    const nativeGetter = watcher.getter;
    watcher.getter = function patchedFilteredOptions(instance) {
      const current = instance ?? this;
      const nativeResults = nativeGetter.call(current, current);
      try {
        return appendLabelMatches(current, nativeResults, current.search);
      } catch (_) {
        return nativeResults;
      }
    };
    multiselect[PATCHED] = true;
    return true;
  }

  document.addEventListener("focusin", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLElement) || !input.classList.contains("multiselect__input")) {
      return;
    }
    patchMultiselect(input.closest(".multiselect")?.__vue__);
  }, true);

  // Read-only test hook. It never contains page data or user input.
  window.__poe2zhDropdownSearch = { appendLabelMatches, patchMultiselect };
})();
