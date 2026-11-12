import { useEffect, useMemo, useState } from 'react'

function fmt(value, digits = 2) {
  if (value === null || value === undefined || value === '') {
    return '—'
  }

  const n = Number(value)

  if (!Number.isFinite(n)) {
    return String(value)
  }

  return n.toLocaleString('en-GB', {
    maximumFractionDigits: digits,
  })
}

function formatAu(value) {
  if (value === null || value === undefined) {
    return '—'
  }

  const au = Number(value)

  if (!Number.isFinite(au)) {
    return '—'
  }

  return `${fmt(au, 4)} AU`
}

function formatDistanceKm(value) {
  if (value === null || value === undefined) {
    return '—'
  }

  const km = Number(value)

  if (!Number.isFinite(km)) {
    return '—'
  }

  return `${fmt(km, 0)} km`
}

function EvidenceBadge({ type }) {
  return (
    <span className="hazard-evidence-badge">
      {(type || 'EVIDENCE').replaceAll('_', ' ').toUpperCase()}
    </span>
  )
}

function SourceLink({ source }) {
  if (!source) {
    return null
  }

  return (
    <a
      className="hazard-source-link"
      href={source.url}
      target="_blank"
      rel="noreferrer"
    >
      {source.organisation} · {source.title}
    </a>
  )
}

function SiteSignal({ label, value, source }) {
  return (
    <div className="hazard-signal">
      <div className="hazard-signal-label">
        {label}
      </div>

      <div className="hazard-signal-value">
        {value}
      </div>

      {source ? (
        <div className="hazard-signal-source">
          {source}
        </div>
      ) : null}
    </div>
  )
}

