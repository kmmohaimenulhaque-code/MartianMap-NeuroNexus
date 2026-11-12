const API_BASE = '/api'

async function fetchJson(
  url,
  options = {},
) {
  const response = await fetch(
    url,
    options,
  )

  if (!response.ok) {
    let message = `Request failed: ${response.status}`

    try {
      const body = await response.json()

      if (body?.detail) {
        message = body.detail
      }
    } catch {
      // Keep the HTTP status message.
    }

    throw new Error(message)
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
      limit: String(limit),
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
      sol: String(sol),
    })

  return fetchJson(
    `${API_BASE}/environment/by-place?${params}`,
  )
}


export async function fetchTerrainWindow(
  latitude,
  longitude,
  widthKm = 40,
  heightKm = 40,
) {
  const params =
    new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      width_km: String(widthKm),
      height_km: String(heightKm),
    })

  return fetchJson(
    `/terrain/window?${params}`,
  )
}


export async function fetchTerrainRoute(
  start,
  end,
  corridorWidthKm = 20,
  corridorHeightKm = 20,
) {
  const params =
    new URLSearchParams({
      start_latitude: String(
        start.latitude_deg,
      ),
      start_longitude: String(
        start.longitude_deg,
      ),
      end_latitude: String(
        end.latitude_deg,
      ),
      end_longitude: String(
        end.longitude_deg,
      ),
      corridor_width_km: String(
        corridorWidthKm,
      ),
      corridor_height_km: String(
        corridorHeightKm,
      ),
    })

  return fetchJson(
    `/terrain/route?${params}`,
  )
}
