import {
  useEffect,
  useState,
} from 'react'


const REFERENCE_SOURCES = [
  {
    id: 'mars',
    title: 'NASA MARS',
    description:
      'NASA Science overview of Mars, its environment and exploration.',

    url:
      'https://science.nasa.gov/mars/',
  },

  {
    id: 'photojournal',
    title: 'MARS PHOTOJOURNAL',
    description:
      'NASA Mars imagery and science content.',

    url:
      'https://science.nasa.gov/photojournal/galleries/pj-mars/',
  },

  {
    id: 'exploration',
    title: 'MARS EXPLORATION',
    description:
      'NASA Mars Exploration archive and current stories.',

    url:
      'https://science.nasa.gov/blogs/mars/',
  },
]


function formatPublished(
  value,
) {
  if (!value) {
    return 'DATE UNAVAILABLE'
  }

  const parsed =
    new Date(value)

  if (
    Number.isNaN(
      parsed.getTime(),
    )
  ) {
    return value
  }

  return parsed.toLocaleDateString(
    undefined,
    {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    },
  )
}


export default function MarsBriefingPanel() {
  const [
    activeView,
    setActiveView,
  ] = useState('latest')

  const [
    feed,
    setFeed,
  ] = useState(null)

  const [
    loading,
    setLoading,
  ] = useState(true)

  const [
    error,
    setError,
  ] = useState('')


  async function loadFeed() {
    try {
      setLoading(true)
      setError('')

      const response =
        await fetch(
          '/api/briefing/mars?limit=6',
          {
            cache: 'no-store',
          },
        )

      if (!response.ok) {
        throw new Error(
          `NASA feed returned HTTP ${response.status}`,
        )
      }

      const data =
        await response.json()

      setFeed(data)
    } catch (err) {
      setFeed(null)

      setError(
        err.message,
      )
    } finally {
      setLoading(false)
    }
  }


  useEffect(() => {
    loadFeed()
  }, [])


  function openUrl(
    url,
  ) {
    window.open(
      url,
      '_blank',
      'noopener,noreferrer',
    )
  }


  return (
    <div className="briefing-body">
      <div className="briefing-tabs">
        <button
          type="button"
          className={
            activeView ===
            'latest'
              ? 'briefing-tab active'
              : 'briefing-tab'
          }
          onClick={() =>
            setActiveView(
              'latest',
            )
          }
        >
          LATEST MARS
        </button>

        {REFERENCE_SOURCES.map(
          (source) => (
            <button
              key={
                source.id
              }
              type="button"
              className={
                activeView ===
                source.id
                  ? 'briefing-tab active'
                  : 'briefing-tab'
              }
              onClick={() =>
                setActiveView(
                  source.id,
                )
              }
            >
              {
                source.title
              }
            </button>
          ),
        )}
      </div>


      <div className="briefing-actions">
        {activeView ===
          'latest' ? (
          <button
            type="button"
            disabled={
              loading
            }
            onClick={
              loadFeed
            }
          >
            {loading
              ? 'UPDATING…'
              : 'REFRESH'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              const source =
                REFERENCE_SOURCES.find(
                  (
                    item,
                  ) =>
                    item.id ===
                    activeView,
                )

              if (source) {
                openUrl(
                  source.url,
                )
              }
            }}
          >
            OPEN NASA ↗
          </button>
        )}

        <button
          type="button"
          onClick={() =>
            openUrl(
              'https://science.nasa.gov/blogs/mars/',
            )
          }
        >
          MARS ARCHIVE ↗
        </button>
      </div>


      {activeView ===
        'latest' ? (
        <>
          {loading && (
            <div className="briefing-feed-state">
              QUERYING NASA MARS FEED…
            </div>
          )}

          {!loading &&
            error && (
            <div className="briefing-feed-state">
              <strong>
                NASA FEED UNAVAILABLE
              </strong>

              <span>
                {error}
              </span>

              <button
                type="button"
                className="briefing-retry"
                onClick={
                  loadFeed
                }
              >
                RETRY
              </button>
            </div>
          )}

          {!loading &&
            !error &&
            feed?.items
              ?.length ===
              0 && (
            <div className="briefing-feed-state">
              NO CURRENT MARS ITEMS
            </div>
          )}

          {!loading &&
            !error &&
            feed?.items
              ?.length >
              0 && (
            <div className="briefing-feed">
              {feed.items.map(
                (
                  item,
                  index,
                ) => (
                  <article
                    className="briefing-card"
                    key={
                      item.url ||
                      `${item.title}-${index}`
                    }
                  >
                    <div className="briefing-card-meta">
                      <span>
                        NASA MARS
                      </span>

                      <time>
                        {formatPublished(
                          item.published,
                        )}
                      </time>
                    </div>

                    <button
                      type="button"
                      className="briefing-card-title"
                      onClick={() =>
                        openUrl(
                          item.url,
                        )
                      }
                    >
                      {
                        item.title
                      }
                    </button>

                    <p>
                      {
                        item.description
                      }
                    </p>

                    <button
                      type="button"
                      className="briefing-card-link"
                      onClick={() =>
                        openUrl(
                          item.url,
                        )
                      }
                    >
                      READ NASA ARTICLE ↗
                    </button>
                  </article>
                ),
              )}
            </div>
          )}

          {!loading &&
            !error &&
            feed && (
            <p className="briefing-note">
              Source: NASA Science
              Mars Photojournal RSS.
              Web reference feed only;
              not spacecraft telemetry.
            </p>
          )}
        </>
      ) : (
        (() => {
          const source =
            REFERENCE_SOURCES.find(
              (
                item,
              ) =>
                item.id ===
                activeView,
            )

          if (!source) {
            return null
          }

          return (
            <div className="briefing-reference">
              <span>
                NASA REFERENCE
              </span>

              <strong>
                {
                  source.title
                }
              </strong>

              <p>
                {
                  source.description
                }
              </p>

              <button
                type="button"
                className="briefing-reference-link"
                onClick={() =>
                  openUrl(
                    source.url,
                  )
                }
              >
                OPEN NASA REFERENCE ↗
              </button>
            </div>
          )
        })()
      )}
    </div>
  )
}
