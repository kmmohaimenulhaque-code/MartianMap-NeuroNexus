import { useEffect, useRef, useState } from "react";

import Icon from "../../ui/Icon";

/*
 * Place search. Enter picks the highlighted suggestion (the first by default), Up / Down move the highlight,
 * Esc or a click anywhere else closes the list so it never stays over the maps.
 */
export default function SearchBar({ query, suggestions, onQueryChange, onSelect }) {
  const [active, setActive] = useState(0);
  const [closedFor, setClosedFor] = useState(null);
  const ref = useRef(null);
  const open = suggestions.length > 0 && closedFor !== query;
  const current = Math.min(active, suggestions.length - 1);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => !ref.current?.contains(event.target) && setClosedFor(query);
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, query]);

  const pick = (suggestion) => {
    // Selecting writes the place name into the box; do not reopen the list for that name.
    setClosedFor(suggestion.feature_name);
    onSelect(suggestion);
  };
  const onKeyDown = (event) => {
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(suggestions[current]);
    } else if (event.key === "Escape") {
      setClosedFor(query);
    }
  };

  return (
    <div className="search-wrapper" ref={ref}>
      <div className="search-box">
        <span className="search-icon"><Icon name="search" size={16} /></span>

        <input
          value={query}
          onChange={(event) => {
            setActive(0);
            onQueryChange(event.target.value);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setClosedFor(null)}
          placeholder="Search Mars place..."
          aria-label="Search Mars place"
          aria-expanded={open}
          aria-controls="nn-search-suggestions"
          aria-activedescendant={open ? `nn-search-option-${current}` : undefined}
          role="combobox"
          aria-autocomplete="list"
        />

        <span className="search-hint">USGS</span>
      </div>

      {open && (
        <div className="suggestions" id="nn-search-suggestions" role="listbox">
          <div className="suggestions-header">MARS PLACES</div>

          {suggestions.map((suggestion, index) => (
            <button
              key={[suggestion.feature_name, suggestion.latitude_deg, suggestion.longitude_deg].join(":")}
              id={`nn-search-option-${index}`}
              type="button"
              role="option"
              aria-selected={index === current}
              className={index === current ? "is-active" : undefined}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(suggestion)}
            >
              <span className="suggestion-dot" />

              <span className="suggestion-main">
                <strong>{suggestion.feature_name}</strong>

                <small>{suggestion.feature_type}</small>
              </span>

              <span className="suggestion-meta">{suggestion.diameter_km == null ? "n/a" : `${Number(suggestion.diameter_km).toFixed(2)} km`}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