export default function HazardDefencePanel({
  site = 'Gale',
  sol = 100,
  routeDistanceKm = null,
}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const siteName = useMemo(
    () => String(site || 'Gale').trim() || 'Gale',
    [site],
  )

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams()

        params.set('site', siteName)
        params.set('sol', String(Number(sol) || 100))
        params.set('horizon_days', '365')

        const response = await fetch(
          `/api/hazards/overview?${params.toString()}`,
          {
            signal: controller.signal,
          },
        )

        if (!response.ok) {
          throw new Error(
            `Hazard API returned HTTP ${response.status}`,
          )
        }

        const payload = await response.json()
        setData(payload)
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError(err.message)
        }
      } finally {
        setLoading(false)
      }
    }

    load()

    return () => controller.abort()
  }, [siteName, sol])

  const mola = data?.site_evidence?.mola
  const themis = data?.site_evidence?.themis
  const mgcm = data?.site_evidence?.mgcm

  const asteroidObjects =
    data?.asteroid_watch?.objects || []

  return (
    <section className="hazard-defence-panel">
      <div className="hazard-panel-header">
        <div>
          <div className="hazard-eyebrow">
            NEURONEXUS // HAZARD CONTROL
          </div>

          <h2>
            Threat Watch & Defence Planning
          </h2>

          <p>
            Evidence-backed monitoring, contingency planning
            and explicit Earth/Mars applicability.
          </p>
        </div>

        <div className="hazard-status-pill">
          RESEARCH MODE
        </div>
      </div>

      {loading ? (
        <div className="hazard-loading">
          Querying site evidence + JPL/CNEOS…
        </div>
      ) : null}

      {error ? (
        <div className="hazard-error">
          {error}
        </div>
      ) : null}

      <div className="hazard-site-strip">
        <div>
          <span>SITE</span>
          <strong>{siteName}</strong>
        </div>

        <div>
          <span>SOL</span>
          <strong>{sol}</strong>
        </div>

        <div>
          <span>ROUTE</span>
          <strong>
            {routeDistanceKm == null
              ? 'NOT SET'
              : `${fmt(routeDistanceKm)} km`}
          </strong>
        </div>
      </div>

      <section className="hazard-section">
        <div className="hazard-section-title">
          LIVE / QUERYABLE MARS ORBITAL WATCH
        </div>

        <div className="hazard-orbit-note">
          JPL/CNEOS Mars close-approach records are shown here.
          The display bands are NeuroNexus screening labels,
          not NASA impact-risk scores.
        </div>

        {data?.asteroid_watch?.status === 'live_query' ? (
          asteroidObjects.length ? (
            <div className="asteroid-grid">
              {asteroidObjects.map((object, index) => (
                <article
                  className="asteroid-card"
                  key={`${object.designation}-${index}`}
                >
                  <div className="asteroid-top">
                    <strong>
                      {object.fullname ||
                        object.designation ||
                        'Unnamed asteroid'}
                    </strong>

                    <span
                      className={`asteroid-band ${String(
                        object.screening_band || '',
                      )
                        .replaceAll(' ', '-')
                        .toLowerCase()}`}
                    >
                      {(object.screening_band ||
                        'unresolved')
                        .replaceAll('-', ' ')
                        .toUpperCase()}
                    </span>
                  </div>

                  <div className="asteroid-metrics">
                    <SiteSignal
                      label="APPROACH"
                      value={
                        object.close_approach_time_tdb ||
                        '—'
                      }
                    />

                    <SiteSignal
                      label="DISTANCE"
                      value={formatDistanceKm(
                        object.distance_km,
                      )}
                      source={formatAu(
                        object.distance_au,
                      )}
                    />

                    <SiteSignal
                      label="RELATIVE VELOCITY"
                      value={
                        object.relative_velocity_km_s ==
                        null
                          ? '—'
                          : `${fmt(
                              object.relative_velocity_km_s,
                              2,
                            )} km/s`
                      }
                    />

                    <SiteSignal
                      label="DIAMETER"
                      value={
                        object.diameter_km == null
                          ? 'Unknown'
                          : `${fmt(
                              object.diameter_km,
                              3,
                            )} km`
                      }
                    />
                  </div>

                  <div className="asteroid-footnote">
                    {object.screening_note}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="hazard-empty">
              No matching Mars-crossing asteroid close
              approaches were returned for the selected
              query window.
            </div>
          )
        ) : (
          <div className="hazard-empty">
            JPL/CNEOS live orbital query unavailable.
            No orbital conclusion is inferred from missing
            data.
          </div>
        )}
      </section>

      <section className="hazard-section">
        <div className="hazard-section-title">
          SELECTED-SITE ENVIRONMENT
        </div>

        <div className="hazard-signal-grid">
          <SiteSignal
            label="MOLA ELEVATION"
            value={
              mola?.elevation_m == null
                ? 'No local sample'
                : `${fmt(mola.elevation_m)} m`
            }
            source="NASA MOLA"
          />

          <SiteSignal
            label="THEMIS HISTORICAL BT"
            value={
              themis?.brightness_temperature_k ==
              null
                ? 'No local observation'
                : `${fmt(
                    themis.brightness_temperature_k,
                    1,
                  )} K`
            }
            source="NASA/JPL/ASU THEMIS"
          />

          <SiteSignal
            label="MGCM DUST OPACITY"
            value={
              mgcm?.dust_opacity == null
                ? 'No model sample'
                : fmt(mgcm.dust_opacity, 3)
            }
            source="NASA Ames MGCM"
          />
        </div>
      </section>

      <section className="hazard-section">
        <div className="hazard-section-title">
          MARS HAZARD MATRIX
        </div>

        <div className="hazard-card-grid">
          {(data?.hazards || []).map((hazard) => (
            <article
              className="hazard-card"
              key={hazard.id}
            >
              <div className="hazard-card-top">
                <strong>{hazard.name}</strong>
                <EvidenceBadge type={hazard.evidence_type} />
              </div>

              <div className="hazard-applicability">
                {String(
                  hazard.applicability || '',
                )
                  .replaceAll('_', ' ')
                  .toUpperCase()}
              </div>

              <p>
                {hazard.status_text}
              </p>

              <div className="hazard-plan-title">
                DEFENCE / RESPONSE
              </div>

              <div className="hazard-plan-list">
                {(hazard.controls || []).map(
                  (control) => (
                    <div
                      className="hazard-plan-item"
                      key={control}
                    >
                      <span>›</span>
                      <span>{control}</span>
                    </div>
                  ),
                )}
              </div>

              <div className="hazard-source-list">
                {(hazard.sources || []).map(
                  (source) => (
                    <SourceLink
                      source={source}
                      key={source.id}
                    />
                  ),
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="hazard-section">
        <div className="hazard-section-title">
          MISSION DEFENCE DOCTRINE
        </div>

        <div className="defence-doctrine-grid">
          {(data?.defence_doctrine?.steps || []).map(
            (step) => (
              <article
                className="defence-step"
                key={step.phase}
              >
                <div className="defence-step-phase">
                  {step.phase}
                </div>

                <div className="defence-step-actions">
                  {(step.actions || []).map(
                    (action) => (
                      <div
                        key={action}
                        className="defence-action"
                      >
                        {action}
                      </div>
                    ),
                  )}
                </div>
              </article>
            ),
          )}
        </div>

        <div className="defence-boundary">
          {data?.defence_doctrine?.important_boundary}
        </div>
      </section>

      <section className="hazard-section">
        <div className="hazard-section-title">
          EVIDENCE REGISTRY
        </div>

        <div className="hazard-source-grid">
          {(data?.evidence_registry || []).map(
            (source) => (
              <SourceLink
                source={source}
                key={source.id}
              />
            ),
          )}
        </div>
      </section>

      <section className="hazard-section">
        <div className="hazard-section-title">
          FUTURE AI INPUT CONTRACT
        </div>

        <div className="ai-ready-box">
          <strong>
            AI CONTEXT: READY
          </strong>

          <p>
            The backend already exposes
            <code>/api/hazards/ai-context</code>.
            Future AI agents can reason over the same
            labelled evidence without becoming the source
            of orbital or environmental truth.
          </p>
        </div>
      </section>
    </section>
  )
}
