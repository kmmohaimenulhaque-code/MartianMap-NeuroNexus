import Icon from "../../ui/Icon";


export default function SearchBar({ query, suggestions, onQueryChange, onSelect }) {
  return (
    <div className="search-wrapper">
      <div className="search-box">
        <span className="search-icon"><Icon name="search" size={16} /></span>

        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search Mars place..."
          aria-label="Search Mars place"
        />

        <span className="search-hint">USGS</span>
      </div>

      {suggestions.length > 0 && (
        <div className="suggestions">
          <div className="suggestions-header">MARS PLACES</div>

          {suggestions.map((suggestion) => (
            <button
              key={[suggestion.feature_name, suggestion.latitude_deg, suggestion.longitude_deg].join(":")}
              type="button"
              onClick={() => onSelect(suggestion)}
            >
              <span className="suggestion-dot" />

              <span className="suggestion-main">
                <strong>{suggestion.feature_name}</strong>

                <small>{suggestion.feature_type}</small>
              </span>

              <span className="suggestion-meta">{suggestion.diameter_km == null ? "—" : `${Number(suggestion.diameter_km).toFixed(2)} km`}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
