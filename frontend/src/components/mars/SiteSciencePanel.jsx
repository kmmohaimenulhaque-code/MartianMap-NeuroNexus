function statusLabel(
  status,
) {
  const labels = {
    global_reference:
      'GLOBAL REFERENCE',

    site_measurement_context:
      'SITE-LINKED CONTEXT',

    context_only:
      'CONTEXT ONLY',

    not_ingested:
      'NOT INGESTED',

    proxy_only:
      'PROXY ONLY',

    no_confirmed_native_vegetation:
      'NO CONFIRMED NATIVE OBSERVATION',
  }

  return (
    labels[status] ??
    String(
      status ??
      'UNKNOWN',
    )
      .replaceAll(
        '_',
        ' ',
      )
      .toUpperCase()
  )
}


function ScienceField({
  label,
  data,
}) {
  if (!data) {
    return (
      <div className="science-block">
        <div className="science-block-head">
          <span>
            {label}
          </span>

          <small>
            NOT AVAILABLE
          </small>
        </div>

        <strong>
          NO SITE-SPECIFIC DATA
        </strong>

        <p>
          This dataset has not been
          loaded for the selected
          location.
        </p>
      </div>
    )
  }

  return (
    <div className="science-block">
      <div className="science-block-head">
        <span>
          {label}
        </span>

        <small>
          {statusLabel(
            data.status,
          )}
        </small>
      </div>

      <strong>
        {data.value ??
          'NO VALUE'}
      </strong>

      {data.note && (
        <p>
          {data.note}
        </p>
      )}

      <div className="science-block-foot">
        <span>
          SOURCE
        </span>

        {data.url ? (
          <a
            className="science-source-link"
            href={data.url}
            target="_blank"
            rel="noreferrer"
          >
            {data.source ??
              'NASA'} ↗
          </a>
        ) : (
          <span>
            {data.source ??
              '—'}
          </span>
        )}
      </div>
    </div>
  )
}


export default function SiteSciencePanel({
  science,
}) {
  if (!science) {
    return (
      <div className="science-panel-body">
        <div className="science-block">
          <div className="science-block-head">
            <span>
              SITE SCIENCE
            </span>

            <small>
              WAITING
            </small>
          </div>

          <strong>
            SELECT A MARS SITE
          </strong>

          <p>
            Site-linked science
            context will appear
            after a USGS feature
            is selected.
          </p>
        </div>
      </div>
    )
  }

  const atmosphere =
    science.atmosphere

  const gases =
    atmosphere?.gases ??
    []

  return (
    <div className="science-panel-body">
      <div className="science-block">
        <div className="science-block-head">
          <span>
            SELECTED FEATURE
          </span>

          <small>
            {
              science.feature_name
                ? 'SITE CONTEXT'
                : 'UNSELECTED'
            }
          </small>
        </div>

        <strong>
          {
            science.feature_name ??
            'MARS'
          }
        </strong>

        <p>
          The science layer distinguishes
          measured site context, global
          reference, proxies and datasets
          that have not yet been ingested.
        </p>
      </div>

      <ScienceField
        label="SOIL / REGOLITH"
        data={
          science.soil
        }
      />

      <ScienceField
        label="MINERALS / COMPOSITION"
        data={
          science.minerals
        }
      />

      <div className="science-block">
        <div className="science-block-head">
          <span>
            ATMOSPHERE / GASES
          </span>

          <small>
            {
              statusLabel(
                atmosphere?.status,
              )
            }
          </small>
        </div>

        <strong>
          {
            atmosphere?.reference ??
            'Mars atmosphere'
          }
        </strong>

        <div className="gas-grid">
          {gases.map(
            (gas) => (
              <div
                className="gas-row"
                key={
                  gas.name
                }
              >
                <span>
                  {
                    gas.name
                  }
                </span>

                <strong>
                  {
                    gas.volume_percent ==
                    null
                      ? 'NO SITE VALUE'
                      : `${gas.volume_percent}%`
                  }
                </strong>
              </div>
            ),
          )}
        </div>

        {atmosphere?.note && (
          <p>
            {
              atmosphere.note
            }
          </p>
        )}

        <div className="science-block-foot">
          <span>
            SOURCE
          </span>

          {atmosphere?.url ? (
            <a
              className="science-source-link"
              href={
                atmosphere.url
              }
              target="_blank"
              rel="noreferrer"
            >
              {
                atmosphere.source ??
                'NASA'
              } ↗
            </a>
          ) : (
            <span>
              {
                atmosphere?.source ??
                '—'
              }
            </span>
          )}
        </div>
      </div>

      <ScienceField
        label="WATER / ICE"
        data={{
          status:
            'not_ingested',

          value:
            'SITE-SPECIFIC EVIDENCE REQUIRED',

          note:
            'A site-linked water or ice evidence layer is not yet ingested into NeuroNexus.',

          source:
            'NeuroNexus science roadmap',
        }}
      />

      <ScienceField
        label="BIOAVAILABILITY"
        data={
          science.bioavailability
        }
      />

      <ScienceField
        label="VEGETATION / BIOLOGY"
        data={
          science.vegetation
        }
      />

      {science.provenance?.note && (
        <div className="science-provenance">
          {
            science.provenance.note
          }
        </div>
      )}
    </div>
  )
}
