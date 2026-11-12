import {
  useEffect,
  useState,
} from 'react'

import {
  fetchRoverPhotos,
} from '../../services/marsEnvironmentApi'


function truncate(
  value,
  length = 130,
) {
  const text =
    String(
      value ?? '',
    ).trim()

  if (
    text.length <=
    length
  ) {
    return text
  }

  return `${text.slice(
    0,
    length - 1,
  )}…`
}


export default function RoverPhotosPanel({
  feature,
}) {
  const [data, setData] =
    useState(null)

  const [loading, setLoading] =
    useState(false)


  useEffect(() => {
    if (
      !feature?.feature_name
    ) {
      setData(null)
      return undefined
    }

    const controller =
      new AbortController()


    async function load() {
      try {
        setLoading(true)

        const response =
          await fetchRoverPhotos(
            feature.feature_name,
            8,
          )

        if (
          !controller.signal
            .aborted
        ) {
          setData(
            response,
          )
        }
      } catch {
        if (
          !controller.signal
            .aborted
        ) {
          setData({
            status:
              'unavailable',

            count: 0,

            photos: [],
          })
        }
      } finally {
        if (
          !controller.signal
            .aborted
        ) {
          setLoading(false)
        }
      }
    }

    load()

    return () =>
      controller.abort()
  }, [
    feature?.feature_name,
  ])


  if (!feature) {
    return (
      <div className="photo-empty">
        SELECT A MARS SITE
      </div>
    )
  }


  if (loading) {
    return (
      <div className="photo-empty">
        QUERYING NASA IMAGE LIBRARY…
      </div>
    )
  }


  if (
    data?.status ===
    'unavailable'
  ) {
    return (
      <div className="photo-empty">
        NASA IMAGE LIBRARY TEMPORARILY UNAVAILABLE
      </div>
    )
  }


  if (
    !data?.photos?.length
  ) {
    return (
      <div className="photo-empty">
        NO PHOTOS APPLICABLE
      </div>
    )
  }


  return (
    <div className="photo-grid">
      {data.photos.map(
        (photo) => (
          <article
            className="photo-card"
            key={photo.id}
          >
            <a
              href={
                photo.nasa_url
              }
              target="_blank"
              rel="noreferrer"
              className="photo-link"
            >
              <img
                src={
                  photo.preview_url
                }
                alt={
                  photo.title
                }
                loading="lazy"
              />
            </a>

            <div className="photo-card-body">
              <div className="photo-card-meta">
                <span>
                  {
                    photo.rover ??
                    'ROVER'
                  }
                </span>

                <a
                  href={
                    photo.nasa_url
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  NASA ↗
                </a>
              </div>

              <strong>
                {
                  photo.title
                }
              </strong>

              <p>
                {truncate(
                  photo.description,
                )}
              </p>
            </div>
          </article>
        ),
      )}
    </div>
  )
}
