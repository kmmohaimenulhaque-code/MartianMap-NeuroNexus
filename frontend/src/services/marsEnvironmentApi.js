const API_BASE = '/api'


async function fetchJson(
  url,
  options = {},
) {
  const response =
    await fetch(
      url,
      options,
    )

  if (!response.ok) {
    let message =
      `Request failed: ${response.status}`

    try {
      const body =
        await response.json()

      if (body?.detail) {
        message =
          body.detail
      }
    } catch {
      // Keep the HTTP status message.
    }

    throw new Error(
      message,
    )
  }

  return response.json()
}


export async function fetchPlaces(
  limit = 2052,
) {
  return fetchJson(
    `${API_BASE}/places?limit=${encodeURIComponent(
      limit,
    )}`,
  )
}


export async function fetchPlaceSuggestions(
  query,
  limit = 8,
) {
  const params =
    new URLSearchParams({
      q: query,
      limit: String(
        limit,
      ),
    })

  return fetchJson(
    `${API_BASE}/places/suggest?${params}`,
  )
}


export async function fetchEnvironmentByPlace(
  name,
  sol,
) {
  const params =
    new URLSearchParams({
      name,
      sol: String(
        sol,
      ),
    })

  return fetchJson(
    `${API_BASE}/environment/by-place?${params}`,
  )
}


export async function fetchTerrainMetadata() {
  return fetchJson(
    `${API_BASE}/terrain/metadata`,
  )
}


export async function fetchRoutePlan(
  points,
) {
  return fetchJson(
    `${API_BASE}/terrain/route-plan`,
    {
      method: 'POST',

      headers: {
        'Content-Type':
          'application/json',
      },

      body: JSON.stringify({
        points:
          points.map(
            (
              point,
            ) => ({
              latitude_deg:
                Number(
                  point.latitude_deg,
                ),

              longitude_deg:
                Number(
                  point.longitude_deg,
                ) % 360,

              label:
                point.label ??
                'WAYPOINT',
            }),
          ),
      }),
    },
  )
}


export async function fetchRoverPhotos(
  name,
  limit = 8,
) {
  const params =
    new URLSearchParams({
      name,
      limit: String(
        limit,
      ),
    })

  return fetchJson(
    `${API_BASE}/media/rover-photos?${params}`,
  )
}
