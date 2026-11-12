import { AREA_STYLES, ENTITY_STYLES, LINE_STYLES, USGS_CLASS_COLOURS, USGS_OTHER_COLOUR } from "./mapStyle";

/*
 * Dedicated 3D map legend. Every swatch is drawn from the same style objects
 * the globe uses, so legend and map cannot drift apart. Entries only appear
 * for layers that are implemented.
 */

function Swatch({ colour, shape = "circle" }) {
  return <span className={`m3d-sw m3d-sw-${shape}`} style={{ "--sw": colour }} aria-hidden="true" />;
}

function LineSwatch({ colour, dashed }) {
  return <span className={`m3d-sw-line${dashed ? " dashed" : ""}`} style={{ "--sw": colour }} aria-hidden="true" />;
}

function AreaSwatch({ colour, gradient }) {
  return <span className={`m3d-sw-area${gradient ? " gradient" : ""}`} style={{ "--sw": colour }} aria-hidden="true" />;
}

function Status({ status }) {
  return <em className={`m3d-tag m3d-${status.toLowerCase()}`}>{status}</em>;
}

function Row({ swatch, label, status, off, children }) {
  return (
    <li className={off ? "off" : ""}>
      {swatch}
      <span>{label}</span>
      {status && <Status status={status} />}
      {children}
    </li>
  );
}

export default function Mars3DLegend({ visible, traverses, candidateRoutes = [], onFlyTo }) {
  const rovers = traverses?.rovers ?? [];
  return (
    <div className="m3d-legend">
      <h4>USGS / IAU NAMED FEATURES · same colours as the coloured 2D map</h4>
      <ul className="m3d-legend-grid">
        {Object.entries(USGS_CLASS_COLOURS).map(([cls, colour]) => (
          <Row key={cls} swatch={<Swatch colour={colour} />} label={cls} off={!visible.features} />
        ))}
        <Row swatch={<Swatch colour={USGS_OTHER_COLOUR} />} label="Other classes (Albedo, Cavus, Tholus, Collis, …)" off={!visible.features} />
      </ul>
      <small>
        Labels: major and scientifically important features always; smaller features appear as you zoom in. Hover glows; the selected feature is
        highlighted.
      </small>

      <h4>USGS GEOLOGY & SITES</h4>
      <ul>
        <Row swatch={<AreaSwatch colour={AREA_STYLES.units.colour} />} label={AREA_STYLES.units.label} status="DERIVED" off={!visible.units} />
        <Row
          swatch={<LineSwatch colour={LINE_STYLES.contact.colour} dashed />}
          label={LINE_STYLES.contact.label}
          status="DERIVED"
          off={!visible.contacts}
        />
        <Row
          swatch={<LineSwatch colour={LINE_STYLES.structure.colour} />}
          label={LINE_STYLES.structure.label}
          status="DERIVED"
          off={!visible.structures}
        />
        <Row
          swatch={<Swatch colour={ENTITY_STYLES.landing.colour} shape="square" />}
          label={ENTITY_STYLES.landing.label}
          status="OBSERVED"
          off={!visible.landing}
        />
      </ul>

      <h4>ROVERS</h4>
      <ul>
        {["curiosity", "perseverance"].map((key) => {
          const rover = rovers.find((r) => (key === "curiosity" ? r.id?.startsWith("msl") : r.id?.startsWith("m2020")));
          return (
            <Row
              key={key}
              swatch={<LineSwatch colour={LINE_STYLES[key].colour} />}
              label={LINE_STYLES[key].label}
              status={rover?.status ?? "OBSERVED"}
              off={!visible.traverses}
            >
              {rover?.end && (
                <button type="button" className="m3d-link" onClick={() => onFlyTo(rover.end[1], rover.end[0], 45)}>
                  FLY TO
                </button>
              )}
            </Row>
          );
        })}
        {["curiosity", "perseverance"].map((key) => (
          <Row
            key={`${key}-pos`}
            swatch={<Swatch colour={ENTITY_STYLES[key].colour} shape="triangle" />}
            label={ENTITY_STYLES[key].label}
            status="OBSERVED"
            off={!visible.rovers}
          />
        ))}
      </ul>

      <h4>MISSION</h4>
      <ul>
        <Row swatch={<LineSwatch colour={LINE_STYLES.route.colour} />} label={LINE_STYLES.route.label} status="DERIVED" off={!visible.route} />
        <Row
          swatch={<Swatch colour={ENTITY_STYLES.routeStart.colour} />}
          label="Route start / waypoint / destination"
          status="DERIVED"
          off={!visible.route}
        />
        <Row
          swatch={<LineSwatch colour={candidateRoutes[0]?.colour ?? LINE_STYLES.candidate.colour} dashed />}
          label={LINE_STYLES.candidate.label}
          status="DERIVED"
          off={!visible.candidates}
        />
        <Row
          swatch={<Swatch colour={ENTITY_STYLES.safeHaven.colour} shape="kite" />}
          label={ENTITY_STYLES.safeHaven.label}
          status="DERIVED"
          off={!visible.places}
        />
        <Row
          swatch={<Swatch colour={ENTITY_STYLES.customPlace.colour} />}
          label={ENTITY_STYLES.customPlace.label}
          status="DERIVED"
          off={!visible.places}
        />
      </ul>

      <h4>EXPLORATION & SCIENCE</h4>
      <ul>
        <Row swatch={<AreaSwatch colour={AREA_STYLES.zone.colour} />} label={ENTITY_STYLES.zone.label} status="DERIVED" off={!visible.zones} />
        <Row
          swatch={<Swatch colour={ENTITY_STYLES.iceRegion.colour} />}
          label={ENTITY_STYLES.iceRegion.label}
          status="DERIVED"
          off={!visible.iceRegions}
        />
        <Row swatch={<Swatch colour={ENTITY_STYLES.ancient.colour} />} label={ENTITY_STYLES.ancient.label} status="OBSERVED" off={!visible.ancient} />
        <Row swatch={<Swatch colour={ENTITY_STYLES.thermal.colour} />} label={ENTITY_STYLES.thermal.label} status="OBSERVED" off={!visible.themis} />
        <Row swatch={<AreaSwatch gradient />} label={AREA_STYLES.slope.label} status="DERIVED" off={!visible.slope} />
        <Row swatch={<AreaSwatch gradient />} label={AREA_STYLES.roughness.label} status="DERIVED" off={!visible.roughness} />
        <Row swatch={<AreaSwatch gradient />} label={AREA_STYLES.walkability.label} status="DERIVED" off={!visible.walkability} />
        <Row swatch={<AreaSwatch colour="#555" />} label="NASA SWIM water-ice consensus map — not integrated" status="UNAVAILABLE" off />
      </ul>
      <small>Greyed entries are currently switched off in LAYERS.</small>
    </div>
  );
}
