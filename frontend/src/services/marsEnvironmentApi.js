const API_BASE =
  import.meta.env.VITE_API_BASE ?? '/api'

async function getJson(path) {
  const response = await fetch(`${API_BASE}${path}`)

  if (!response.ok) {
    let detail = `Request failed: ${response.status}`

    try {
      const body = await response.json()

      if (body.detail) {
        detail = body.detail
      }
    } catch {
      // Keep HTTP status message.
    }

    throw new Error(detail)
  }

  return response.json()
}

export async function fetchPlaces(limit = 2052) {
  return getJson(`/places?limit=${limit}`)
}

export async function fetchPlaceSuggestions(
  query,
  limit = 8,
) {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
  })

  return getJson(
    `/places/suggest?${params.toString()}`,
  )
}

export async function fetchEnvironmentByPlace(
  name,
  sol = 100,
) {
  const params = new URLSearchParams({
    name,
    sol: String(sol),
  })

  return getJson(
    `/environment/by-place?${params.toString()}`,
  )
}
