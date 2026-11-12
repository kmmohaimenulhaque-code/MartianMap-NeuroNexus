const USGS_MARS_MAP_URL =
  'https://usgs.maps.arcgis.com/apps/webappviewer/index.html?id=fc004c3d21b64c398ed5458580ab7c58'

export default function MarsTopographicMap() {
  return (
    <section className="usgs-scientific-map">
      <header className="usgs-map-header">
        <div className="usgs-map-heading">
          <span className="usgs-map-kicker">USGS / MARS</span>
          <h2>INTERACTIVE SCIENTIFIC MAP</h2>
        </div>

        <a
          className="usgs-map-open"
          href={USGS_MARS_MAP_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          OPEN FULL MAP ↗
        </a>
      </header>

      <div className="usgs-map-frame">
        <iframe
          title="USGS Interactive Mars Scientific Map"
          src={USGS_MARS_MAP_URL}
          loading="eager"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>

      <footer className="usgs-map-footer">
        <span>USGS ARCGIS</span>
        <span>INTERACTIVE LAYERS</span>
        <span>TOPOGRAPHY</span>
        <span>GEOLOGY</span>
        <span>MEASUREMENTS</span>
      </footer>

      <style>{`
        .usgs-scientific-map {
          width: 100%;
          height: 100%;
          min-height: 620px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border: 1px solid rgba(148, 163, 184, 0.18);
          border-radius: 14px;
          background: #080c12;
          box-shadow:
            0 18px 50px rgba(0, 0, 0, 0.28),
            inset 0 0 0 1px rgba(255, 255, 255, 0.02);
        }

        .usgs-map-header {
          min-height: 58px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 10px 14px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.16);
          background:
            linear-gradient(
              180deg,
              rgba(17, 24, 39, 0.98),
              rgba(8, 12, 18, 0.98)
            );
          flex-shrink: 0;
        }

        .usgs-map-heading {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .usgs-map-kicker {
          font-size: 10px;
          line-height: 1;
          letter-spacing: 0.16em;
          font-weight: 700;
          color: #94a3b8;
        }

        .usgs-map-heading h2 {
          margin: 0;
          font-size: 13px;
          line-height: 1.1;
          letter-spacing: 0.08em;
          font-weight: 800;
          color: #e5e7eb;
        }

        .usgs-map-open {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 32px;
          padding: 0 11px;
          border: 1px solid rgba(148, 163, 184, 0.24);
          border-radius: 7px;
          background: rgba(15, 23, 42, 0.76);
          color: #cbd5e1;
          text-decoration: none;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          transition:
            background 140ms ease,
            border-color 140ms ease,
            color 140ms ease;
        }

        .usgs-map-open:hover {
          background: rgba(30, 41, 59, 0.95);
          border-color: rgba(203, 213, 225, 0.4);
          color: #ffffff;
        }

        .usgs-map-frame {
          position: relative;
          flex: 1;
          min-height: 0;
          background: #000000;
          overflow: hidden;
        }

        .usgs-map-frame iframe {
          display: block;
          width: 100%;
          height: 100%;
          min-height: 560px;
          border: 0;
          background: #000000;
        }

        .usgs-map-footer {
          min-height: 30px;
          display: flex;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
          padding: 6px 12px;
          border-top: 1px solid rgba(148, 163, 184, 0.14);
          background: rgba(8, 12, 18, 0.98);
          color: #64748b;
          font-size: 8px;
          line-height: 1;
          letter-spacing: 0.12em;
          font-weight: 700;
          flex-shrink: 0;
        }

        @media (max-width: 900px) {
          .usgs-scientific-map {
            min-height: 520px;
          }

          .usgs-map-header {
            align-items: flex-start;
          }

          .usgs-map-open {
            min-height: 30px;
            padding-inline: 9px;
            font-size: 9px;
          }

          .usgs-map-frame iframe {
            min-height: 460px;
          }

          .usgs-map-footer {
            gap: 8px;
          }
        }
      `}</style>
    </section>
  )
}
