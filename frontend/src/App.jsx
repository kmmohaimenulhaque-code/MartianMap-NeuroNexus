import {
  useEffect,
  useMemo,
  useState,
} from 'react'

import MarsMap from './components/mars/MarsMap'
import MarsTopographicMap from './components/mars/MarsTopographicMap'
import MarsBriefingPanel from './components/mars/MarsBriefingPanel'
import RoverPhotosPanel from './components/mars/RoverPhotosPanel'
import SiteSciencePanel from './components/mars/SiteSciencePanel'
import MissionOpsPanel from './components/mission/MissionOpsPanel'

import {
  fetchEnvironmentByCoordinate,
  fetchEnvironmentByPlace,
  fetchPlaceSuggestions,
  fetchPlaces,
  fetchRoutePlan,
} from './services/marsEnvironmentApi'

import './App.css'


const DEFAULT_PLACE = 'Gale'
const DEFAULT_SOL = 100

const MAX_ROUTE_POINTS = 32
const MAX_COMPARE_ROUTES = 4

const MAX_TODO_WORDS = 150
const MAX_CHECKLIST_POINTS = 10
const MAX_CHECKLIST_WORDS = 150

const STORAGE_KEYS = {
  routes:
    'neuronexus.savedRoutes.v2',

  customPlaces:
    'neuronexus.customPlaces.v2',

  safeHavens:
    'neuronexus.safeHavens.v2',

  todo:
    'neuronexus.missionTodo.v2',

  checklist:
    'neuronexus.missionChecklist.v2',
}


const COMPARISON_COLOURS = [
  '#75e6ff',
  '#ff9f68',
  '#8cf0b1',
  '#c99bff',
]


function readStorage(
  key,
  fallback,
) {
  try {
    const raw =
      localStorage.getItem(
        key,
      )

    if (!raw) {
      return fallback
    }

    const parsed =
      JSON.parse(
        raw,
      )

    return (
      parsed ??
      fallback
    )
  } catch {
    return fallback
  }
}


function writeStorage(
  key,
  value,
) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify(
        value,
      ),
    )
  } catch {
    // Local persistence is optional.
  }
}


function createId(
  prefix,
) {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
}


function normaliseLongitude(
  longitude,
) {
  return (
    (
      Number(
        longitude,
      ) % 360
    ) +
    360
  ) % 360
}


function normaliseLocation(
  point,
  label = null,
) {
  return {
    latitude_deg:
      Number(
        point.latitude_deg ??
          point.lat,
      ),

    longitude_deg:
      normaliseLongitude(
        point.longitude_deg ??
          point.longitude ??
          point.lon ??
          point.lng,
      ),

    label:
      label ??
      point.label ??
      null,
  }
}


function countWords(
  text = '',
) {
  return String(
    text,
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length
}


function trimToWordLimit(
  text,
  maximum,
) {
  const words =
    String(
      text,
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean)

  if (
    words.length <=
    maximum
  ) {
    return text
  }

  return words
    .slice(
      0,
      maximum,
    )
    .join(' ')
}


function isNetworkFailure(
  error,
) {
  const message =
    String(
      error?.message ??
        error ??
        '',
    ).toLowerCase()

  return (
    message.includes(
      'failed to fetch',
    ) ||
    message.includes(
      'networkerror',
    ) ||
    message.includes(
      'load failed',
    ) ||
    message.includes(
      'econnrefused',
    ) ||
    message.includes(
      'fetch failed',
    )
  )
}


function downloadTextFile(
  filename,
  content,
  mimeType,
) {
  const blob =
    new Blob(
      [content],
      {
        type:
          mimeType,
      },
    )

  const url =
    URL.createObjectURL(
      blob,
    )

  const anchor =
    document.createElement(
      'a',
    )

  anchor.href =
    url

  anchor.download =
    filename

  document.body.appendChild(
    anchor,
  )

  anchor.click()

  anchor.remove()

  URL.revokeObjectURL(
    url,
  )
}


function Panel({
  eyebrow,
  title,
  children,
  className = '',
}) {
  return (
    <section
      className={`panel ${className}`}
    >
      <div className="panel-heading">
        <div>
          {eyebrow && (
            <div className="eyebrow">
              {eyebrow}
            </div>
          )}

          <h2>
            {title}
          </h2>
        </div>

        <span className="panel-mark">
          +
        </span>
      </div>

      <div className="panel-body">
        {children}
      </div>
    </section>
  )
}


function Metric({
  label,
  value,
  detail,
}) {
  return (
    <div className="metric">
      <span>
        {label}
      </span>

      <strong>
        {value ?? '—'}
      </strong>

      {detail && (
        <small>
          {detail}
        </small>
      )}
    </div>
  )
}


function SearchBar({
  query,
  suggestions,
  onQueryChange,
  onSelect,
}) {
  return (
    <div className="search-wrapper">
      <div className="search-box">
        <span className="search-icon">
          ⌕
        </span>

        <input
          value={
            query
          }
          onChange={(
            event,
          ) =>
            onQueryChange(
              event.target
                .value,
            )
          }
          placeholder="Search Mars place..."
          aria-label="Search Mars place"
        />

        <span className="search-hint">
          USGS
        </span>
      </div>

      {suggestions.length >
        0 && (
        <div className="suggestions">
          <div className="suggestions-header">
            MARS PLACES
          </div>

          {suggestions.map(
            (
              suggestion,
            ) => (
              <button
                key={[
                  suggestion.feature_name,
                  suggestion.latitude_deg,
                  suggestion.longitude_deg,
                ].join(':')}
                type="button"
                onClick={() =>
                  onSelect(
                    suggestion,
                  )
                }
              >
                <span className="suggestion-dot" />

                <span className="suggestion-main">
                  <strong>
                    {
                      suggestion.feature_name
                    }
                  </strong>

                  <small>
                    {
                      suggestion.feature_type
                    }
                  </small>
                </span>

                <span className="suggestion-meta">
                  {
                    suggestion.diameter_km ==
                    null
                      ? '—'
                      : `${Number(
                          suggestion.diameter_km,
                        ).toFixed(2)} km`
                  }
                </span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}


const glassButtonStyle = {
  minHeight:
    '34px',

  padding:
    '0 10px',

  border:
    '1px solid rgba(117,230,255,0.22)',

  background:
    'rgba(7,15,19,0.76)',

  color:
    '#9ab0b8',

  fontFamily:
    'monospace',

  fontSize:
    '10px',

  letterSpacing:
    '0.06em',

  cursor:
    'pointer',
}


function MissionMenu({
  open,
  onClose,
  todoText,
  setTodoText,
  checklist,
  onChecklistTextChange,
  onChecklistToggle,
  onAddChecklistItem,
  onRemoveChecklistItem,
  onExportJson,
  onExportCsv,
  onPrint,
}) {
  if (!open) {
    return null
  }

  const todoWords =
    countWords(
      todoText,
    )

  const checklistWords =
    countWords(
      checklist
        .map(
          (
            item,
          ) =>
            item.text,
        )
        .join(' '),
    )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="NeuroNexus mission workspace"
      style={{
        position:
          'fixed',

        inset:
          0,

        zIndex:
          5000,

        display:
          'flex',

        alignItems:
          'center',

        justifyContent:
          'center',

        padding:
          '24px',

        background:
          'rgba(2,7,10,0.72)',

        backdropFilter:
          'blur(22px) saturate(120%)',

        WebkitBackdropFilter:
          'blur(22px) saturate(120%)',
      }}
    >
      <div
        style={{
          width:
            'min(1180px, 100%)',

          height:
            'min(820px, calc(100vh - 48px))',

          overflow:
            'auto',

          border:
            '1px solid rgba(117,230,255,0.25)',

          background:
            'linear-gradient(180deg, rgba(11,21,27,0.9), rgba(4,10,13,0.92))',

          boxShadow:
            '0 30px 120px rgba(0,0,0,0.65)',

          backdropFilter:
            'blur(28px)',

          WebkitBackdropFilter:
            'blur(28px)',
        }}
      >
        <header
          style={{
            position:
              'sticky',

            top:
              0,

            zIndex:
              2,

            display:
              'flex',

            justifyContent:
              'space-between',

            alignItems:
              'center',

            gap:
              '16px',

            padding:
              '16px 18px',

            borderBottom:
              '1px solid rgba(117,230,255,0.13)',

            background:
              'rgba(5,12,16,0.82)',

            backdropFilter:
              'blur(18px)',

            WebkitBackdropFilter:
              'blur(18px)',
          }}
        >
          <div>
            <div
              style={{
                color:
                  '#75e6ff',

                fontSize:
                  '10px',

                letterSpacing:
                  '0.16em',
              }}
            >
              NEURONEXUS / MISSION WORKSPACE
            </div>

            <h2
              style={{
                margin:
                  '5px 0 0',

                fontSize:
                  '18px',

                letterSpacing:
                  '0.06em',
              }}
            >
              FIELD NOTES + CHECKLIST
            </h2>

            <small
              style={{
                display:
                  'block',

                marginTop:
                  '5px',

                color:
                  '#74868e',

                fontSize:
                  '10px',
              }}
            >
              Persistent local mission
              planning workspace.
            </small>
          </div>

          <button
            type="button"
            onClick={
              onClose
            }
            style={{
              minWidth:
                '38px',

              minHeight:
                '38px',

              border:
                '1px solid #29414b',

              background:
                '#091115',

              color:
                '#75e6ff',

              fontSize:
                '20px',

              cursor:
                'pointer',
            }}
          >
            ×
          </button>
        </header>

        <div
          style={{
            display:
              'grid',

            gridTemplateColumns:
              'minmax(0,1fr) minmax(0,1fr)',

            gap:
              '12px',

            padding:
              '14px',
          }}
        >
          <section
            style={{
              minWidth:
                0,

              border:
                '1px solid rgba(117,230,255,0.14)',

              background:
                'rgba(7,15,19,0.72)',
            }}
          >
            <div
              style={{
                padding:
                  '12px',

                borderBottom:
                  '1px solid rgba(117,230,255,0.1)',
              }}
            >
              <div
                style={{
                  color:
                    '#75e6ff',

                  fontSize:
                    '10px',

                  letterSpacing:
                    '0.12em',
                }}
              >
                ✍️ TO-DO LIST MAKER
              </div>

              <strong
                style={{
                  display:
                    'block',

                  marginTop:
                    '5px',

                  fontSize:
                    '13px',
                }}
              >
                Mission objective / field note
              </strong>
            </div>

            <div
              style={{
                padding:
                  '12px',
              }}
            >
              <textarea
                value={
                  todoText
                }
                onChange={(
                  event,
                ) =>
                  setTodoText(
                    trimToWordLimit(
                      event.target
                        .value,
                      MAX_TODO_WORDS,
                    ),
                  )
                }
                placeholder="Write what needs to be completed..."
                style={{
                  width:
                    '100%',

                  minHeight:
                    '280px',

                  resize:
                    'vertical',

                  boxSizing:
                    'border-box',

                  padding:
                    '12px',

                  border:
                    '1px solid #29414b',

                  background:
                    '#071014',

                  color:
                    '#d8e5e9',

                  fontFamily:
                    'monospace',

                  fontSize:
                    '10px',

                  lineHeight:
                    1.6,

                  outline:
                    'none',
                }}
              />

              <div
                style={{
                  display:
                    'flex',

                  justifyContent:
                    'space-between',

                  gap:
                    '10px',

                  marginTop:
                    '7px',

                  color:
                    todoWords >=
                    MAX_TODO_WORDS
                      ? '#ff8997'
                      : '#6f828a',

                  fontFamily:
                    'monospace',

                  fontSize:
                    '10px',
                }}
              >
                <span>
                  MAXIMUM 150 WORDS
                </span>

                <strong>
                  {
                    todoWords
                  } / {MAX_TODO_WORDS}
                </strong>
              </div>
            </div>
          </section>

          <section
            style={{
              minWidth:
                0,

              border:
                '1px solid rgba(117,230,255,0.14)',

              background:
                'rgba(7,15,19,0.72)',
            }}
          >
            <div
              style={{
                padding:
                  '12px',

                borderBottom:
                  '1px solid rgba(117,230,255,0.1)',
              }}
            >
              <div
                style={{
                  color:
                    '#75e6ff',

                  fontSize:
                    '10px',

                  letterSpacing:
                    '0.12em',
                }}
              >
                📋 CHECKLIST MAKER
              </div>

              <strong
                style={{
                  display:
                    'block',

                  marginTop:
                    '5px',

                  fontSize:
                    '13px',
                }}
              >
                Tickable mission actions
              </strong>
            </div>

            <div
              style={{
                padding:
                  '12px',
              }}
            >
              <div
                style={{
                  display:
                    'flex',

                  justifyContent:
                    'space-between',

                  gap:
                    '10px',

                  marginBottom:
                    '9px',

                  color:
                    '#6f828a',

                  fontFamily:
                    'monospace',

                  fontSize:
                    '10px',
                }}
              >
                <span>
                  {
                    checklist.length
                  } / {MAX_CHECKLIST_POINTS}{' '}
                  POINTS
                </span>

                <strong
                  style={{
                    color:
                      checklistWords >=
                      MAX_CHECKLIST_WORDS
                        ? '#ff8997'
                        : '#9bb1b8',
                  }}
                >
                  {
                    checklistWords
                  } / {MAX_CHECKLIST_WORDS}{' '}
                  WORDS
                </strong>
              </div>

              <div
                style={{
                  display:
                    'grid',

                  gap:
                    '7px',

                  minHeight:
                    '285px',

                  alignContent:
                    'start',
                }}
              >
                {checklist.map(
                  (
                    item,
                    index,
                  ) => (
                    <div
                      key={
                        item.id
                      }
                      style={{
                        display:
                          'grid',

                        gridTemplateColumns:
                          '30px minmax(0,1fr) 32px',

                        gap:
                          '7px',

                        alignItems:
                          'center',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          onChecklistToggle(
                            item.id,
                          )
                        }
                        style={{
                          width:
                            '30px',

                          height:
                            '30px',

                          border:
                            item.done
                              ? '1px solid #8cf0b1'
                              : '1px solid #29414b',

                          background:
                            item.done
                              ? 'rgba(80,180,120,0.12)'
                              : '#071014',

                          color:
                            '#8cf0b1',

                          cursor:
                            'pointer',

                          fontSize:
                            '15px',
                        }}
                      >
                        {item.done
                          ? '✓'
                          : ''}
                      </button>

                      <input
                        value={
                          item.text
                        }
                        onChange={(
                          event,
                        ) =>
                          onChecklistTextChange(
                            item.id,
                            event
                              .target
                              .value,
                          )
                        }
                        placeholder={`Checklist point ${index + 1}`}
                        style={{
                          minWidth:
                            0,

                          width:
                            '100%',

                          boxSizing:
                            'border-box',

                          minHeight:
                            '34px',

                          padding:
                            '7px 9px',

                          border:
                            '1px solid #29414b',

                          background:
                            '#071014',

                          color:
                            item.done
                              ? '#6d858d'
                              : '#d5e1e5',

                          textDecoration:
                            item.done
                              ? 'line-through'
                              : 'none',

                          fontFamily:
                            'monospace',

                          fontSize:
                            '10px',

                          outline:
                            'none',
                        }}
                      />

                      <button
                        type="button"
                        onClick={() =>
                          onRemoveChecklistItem(
                            item.id,
                          )
                        }
                        style={{
                          minHeight:
                            '34px',

                          border:
                            '1px solid #50333a',

                          background:
                            '#0b1114',

                          color:
                            '#ff9aa9',

                          cursor:
                            'pointer',

                          fontSize:
                            '13px',
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ),
                )}

                {!checklist.length && (
                  <div
                    style={{
                      minHeight:
                        '160px',

                      display:
                        'grid',

                      placeItems:
                        'center',

                      padding:
                        '16px',

                      border:
                        '1px dashed #29414b',

                      color:
                        '#667980',

                      fontSize:
                        '10px',

                      textAlign:
                        'center',
                    }}
                  >
                    NO CHECKLIST ITEMS
                    <br />
                    ADD YOUR FIRST MISSION ACTION
                  </div>
                )}
              </div>

              <button
                type="button"
                disabled={
                  checklist.length >=
                    MAX_CHECKLIST_POINTS ||
                  checklistWords >=
                    MAX_CHECKLIST_WORDS
                }
                onClick={
                  onAddChecklistItem
                }
                style={{
                  ...glassButtonStyle,

                  width:
                    '100%',

                  marginTop:
                    '10px',

                  opacity:
                    checklist.length >=
                      MAX_CHECKLIST_POINTS ||
                    checklistWords >=
                      MAX_CHECKLIST_WORDS
                      ? 0.4
                      : 1,
                }}
              >
                + ADD CHECKLIST POINT
              </button>
            </div>
          </section>

          <section
            style={{
              gridColumn:
                '1 / -1',

              border:
                '1px solid rgba(117,230,255,0.14)',

              background:
                'rgba(7,15,19,0.72)',

              padding:
                '12px',
            }}
          >
            <div
              style={{
                display:
                  'flex',

                flexWrap:
                  'wrap',

                gap:
                  '7px',

                justifyContent:
                  'space-between',

                alignItems:
                  'center',
              }}
            >
              <div>
                <div
                  style={{
                    color:
                      '#75e6ff',

                    fontSize:
                      '10px',

                    letterSpacing:
                      '0.12em',
                  }}
                >
                  MISSION RECORD
                </div>

                <small
                  style={{
                    display:
                      'block',

                    marginTop:
                      '4px',

                    color:
                      '#687b83',

                    fontSize:
                      '10px',
                  }}
                >
                  Notes and checklist are
                  saved locally and included
                  in JSON mission exports.
                </small>
              </div>

              <div
                style={{
                  display:
                    'flex',

                  flexWrap:
                    'wrap',

                  gap:
                    '6px',
                }}
              >
                <button
                  type="button"
                  onClick={
                    onExportJson
                  }
                  style={
                    glassButtonStyle
                  }
                >
                  EXPORT JSON
                </button>

                <button
                  type="button"
                  onClick={
                    onExportCsv
                  }
                  style={
                    glassButtonStyle
                  }
                >
                  EXPORT CSV
                </button>

                <button
                  type="button"
                  onClick={
                    onPrint
                  }
                  style={
                    glassButtonStyle
                  }
                >
                  PRINT / PDF
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}


function RouteConsole({
  routeMode,
  routePoints,
  routePlan,
  loading,
  hasSelectedLocation,
  selectedLocation,
  savedRoutes,
  compareCount,
  customPlacesCount,
  safeHavensCount,
  onToggle,
  onAddSelected,
  onAnalyze,
  onClear,
  onRemoveLast,
  onSaveRoute,
  onOpenCompare,
  onSavePlace,
  onAddSafeHaven,
}) {
  const displacement =
    routePlan
      ?.displacement
      ?.distance_km

  const planned =
    routePlan
      ?.planned_route
      ?.planned_route_km

  const extension =
    routePlan
      ?.planned_route
      ?.extension_km

  return (
    <div className="route-console">
      <div className="route-console-main">
        <div className="route-console-heading">
          <span>
            NAVIGATION / USER WAYPOINTS
          </span>

          <strong>
            {routeMode
              ? 'PLAN ROUTE ACTIVE'
              : routePoints.length
                ? `${routePoints.length} WAYPOINT${routePoints.length === 1 ? '' : 'S'}`
                : 'READY'}
          </strong>
        </div>

        <small>
          {routeMode
            ? 'Click anywhere on the coloured Mars map to add a waypoint.'
            : 'User-defined Haversine route geometry with local MOLA waypoint analysis.'}
        </small>
      </div>

      <div className="route-console-actions">
        <button
          type="button"
          className={
            routeMode
              ? 'active'
              : ''
          }
          onClick={
            onToggle
          }
        >
          {routeMode
            ? 'STOP PLANNING'
            : 'PLAN ROUTE'}
        </button>

        <button
          type="button"
          disabled={
            !hasSelectedLocation ||
            routePoints.length >=
              MAX_ROUTE_POINTS
          }
          onClick={
            onAddSelected
          }
        >
          ADD SELECTED
        </button>

        <button
          type="button"
          disabled={
            !routePoints.length
          }
          onClick={
            onRemoveLast
          }
        >
          UNDO LAST
        </button>

        <button
          type="button"
          className="primary"
          disabled={
            routePoints.length <
              2 ||
            loading
          }
          onClick={
            onAnalyze
          }
        >
          {loading
            ? 'ANALYZING…'
            : 'ANALYZE'}
        </button>

        <button
          type="button"
          disabled={
            !routePlan
          }
          onClick={
            onSaveRoute
          }
        >
          SAVE ROUTE
        </button>

        <button
          type="button"
          disabled={
            savedRoutes.length <
            2
          }
          onClick={
            onOpenCompare
          }
        >
          COMPARE
          {compareCount >
          0
            ? ` ${compareCount}/${MAX_COMPARE_ROUTES}`
            : ''}
        </button>

        <button
          type="button"
          className="danger"
          disabled={
            !routePoints.length
          }
          onClick={
            onClear
          }
        >
          CLEAR
        </button>
      </div>

      {routePoints.length >
        0 && (
        <div className="route-console-strip">
          {routePoints.map(
            (
              point,
              index,
            ) => (
              <span
                key={`${point.latitude_deg}:${point.longitude_deg}:${index}`}
              >
                {index ===
                0
                  ? 'A'
                  : `P${index}`}{' '}
                {point.label ||
                  `${Number(
                    point.latitude_deg,
                  ).toFixed(2)}°,${Number(
                    point.longitude_deg,
                  ).toFixed(2)}°E`}
              </span>
            ),
          )}
        </div>
      )}

      {routePlan && (
        <div className="route-console-results">
          <Metric
            label="Displacement"
            value={
              displacement ==
              null
                ? '—'
                : `${Number(
                    displacement,
                  ).toFixed(2)} km`
            }
          />

          <Metric
            label="Planned route"
            value={
              planned ==
              null
                ? '—'
                : `${Number(
                    planned,
                  ).toFixed(2)} km`
            }
          />

          <Metric
            label="Extension"
            value={
              extension ==
              null
                ? '—'
                : `${Number(
                    extension,
                  ).toFixed(2)} km`
            }
          />
        </div>
      )}

      <div
        style={{
          display:
            'grid',

          gridTemplateColumns:
            '1fr 1fr',

          gap:
            '6px',
        }}
      >
        <button
          type="button"
          disabled={
            !selectedLocation
          }
          onClick={
            onSavePlace
          }
          style={{
            minHeight:
              '29px',

            padding:
              '0 9px',

            border:
              '1px solid #29414b',

            background:
              '#0a1318',

            color:
              '#93a7af',

            fontFamily:
              'monospace',

            fontSize:
              '7px',

            letterSpacing:
              '0.08em',

            cursor:
              'pointer',
          }}
        >
          SAVE CURRENT PLACE
        </button>

        <button
          type="button"
          disabled={
            !selectedLocation
          }
          onClick={
            onAddSafeHaven
          }
          style={{
            minHeight:
              '29px',

            padding:
              '0 9px',

            border:
              '1px solid #3a6650',

            background:
              '#0a1318',

            color:
              '#8cf0b1',

            fontFamily:
              'monospace',

            fontSize:
              '7px',

            letterSpacing:
              '0.08em',

            cursor:
              'pointer',
          }}
        >
          ADD SAFE HAVEN
        </button>
      </div>

      <div
        style={{
          display:
            'flex',

          flexWrap:
            'wrap',

          gap:
            '8px 14px',

          paddingTop:
            '2px',

          color:
            '#65777f',

          fontFamily:
            'monospace',

          fontSize:
            '7px',
        }}
      >
        <span>
          SAVED ROUTES{' '}
          <strong
            style={{
              color:
                '#9bb1b8',
            }}
          >
            {
              savedRoutes.length
            }
          </strong>
        </span>

        <span>
          CUSTOM PLACES{' '}
          <strong
            style={{
              color:
                '#9bb1b8',
            }}
          >
            {
              customPlacesCount
            }
          </strong>
        </span>

        <span>
          SAFE HAVENS{' '}
          <strong
            style={{
              color:
                '#8cf0b1',
            }}
          >
            {
              safeHavensCount
            }
          </strong>
        </span>
      </div>
    </div>
  )
}


function buildRouteMetrics(
  savedRoute,
) {
  const analysis =
    savedRoute
      ?.plan
      ?.waypoint_analysis ??
    []

  const available =
    analysis.filter(
      (item) =>
        item?.status ===
        'available',
    )

  const slopes =
    available
      .map((item) =>
        Number(
          item.slope_deg,
        ),
      )
      .filter(
        Number.isFinite,
      )

  const roughness =
    available
      .map((item) =>
        Number(
          item.roughness_m,
        ),
      )
      .filter(
        Number.isFinite,
      )

  const elevations =
    available
      .map((item) =>
        Number(
          item.elevation_m,
        ),
      )
      .filter(
        Number.isFinite,
      )

  const maxSlope =
    slopes.length
      ? Math.max(
          ...slopes,
        )
      : null

  const meanSlope =
    slopes.length
      ? slopes.reduce(
          (
            sum,
            value,
          ) =>
            sum +
            value,
          0,
        ) /
        slopes.length
      : null

  const maxRoughness =
    roughness.length
      ? Math.max(
          ...roughness,
        )
      : null

  const meanRoughness =
    roughness.length
      ? roughness.reduce(
          (
            sum,
            value,
          ) =>
            sum +
            value,
          0,
        ) /
        roughness.length
      : null

  const elevationMin =
    elevations.length
      ? Math.min(
          ...elevations,
        )
      : null

  const elevationMax =
    elevations.length
      ? Math.max(
          ...elevations,
        )
      : null

  const coverage =
    analysis.length
      ? available.length /
        analysis.length
      : 0

  return {
    distanceKm:
      savedRoute
        ?.plan
        ?.planned_route
        ?.planned_route_km ??
      null,

    displacementKm:
      savedRoute
        ?.plan
        ?.displacement
        ?.distance_km ??
      null,

    waypointCount:
      analysis.length,

    availableWaypoints:
      available.length,

    coverage,

    maxSlope,

    meanSlope,

    maxRoughness,

    meanRoughness,

    elevationMin,

    elevationMax,

    warnings:
      savedRoute
        ?.plan
        ?.guidance
        ?.notes ??
      [],
  }
}


function getRouteProsCons(
  metrics,
) {
  const pros = []
  const cons = []

  if (
    metrics.coverage ===
      1 &&
    metrics.waypointCount >
      0
  ) {
    pros.push(
      'NASA MOLA local analysis is available at every sampled waypoint.',
    )
  }

  if (
    metrics.maxSlope !=
      null &&
    metrics.maxSlope <
      15
  ) {
    pros.push(
      'No sampled waypoint reaches the 15° terrain-guidance threshold.',
    )
  }

  if (
    metrics.maxRoughness !=
      null &&
    metrics.maxRoughness <
      100
  ) {
    pros.push(
      'No sampled waypoint reaches the 100 m roughness guidance threshold.',
    )
  }

  if (
    metrics.maxSlope !=
      null &&
    metrics.maxSlope >=
      25
  ) {
    cons.push(
      'At least one sampled waypoint reaches 25° or greater local slope and requires manual review.',
    )
  } else if (
    metrics.maxSlope !=
      null &&
    metrics.maxSlope >=
      15
  ) {
    cons.push(
      'At least one sampled waypoint reaches 15° or greater local slope and requires manual review.',
    )
  }

  if (
    metrics.maxRoughness !=
      null &&
    metrics.maxRoughness >=
      100
  ) {
    cons.push(
      'At least one sampled waypoint reaches 100 m or greater local MOLA roughness.',
    )
  }

  if (
    metrics.coverage <
      1
  ) {
    cons.push(
      `${metrics.waypointCount - metrics.availableWaypoints} waypoint(s) have unavailable local MOLA analysis.`,
    )
  }

  if (!pros.length) {
    pros.push(
      'No additional positive threshold signal was derived from the sampled terrain.',
    )
  }

  if (!cons.length) {
    cons.push(
      'No threshold-based terrain warning was triggered at the sampled waypoints.',
    )
  }

  return {
    pros,
    cons,
  }
}


function ComparisonMap({
  routes,
}) {
  const colouredRoutes =
    routes.map(
      (
        route,
        index,
      ) => ({
        ...route,

        colour:
          COMPARISON_COLOURS[
            index %
              COMPARISON_COLOURS.length
          ],
      }),
    )

  return (
    <div
      style={{
        position:
          'relative',

        width:
          '100%',

        height:
          '520px',

        border:
          '1px solid rgba(117,230,255,0.18)',

        background:
          '#060b0f',

        overflow:
          'hidden',
      }}
    >
      <MarsMap
        features={[]}

        selectedFeature={
          null
        }

        selectedLocation={
          null
        }

        customPlaces={[]}

        safeHavens={[]}

        routeMode={
          false
        }

        routePoints={[]}

        routePlan={
          null
        }

        comparisonMode={
          true
        }

        comparisonRoutes={
          colouredRoutes
        }

        interactive={
          true
        }
      />
    </div>
  )
}


function RouteComparisonWorkspace({
  routes,
  compareRouteIds,
  onToggleRoute,
  onClose,
  onDeleteRoute,
}) {
  const selectedRoutes =
    routes.filter(
      (
        route,
      ) =>
        compareRouteIds.includes(
          route.id,
        ),
    )

  return (
    <div
      style={{
        position:
          'fixed',

        inset:
          0,

        zIndex:
          4000,

        display:
          'flex',

        alignItems:
          'center',

        justifyContent:
          'center',

        padding:
          '24px',

        background:
          'rgba(3,7,9,0.78)',

        backdropFilter:
          'blur(14px)',

        WebkitBackdropFilter:
          'blur(14px)',
      }}
    >
      <div
        style={{
          width:
            'min(1450px, 100%)',

          height:
            'min(920px, calc(100vh - 48px))',

          overflow:
            'auto',

          border:
            '1px solid rgba(117,230,255,0.24)',

          background:
            'linear-gradient(180deg, rgba(10,17,22,0.96), rgba(5,10,13,0.97))',

          boxShadow:
            '0 30px 100px rgba(0,0,0,0.65)',

          backdropFilter:
            'blur(18px)',

          WebkitBackdropFilter:
            'blur(18px)',
        }}
      >
        <div
          style={{
            position:
              'sticky',

            top:
              0,

            zIndex:
              3,

            display:
              'flex',

            justifyContent:
              'space-between',

            alignItems:
              'center',

            gap:
              '16px',

            padding:
              '14px 16px',

            borderBottom:
              '1px solid rgba(117,230,255,0.13)',

            background:
              'rgba(7,13,17,0.96)',

            backdropFilter:
              'blur(16px)',

            WebkitBackdropFilter:
              'blur(16px)',
          }}
        >
          <div>
            <div
              style={{
                color:
                  '#75e6ff',

                fontSize:
                  '10px',

                letterSpacing:
                  '0.14em',
              }}
            >
              ROUTE ANALYSIS / LIQUID GLASS
            </div>

            <h2
              style={{
                margin:
                  '5px 0 0',

                fontSize:
                  '18px',

                letterSpacing:
                  '0.06em',
              }}
            >
              COMPARE MARSWALK ROUTES
            </h2>

            <small
              style={{
                color:
                  '#687b83',

                fontSize:
                  '10px',
              }}
            >
              Select up to four independent
              saved routes. All plotted routes
              remain visible simultaneously.
            </small>
          </div>

          <button
            type="button"
            onClick={
              onClose
            }
            style={{
              minWidth:
                '38px',

              minHeight:
                '38px',

              border:
                '1px solid #29414b',

              background:
                '#091115',

              color:
                '#a2b3b9',

              cursor:
                'pointer',

              fontSize:
                '20px',
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            padding:
              '14px 16px 20px',
          }}
        >
          <div
            style={{
              display:
                'flex',

              flexWrap:
                'wrap',

              gap:
                '6px',

              marginBottom:
                '12px',
            }}
          >
            {routes.map(
              (
                route,
                index,
              ) => {
                const active =
                  compareRouteIds.includes(
                    route.id,
                  )

                const colour =
                  COMPARISON_COLOURS[
                    index %
                      COMPARISON_COLOURS.length
                  ]

                return (
                  <button
                    key={
                      route.id
                    }
                    type="button"
                    onClick={() =>
                      onToggleRoute(
                        route.id,
                      )
                    }
                    style={{
                      minHeight:
                        '34px',

                      padding:
                        '0 10px',

                      border:
                        `1px solid ${
                          active
                            ? colour
                            : '#29414b'
                        }`,

                      background:
                        active
                          ? '#0d2028'
                          : '#0a1318',

                      color:
                        active
                          ? colour
                          : '#879aa2',

                      fontFamily:
                        'monospace',

                      fontSize:
                        '10px',

                      cursor:
                        'pointer',

                      boxShadow:
                        active
                          ? `0 0 12px ${colour}18`
                          : 'none',
                    }}
                  >
                    <span
                      style={{
                        display:
                          'inline-block',

                        width:
                          '15px',

                        height:
                          '3px',

                        marginRight:
                          '7px',

                        verticalAlign:
                          'middle',

                        background:
                          colour,
                      }}
                    />

                    {active
                      ? '✓ '
                      : ''}

                    {
                      route.name
                    }
                  </button>
                )
              },
            )}
          </div>

          {selectedRoutes.length >=
          2 ? (
            <>
              <ComparisonMap
                routes={
                  selectedRoutes
                }
              />

              <div
                style={{
                  display:
                    'grid',

                  gridTemplateColumns:
                    `repeat(${Math.min(
                      selectedRoutes.length,
                      4,
                    )}, minmax(0,1fr))`,

                  gap:
                    '10px',

                  marginTop:
                    '12px',

                  overflowX:
                    'auto',
                }}
              >
                {selectedRoutes.map(
                  (
                    route,
                    index,
                  ) => {
                    const metrics =
                      buildRouteMetrics(
                        route,
                      )

                    const {
                      pros,
                      cons,
                    } =
                      getRouteProsCons(
                        metrics,
                      )

                    const colour =
                      COMPARISON_COLOURS[
                        index %
                          COMPARISON_COLOURS.length
                      ]

                    return (
                      <div
                        key={
                          route.id
                        }
                        style={{
                          minWidth:
                            '250px',

                          padding:
                            '12px',

                          border:
                            `1px solid ${colour}44`,

                          background:
                            '#091216',
                        }}
                      >
                        <div
                          style={{
                            display:
                              'flex',

                            alignItems:
                              'center',

                            gap:
                              '7px',

                            color:
                              colour,

                            fontSize:
                              '8px',

                            letterSpacing:
                              '0.1em',
                          }}
                        >
                          <span
                            style={{
                              width:
                                '18px',

                              height:
                                '3px',

                              background:
                                colour,
                            }}
                          />

                          SAVED ROUTE
                        </div>

                        <strong
                          style={{
                            display:
                              'block',

                            marginTop:
                              '5px',

                            fontSize:
                              '13px',
                          }}
                        >
                          {
                            route.name
                          }
                        </strong>

                        <div
                          style={{
                            display:
                              'grid',

                            gridTemplateColumns:
                              '1fr 1fr',

                            gap:
                              '8px',

                            marginTop:
                              '12px',
                          }}
                        >
                          <Metric
                            label="Distance"
                            value={
                              metrics.distanceKm ==
                              null
                                ? '—'
                                : `${Number(
                                    metrics.distanceKm,
                                  ).toFixed(2)} km`
                            }
                          />

                          <Metric
                            label="Waypoints"
                            value={
                              metrics.waypointCount
                            }
                          />

                          <Metric
                            label="Max slope"
                            value={
                              metrics.maxSlope ==
                              null
                                ? '—'
                                : `${Number(
                                    metrics.maxSlope,
                                  ).toFixed(2)}°`
                            }
                          />

                          <Metric
                            label="Mean slope"
                            value={
                              metrics.meanSlope ==
                              null
                                ? '—'
                                : `${Number(
                                    metrics.meanSlope,
                                  ).toFixed(2)}°`
                            }
                          />

                          <Metric
                            label="Max roughness"
                            value={
                              metrics.maxRoughness ==
                              null
                                ? '—'
                                : `${Number(
                                    metrics.maxRoughness,
                                  ).toFixed(1)} m`
                            }
                          />

                          <Metric
                            label="Mean roughness"
                            value={
                              metrics.meanRoughness ==
                              null
                                ? '—'
                                : `${Number(
                                    metrics.meanRoughness,
                                  ).toFixed(1)} m`
                            }
                          />

                          <Metric
                            label="MOLA coverage"
                            value={`${(
                              metrics.coverage *
                              100
                            ).toFixed(0)}%`}
                          />

                          <Metric
                            label="Elevation range"
                            value={
                              metrics.elevationMin ==
                              null ||
                              metrics.elevationMax ==
                                null
                                ? '—'
                                : `${Number(
                                    metrics.elevationMin,
                                  ).toFixed(0)} → ${Number(
                                    metrics.elevationMax,
                                  ).toFixed(0)} m`
                            }
                          />
                        </div>

                        <div
                          style={{
                            marginTop:
                              '10px',

                            padding:
                              '9px',

                            border:
                              '1px solid rgba(140,240,177,0.1)',

                            background:
                              '#081014',
                          }}
                        >
                          <div
                            style={{
                              color:
                                '#8cf0b1',

                              fontSize:
                                '8px',

                              letterSpacing:
                                '0.1em',
                            }}
                          >
                            PROS
                          </div>

                          {pros.map(
                            (
                              item,
                            ) => (
                              <p
                                key={
                                  item
                                }
                                style={{
                                  margin:
                                    '6px 0 0',

                                  color:
                                    '#9fb5bc',

                                  fontSize:
                                    '10px',

                                  lineHeight:
                                    1.45,
                                }}
                              >
                                + {item}
                              </p>
                            ),
                          )}
                        </div>

                        <div
                          style={{
                            marginTop:
                              '8px',

                            padding:
                              '9px',

                            border:
                              '1px solid rgba(255,159,104,0.12)',

                            background:
                              '#100e0b',
                          }}
                        >
                          <div
                            style={{
                              color:
                                '#ffb48b',

                              fontSize:
                                '8px',

                              letterSpacing:
                                '0.1em',
                            }}
                          >
                            CONS / REVIEW
                          </div>

                          {cons.map(
                            (
                              item,
                            ) => (
                              <p
                                key={
                                  item
                                }
                                style={{
                                  margin:
                                    '6px 0 0',

                                  color:
                                    '#a99d91',

                                  fontSize:
                                    '10px',

                                  lineHeight:
                                    1.45,
                                }}
                              >
                                − {item}
                              </p>
                            ),
                          )}
                        </div>

                        {metrics.warnings
                          .length >
                          0 && (
                          <div
                            style={{
                              marginTop:
                                '9px',

                              color:
                                '#8f9ba0',

                              fontSize:
                                '9px',

                              lineHeight:
                                1.45,
                            }}
                          >
                            <span
                              style={{
                                color:
                                  '#75e6ff',
                              }}
                            >
                              GUIDANCE
                            </span>

                            {metrics.warnings.map(
                              (
                                warning,
                              ) => (
                                <p
                                  key={
                                    warning
                                  }
                                  style={{
                                    margin:
                                      '5px 0 0',
                                  }}
                                >
                                  {
                                    warning
                                  }
                                </p>
                              ),
                            )}
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            onDeleteRoute(
                              route.id,
                            )
                          }
                          style={{
                            width:
                              '100%',

                            marginTop:
                              '10px',

                            minHeight:
                              '30px',

                            border:
                              '1px solid #5b3037',

                            background:
                              'transparent',

                            color:
                              '#ff9aa9',

                            fontFamily:
                              'monospace',

                            fontSize:
                              '8px',

                            cursor:
                              'pointer',
                          }}
                        >
                          DELETE SAVED ROUTE
                        </button>
                      </div>
                    )
                  },
                )}
              </div>
            </>
          ) : (
            <div
              style={{
                minHeight:
                  '320px',

                display:
                  'grid',

                placeItems:
                  'center',

                border:
                  '1px dashed #29414b',

                background:
                  '#081014',

                color:
                  '#71848c',

                fontSize:
                  '10px',

                letterSpacing:
                  '0.08em',

                textAlign:
                  'center',

                padding:
                  '20px',
              }}
            >
              SELECT AT LEAST TWO SAVED ROUTES
              <br />
              MAXIMUM COMPARISON: FOUR
            </div>
          )}
        </div>
      </div>
    </div>
  )
}


export default function App() {
  const [
    places,
    setPlaces,
  ] = useState([])

  const [
    query,
    setQuery,
  ] = useState('')

  const [
    suggestions,
    setSuggestions,
  ] = useState([])

  const [
    selectedFeature,
    setSelectedFeature,
  ] = useState(null)

  const [
    activeCustomPlace,
    setActiveCustomPlace,
  ] = useState(null)

  const [
    selectedLocation,
    setSelectedLocation,
  ] = useState(null)

  const [
    environment,
    setEnvironment,
  ] = useState(null)

  const [
    loading,
    setLoading,
  ] = useState(true)

  const [
    error,
    setError,
  ] = useState('')

  const [
    backendConnected,
    setBackendConnected,
  ] = useState(false)

  const [
    routeMode,
    setRouteMode,
  ] = useState(false)

  const [
    routePoints,
    setRoutePoints,
  ] = useState([])

  const [
    routePlan,
    setRoutePlan,
  ] = useState(null)

  const [
    routeLoading,
    setRouteLoading,
  ] = useState(false)

  const [
    customPlaces,
    setCustomPlaces,
  ] = useState(
    () =>
      readStorage(
        STORAGE_KEYS.customPlaces,
        [],
      ),
  )

  const [
    safeHavens,
    setSafeHavens,
  ] = useState(
    () =>
      readStorage(
        STORAGE_KEYS.safeHavens,
        [],
      ),
  )

  const [
    savedRoutes,
    setSavedRoutes,
  ] = useState(
    () =>
      readStorage(
        STORAGE_KEYS.routes,
        [],
      ),
  )

  const [
    compareRouteIds,
    setCompareRouteIds,
  ] = useState([])

  const [
    comparisonOpen,
    setComparisonOpen,
  ] = useState(false)

  const [
    missionMenuOpen,
    setMissionMenuOpen,
  ] = useState(false)

  const [
    todoText,
    setTodoText,
  ] = useState(
    () =>
      readStorage(
        STORAGE_KEYS.todo,
        '',
      ),
  )

  const [
    checklist,
    setChecklist,
  ] = useState(
    () =>
      readStorage(
        STORAGE_KEYS.checklist,
        [],
      ),
  )


  useEffect(() => {
    writeStorage(
      STORAGE_KEYS.customPlaces,
      customPlaces,
    )
  }, [
    customPlaces,
  ])


  useEffect(() => {
    writeStorage(
      STORAGE_KEYS.safeHavens,
      safeHavens,
    )
  }, [
    safeHavens,
  ])


  useEffect(() => {
    writeStorage(
      STORAGE_KEYS.routes,
      savedRoutes,
    )
  }, [
    savedRoutes,
  ])


  useEffect(() => {
    writeStorage(
      STORAGE_KEYS.todo,
      todoText,
    )
  }, [
    todoText,
  ])


  useEffect(() => {
    writeStorage(
      STORAGE_KEYS.checklist,
      checklist,
    )
  }, [
    checklist,
  ])


  /*
   * REAL BACKEND STATUS
   *
   * SYSTEM ONLINE  = /api responds successfully
   * SYSTEM DEGRADED = backend is unreachable or unhealthy
   */
  useEffect(() => {
    let cancelled =
      false

    async function checkBackend() {
      try {
        const response =
          await fetch(
            '/api/places?limit=1',
            {
              cache:
                'no-store',
            },
          )

        if (
          cancelled
        ) {
          return
        }

        setBackendConnected(
          response.ok,
        )
      } catch {
        if (
          !cancelled
        ) {
          setBackendConnected(
            false,
          )
        }
      }
    }

    checkBackend()

    const interval =
      window.setInterval(
        checkBackend,
        10000,
      )

    return () => {
      cancelled =
        true

      window.clearInterval(
        interval,
      )
    }
  }, [])


  /*
   * IMPORTANT:
   *
   * nearest_feature is NOT selectedFeature.
   *
   * For an unnamed coordinate, the exact coordinate remains
   * the selected identity.
   */
  const namedFeature =
    environment
      ?.gazetteer
      ?.selected_feature ??
    selectedFeature ??
    null

  const displayName =
    namedFeature
      ?.feature_name ??
    activeCustomPlace
      ?.name ??
    selectedLocation
      ?.label ??
    'UNNAMED LOCATION'

  const displayType =
    namedFeature
      ?.feature_type ??
    (
      activeCustomPlace
        ? 'USER PLACE'
        : selectedLocation
          ? 'COORDINATE SELECTION'
          : 'NO LOCATION'
    )

  const thermal =
    environment
      ?.thermal
      ?.observations
      ?.[0]

  const thermalEvidence =
    thermal?.evidence

  const dust =
    environment?.dust

  const terrain =
    environment?.terrain

  const solar =
    environment?.solar

  const siteScience =
    environment?.site_science

  const comparisonRoutes =
    useMemo(
      () =>
        savedRoutes.filter(
          (
            route,
          ) =>
            compareRouteIds.includes(
              route.id,
            ),
        ),
      [
        savedRoutes,
        compareRouteIds,
      ],
    )


  useEffect(() => {
    let cancelled =
      false

    async function initialize() {
      try {
        setLoading(
          true,
        )

        setError('')

        const [
          placesResponse,
          marsResponse,
        ] =
          await Promise.all([
            fetchPlaces(
              2052,
            ),

            fetchEnvironmentByPlace(
              DEFAULT_PLACE,
              DEFAULT_SOL,
            ),
          ])

        if (
          cancelled
        ) {
          return
        }

        const featureList =
          placesResponse.features ??
          []

        const initialFeature =
          marsResponse
            ?.gazetteer
            ?.selected_feature ??
          null

        setPlaces(
          featureList,
        )

        setEnvironment(
          marsResponse,
        )

        setSelectedFeature(
          initialFeature,
        )

        setActiveCustomPlace(
          null,
        )

        setSelectedLocation(
          initialFeature
            ? normaliseLocation(
                initialFeature,
                initialFeature.feature_name,
              )
            : null,
        )

        setQuery(
          marsResponse
            ?.query
            ?.resolved_name ??
          initialFeature
            ?.feature_name ??
          DEFAULT_PLACE,
        )

        setBackendConnected(
          true,
        )
      } catch (
        err
      ) {
        if (
          !cancelled
        ) {
          setError(
            err.message,
          )

          setBackendConnected(
            false,
          )
        }
      } finally {
        if (
          !cancelled
        ) {
          setLoading(
            false,
          )
        }
      }
    }

    initialize()

    return () => {
      cancelled =
        true
    }
  }, [])


  useEffect(() => {
    const value =
      query.trim()

    if (!value) {
      setSuggestions(
        [],
      )

      return undefined
    }

    if (
      selectedFeature &&
      value.toLowerCase() ===
        String(
          selectedFeature.feature_name,
        ).toLowerCase()
    ) {
      setSuggestions(
        [],
      )

      return undefined
    }

    const controller =
      new AbortController()

    const timer =
      setTimeout(
        async () => {
          try {
            const response =
              await fetchPlaceSuggestions(
                value,
                8,
              )

            if (
              !controller
                .signal
                .aborted
            ) {
              setSuggestions(
                response
                  .suggestions ??
                [],
              )
            }
          } catch {
            if (
              !controller
                .signal
                .aborted
            ) {
              setSuggestions(
                [],
              )
            }
          }
        },
        180,
      )

    return () => {
      controller.abort()

      clearTimeout(
        timer,
      )
    }
  }, [
    query,
    selectedFeature,
  ])


  async function handleSelectPlace(
    feature,
  ) {
    try {
      setQuery(
        feature.feature_name,
      )

      setSuggestions(
        [],
      )

      setSelectedFeature(
        feature,
      )

      setActiveCustomPlace(
        null,
      )

      setSelectedLocation(
        normaliseLocation(
          feature,
          feature.feature_name,
        ),
      )

      setEnvironment(
        null,
      )

      setLoading(
        true,
      )

      setError('')

      const response =
        await fetchEnvironmentByPlace(
          feature.feature_name,
          DEFAULT_SOL,
        )

      setEnvironment(
        response,
      )

      const resolvedFeature =
        response
          ?.gazetteer
          ?.selected_feature ??
        feature

      setSelectedFeature(
        resolvedFeature,
      )

      setSelectedLocation(
        normaliseLocation(
          resolvedFeature,
          resolvedFeature.feature_name,
        ),
      )

      setBackendConnected(
        true,
      )
    } catch (
      err
    ) {
      setError(
        err.message,
      )

      if (
        isNetworkFailure(
          err,
        )
      ) {
        setBackendConnected(
          false,
        )
      }
    } finally {
      setLoading(
        false,
      )
    }
  }


  async function handleSelectCoordinate(
    point,
  ) {
    const location =
      normaliseLocation(
        point,
        null,
      )

    try {
      setQuery('')

      setSuggestions(
        [],
      )

      setSelectedFeature(
        null,
      )

      setActiveCustomPlace(
        null,
      )

      setSelectedLocation(
        location,
      )

      setEnvironment(
        null,
      )

      setLoading(
        true,
      )

      setError('')

      const response =
        await fetchEnvironmentByCoordinate(
          location.latitude_deg,
          location.longitude_deg,
          DEFAULT_SOL,
        )

      /*
       * Do NOT promote nearest_feature.
       *
       * The coordinate is still the selected site.
       */
      setEnvironment(
        response,
      )

      setBackendConnected(
        true,
      )
    } catch (
      err
    ) {
      setError(
        err.message,
      )

      if (
        isNetworkFailure(
          err,
        )
      ) {
        setBackendConnected(
          false,
        )
      }
    } finally {
      setLoading(
        false,
      )
    }
  }


  async function handleSelectCustomPlace(
    place,
  ) {
    const location =
      normaliseLocation(
        place,
        place.name,
      )

    try {
      setQuery('')

      setSuggestions(
        [],
      )

      setSelectedFeature(
        null,
      )

      setActiveCustomPlace(
        place,
      )

      setSelectedLocation(
        location,
      )

      setEnvironment(
        null,
      )

      setLoading(
        true,
      )

      setError('')

      const response =
        await fetchEnvironmentByCoordinate(
          location.latitude_deg,
          location.longitude_deg,
          DEFAULT_SOL,
        )

      setEnvironment(
        response,
      )

      setBackendConnected(
        true,
      )
    } catch (
      err
    ) {
      setError(
        err.message,
      )

      if (
        isNetworkFailure(
          err,
        )
      ) {
        setBackendConnected(
          false,
        )
      }
    } finally {
      setLoading(
        false,
      )
    }
  }


  async function handleSelectSafeHaven(
    haven,
  ) {
    const location =
      normaliseLocation(
        haven,
        haven.name,
      )

    try {
      setQuery('')

      setSuggestions(
        [],
      )

      setSelectedFeature(
        null,
      )

      setActiveCustomPlace(
        null,
      )

      setSelectedLocation(
        location,
      )

      setEnvironment(
        null,
      )

      setLoading(
        true,
      )

      setError('')

      const response =
        await fetchEnvironmentByCoordinate(
          location.latitude_deg,
          location.longitude_deg,
          DEFAULT_SOL,
        )

      setEnvironment(
        response,
      )

      setBackendConnected(
        true,
      )
    } catch (
      err
    ) {
      setError(
        err.message,
      )

      if (
        isNetworkFailure(
          err,
        )
      ) {
        setBackendConnected(
          false,
        )
      }
    } finally {
      setLoading(
        false,
      )
    }
  }


  function normaliseRoutePoint(
    point,
    fallbackLabel = null,
  ) {
    return {
      latitude_deg:
        Number(
          point.latitude_deg,
        ),

      longitude_deg:
        normaliseLongitude(
          point.longitude_deg,
        ),

      label:
        point.label ??
        fallbackLabel ??
        null,
    }
  }


  function handleRoutePointAdd(
    point,
  ) {
    const nextPoint =
      normaliseRoutePoint(
        point,
        point.label ??
          null,
      )

    setError('')

    setRoutePlan(
      null,
    )

    setRoutePoints(
      (
        current,
      ) => {
        if (
          current.length >=
          MAX_ROUTE_POINTS
        ) {
          return current
        }

        return [
          ...current,
          {
            ...nextPoint,

            label:
              nextPoint.label ||
              `WP ${
                current.length +
                1
              }`,
          },
        ]
      },
    )
  }


  function handleMapLocationSelect(
    point,
  ) {
    if (
      routeMode
    ) {
      handleRoutePointAdd(
        point,
      )

      return
    }

    handleSelectCoordinate(
      point,
    )
  }


  function handleAddSelected() {
    if (
      !selectedLocation ||
      routePoints.length >=
        MAX_ROUTE_POINTS
    ) {
      return
    }

    handleRoutePointAdd({
      latitude_deg:
        selectedLocation.latitude_deg,

      longitude_deg:
        selectedLocation.longitude_deg,

      label:
        selectedLocation
          .label ??
        activeCustomPlace
          ?.name ??
        namedFeature
          ?.feature_name ??
        null,
    })
  }


  function removeLastWaypoint() {
    setRoutePoints(
      (
        current,
      ) =>
        current.slice(
          0,
          -1,
        ),
    )

    setRoutePlan(
      null,
    )
  }


  async function handleAnalyzeRoute() {
    if (
      routePoints.length <
      2
    ) {
      return
    }

    try {
      setRouteLoading(
        true,
      )

      setError('')

      const response =
        await fetchRoutePlan(
          routePoints,
        )

      setRoutePlan(
        response,
      )

      setRouteMode(
        false,
      )

      setBackendConnected(
        true,
      )
    } catch (
      err
    ) {
      setRoutePlan(
        null,
      )

      setError(
        err.message,
      )

      if (
        isNetworkFailure(
          err,
        )
      ) {
        setBackendConnected(
          false,
        )
      }
    } finally {
      setRouteLoading(
        false,
      )
    }
  }


  function toggleRouteMode() {
    /*
     * Starting a new route after an analysed route should
     * always start with a clean waypoint editor.
     */
    setRouteMode(
      (
        active,
      ) => {
        if (
          !active
        ) {
          setRoutePoints(
            [],
          )

          setRoutePlan(
            null,
          )
        }

        return !active
      },
    )
  }


  function clearRoute() {
    setRoutePoints(
      [],
    )

    setRoutePlan(
      null,
    )

    setRouteMode(
      false,
    )
  }


  function handleCreateUserPlace(
    point,
  ) {
    const latitude =
      Number(
        point.latitude_deg ??
          point.lat,
      )

    const longitude =
      normaliseLongitude(
        point.longitude_deg ??
          point.lng,
      )

    const name =
      String(
        point.name ??
          '',
      ).trim()

    if (
      !name ||
      !Number.isFinite(
        latitude,
      ) ||
      !Number.isFinite(
        longitude,
      )
    ) {
      return
    }

    const customPlace =
      {
        id:
          createId(
            'place',
          ),

        name,

        latitude_deg:
          latitude,

        longitude_deg:
          longitude,

        feature_name:
          name,

        feature_type:
          'USER PLACE',

        createdAt:
          new Date().toISOString(),
      }

    setCustomPlaces(
      (
        current,
      ) => [
        ...current,
        customPlace,
      ],
    )

    setActiveCustomPlace(
      customPlace,
    )

    setSelectedFeature(
      null,
    )

    setSelectedLocation(
      {
        latitude_deg:
          latitude,

        longitude_deg:
          longitude,

        label:
          name,
      },
    )

    setQuery('')

    setSuggestions(
      [],
    )
  }


  function handleCreateSafeHaven(
    point,
  ) {
    const latitude =
      Number(
        point.latitude_deg ??
          point.lat,
      )

    const longitude =
      normaliseLongitude(
        point.longitude_deg ??
          point.lng,
      )

    if (
      !Number.isFinite(
        latitude,
      ) ||
      !Number.isFinite(
        longitude,
      )
    ) {
      return
    }

    const fallback =
      `Safe Haven ${
        safeHavens.length +
        1
      }`

    const name =
      String(
        point.name ??
          '',
      ).trim() ||
      fallback

    const haven =
      {
        id:
          createId(
            'haven',
          ),

        name,

        latitude_deg:
          latitude,

        longitude_deg:
          longitude,

        createdAt:
          new Date().toISOString(),
      }

    setSafeHavens(
      (
        current,
      ) => [
        ...current,
        haven,
      ],
    )
  }


  function handleSavePlace() {
    if (
      !selectedLocation
    ) {
      return
    }

    const defaultName =
      activeCustomPlace
        ?.name ??
      selectedLocation
        .label ??
      'Mars location'

    const name =
      window.prompt(
        'Name this Mars place:',
        defaultName,
      )

    if (
      !name?.trim()
    ) {
      return
    }

    handleCreateUserPlace({
      ...selectedLocation,

      name:
        name.trim(),
    })
  }


  function handleAddSafeHaven() {
    if (
      !selectedLocation
    ) {
      return
    }

    const defaultName =
      `Safe Haven ${
        safeHavens.length +
        1
      }`

    const name =
      window.prompt(
        'Optional Safe Haven name:',
        defaultName,
      )

    if (
      name ===
      null
    ) {
      return
    }

    handleCreateSafeHaven({
      ...selectedLocation,

      name:
        name.trim() ||
        defaultName,
    })
  }


  function handleSaveRoute() {
    if (
      !routePlan ||
      routePoints.length <
        2
    ) {
      return
    }

    const defaultName =
      `Marswalk ${
        savedRoutes.length +
        1
      }`

    const name =
      window.prompt(
        'Name this route:',
        defaultName,
      )

    if (
      !name?.trim()
    ) {
      return
    }

    /*
     * Deep-copy the route plan so the saved route can never
     * be mutated by the next route being created.
     */
    const savedRoute =
      {
        id:
          createId(
            'route',
          ),

        name:
          name.trim(),

        createdAt:
          new Date().toISOString(),

        points:
          routePoints.map(
            (
              point,
            ) => ({
              ...point,
            }),
          ),

        plan:
          JSON.parse(
            JSON.stringify(
              routePlan,
            ),
          ),
      }

    setSavedRoutes(
      (
        current,
      ) => [
        ...current,
        savedRoute,
      ],
    )

    /*
     * Put the newly saved route into comparison automatically
     * while capacity remains.
     */
    setCompareRouteIds(
      (
        current,
      ) => {
        if (
          current.includes(
            savedRoute.id,
          )
        ) {
          return current
        }

        if (
          current.length >=
          MAX_COMPARE_ROUTES
        ) {
          return current
        }

        return [
          ...current,
          savedRoute.id,
        ]
      },
    )

    /*
     * CRITICAL:
     *
     * Saving a route finalises that route and clears the editor.
     * Route 2 therefore starts independently from Route 1.
     */
    setRoutePoints(
      [],
    )

    setRoutePlan(
      null,
    )

    setRouteMode(
      false,
    )
  }


  function handleToggleCompareRoute(
    routeId,
  ) {
    setCompareRouteIds(
      (
        current,
      ) => {
        if (
          current.includes(
            routeId,
          )
        ) {
          return current.filter(
            (
              id,
            ) =>
              id !==
              routeId,
          )
        }

        if (
          current.length >=
          MAX_COMPARE_ROUTES
        ) {
          return current
        }

        return [
          ...current,
          routeId,
        ]
      },
    )
  }


  function handleOpenComparison() {
    let ids =
      compareRouteIds

    if (
      ids.length <
      2
    ) {
      ids =
        savedRoutes
          .slice(
            0,
            2,
          )
          .map(
            (
              route,
            ) =>
              route.id,
          )

      setCompareRouteIds(
        ids,
      )
    }

    if (
      ids.length >=
      2
    ) {
      setComparisonOpen(
        true,
      )
    }
  }


  function handleDeleteSavedRoute(
    routeId,
  ) {
    setSavedRoutes(
      (
        current,
      ) =>
        current.filter(
          (
            route,
          ) =>
            route.id !==
            routeId,
        ),
    )

    setCompareRouteIds(
      (
        current,
      ) =>
        current.filter(
          (
            id,
          ) =>
            id !==
            routeId,
        ),
    )
  }


  function handleChecklistTextChange(
    id,
    value,
  ) {
    setChecklist(
      (
        current,
      ) => {
        const next =
          current.map(
            (
              item,
            ) =>
              item.id ===
              id
                ? {
                    ...item,
                    text:
                      value,
                  }
                : item,
          )

        const totalWords =
          countWords(
            next
              .map(
                (
                  item,
                ) =>
                  item.text,
              )
              .join(' '),
          )

        if (
          totalWords <=
          MAX_CHECKLIST_WORDS
        ) {
          return next
        }

        let remaining =
          MAX_CHECKLIST_WORDS

        return next.map(
          (
            item,
          ) => {
            const words =
              item.text
                .trim()
                .split(
                  /\s+/,
                )
                .filter(
                  Boolean,
                )

            const allowed =
              words.slice(
                0,
                Math.max(
                  0,
                  remaining,
                ),
              )

            remaining -=
              allowed.length

            return {
              ...item,
              text:
                allowed.join(
                  ' ',
                ),
            }
          },
        )
      },
    )
  }


  function handleChecklistToggle(
    id,
  ) {
    setChecklist(
      (
        current,
      ) =>
        current.map(
          (
            item,
          ) =>
            item.id ===
            id
              ? {
                  ...item,
                  done:
                    !item.done,
                }
              : item,
        ),
    )
  }


  function handleAddChecklistItem() {
    if (
      checklist.length >=
      MAX_CHECKLIST_POINTS
    ) {
      return
    }

    const totalWords =
      countWords(
        checklist
          .map(
            (
              item,
            ) =>
              item.text,
          )
          .join(' '),
      )

    if (
      totalWords >=
      MAX_CHECKLIST_WORDS
    ) {
      return
    }

    setChecklist(
      (
        current,
      ) => [
        ...current,
        {
          id:
            createId(
              'check',
            ),

          text:
            '',

          done:
            false,
        },
      ],
    )
  }


  function handleRemoveChecklistItem(
    id,
  ) {
    setChecklist(
      (
        current,
      ) =>
        current.filter(
          (
            item,
          ) =>
            item.id !==
            id,
        ),
    )
  }


  function buildMissionExport() {
    return {
      project:
        'NeuroNexus — Martian Map',

      event:
        'NASA Space Apps Challenge 2026',

      exported_at:
        new Date().toISOString(),

      sol:
        DEFAULT_SOL,

      system: {
        backend_connected:
          backendConnected,
      },

      selection: {
        mode:
          namedFeature
            ? 'named_feature'
            : activeCustomPlace
              ? 'user_place'
              : selectedLocation
                ? 'coordinate'
                : 'none',

        name:
          displayName,

        type:
          displayType,

        latitude_deg:
          selectedLocation
            ?.latitude_deg ??
          null,

        longitude_deg:
          selectedLocation
            ?.longitude_deg ??
          null,

        selected_feature:
          namedFeature,

        custom_place:
          activeCustomPlace,
      },

      environment,

      site_science:
        siteScience,

      current_route: {
        points:
          routePoints,

        plan:
          routePlan,
      },

      saved_routes:
        savedRoutes,

      safe_havens:
        safeHavens,

      custom_places:
        customPlaces,

      mission_notes: {
        todo:
          todoText,

        checklist:
          checklist,
      },

      provenance: {
        usgs:
          'USGS / IAU Mars nomenclature feature layer',

        themis:
          'NASA THEMIS historical IR-PBT observations',

        mola:
          'NASA MOLA MEGDR 128 pixels/degree',

        atmosphere:
          'NASA Ames modeled MY34 environment scenario',

        rover_media:
          'NASA rover image sources exposed by NeuroNexus',

        routing:
          'NeuroNexus user-defined Haversine waypoint geometry',

        terrain_guidance:
          'NeuroNexus research aid using local MOLA waypoint samples',

        note:
          'Observed, modeled, derived and unavailable evidence are kept explicitly distinct.',
      },
    }
  }


  function handleExportJson() {
    downloadTextFile(
      `neuronexus-mars-observation-${Date.now()}.json`,

      JSON.stringify(
        buildMissionExport(),
        null,
        2,
      ),

      'application/json',
    )
  }


  function handleExportCsv() {
    const rows =
      routePlan
        ?.waypoint_analysis ??
      []

    const header = [
      'index',
      'label',
      'latitude_deg',
      'longitude_deg',
      'status',
      'elevation_m',
      'slope_deg',
      'aspect_deg',
      'roughness_m',
      'local_elevation_min_m',
      'local_elevation_max_m',
    ]

    const csvRows =
      rows.map(
        (
          row,
          index,
        ) =>
          [
            index + 1,

            `"${String(
              row.label ??
                '',
            ).replaceAll(
              '"',
              '""',
            )}"`,

            row.latitude_deg ??
              '',

            row.longitude_deg ??
              '',

            row.status ??
              '',

            row.elevation_m ??
              '',

            row.slope_deg ??
              '',

            row.aspect_deg ??
              '',

            row.roughness_m ??
              '',

            row.local_elevation_min_m ??
              '',

            row.local_elevation_max_m ??
              '',
          ].join(','),
      )

    const csv =
      [
        header.join(','),
        ...csvRows,
      ].join('\n')

    downloadTextFile(
      `neuronexus-route-${Date.now()}.csv`,
      csv,
      'text/csv;charset=utf-8',
    )
  }


  function handlePrint() {
    setMissionMenuOpen(
      false,
    )

    window.setTimeout(
      () =>
        window.print(),
      60,
    )
  }


  return (
    <main className="mission-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-kicker">
            NASA SPACE APPS 2026
          </div>

          <h1>
            NEURONEXUS
          </h1>

          <span>
            MARTIAN MAP / MISSION CONTROL
          </span>
        </div>

        <SearchBar
          query={
            query
          }
          suggestions={
            suggestions
          }
          onQueryChange={
            setQuery
          }
          onSelect={
            handleSelectPlace
          }
        />

        <div
          className="mission-state"
          style={{
            display:
              'flex',

            alignItems:
              'flex-end',

            justifyContent:
              'center',

            gap:
              '12px',
          }}
        >
          <div
            style={{
              display:
                'flex',

              gap:
                '14px',

              alignItems:
                'center',
            }}
          >
            <div>
              <span className="state-label">
                SOL
              </span>

              <strong>
                {
                  DEFAULT_SOL
                }
              </strong>
            </div>

            <div>
              <span className="state-label">
                FEATURES
              </span>

              <strong>
                {
                  places.length.toLocaleString()
                }
              </strong>
            </div>
          </div>

          <div
            style={{
              display:
                'flex',

              flexDirection:
                'column',

              alignItems:
                'flex-end',

              gap:
                '6px',
            }}
          >
            <div
              className="status-dot"
              style={
                backendConnected
                  ? undefined
                  : {
                      color:
                        '#ff647c',

                      borderColor:
                        'rgba(255,100,124,0.24)',
                    }
              }
              title={
                backendConnected
                  ? 'NeuroNexus backend reachable'
                  : 'NeuroNexus backend unavailable'
              }
            >
              <span
                style={
                  backendConnected
                    ? undefined
                    : {
                        background:
                          '#ff5267',

                        boxShadow:
                          '0 0 12px rgba(255,82,103,0.75)',
                      }
                }
              />

              {backendConnected
                ? 'SYSTEM ONLINE'
                : 'SYSTEM DEGRADED'}
            </div>

            <button
              type="button"
              aria-label="Open mission workspace"
              aria-expanded={
                missionMenuOpen
              }
              onClick={() =>
                setMissionMenuOpen(
                  (
                    open,
                  ) =>
                    !open,
                )
              }
              style={{
                minWidth:
                  '42px',

                minHeight:
                  '32px',

                border:
                  '1px solid #29414b',

                background:
                  '#091115',

                color:
                  '#75e6ff',

                fontFamily:
                  'monospace',

                fontSize:
                  '18px',

                lineHeight:
                  1,

                cursor:
                  'pointer',

                boxShadow:
                  '0 0 16px rgba(117,230,255,0.06)',
              }}
            >
              ☰
            </button>
          </div>
        </div>
      </header>

      <MissionMenu
        open={
          missionMenuOpen
        }
        onClose={() =>
          setMissionMenuOpen(
            false,
          )
        }
        todoText={
          todoText
        }
        setTodoText={
          setTodoText
        }
        checklist={
          checklist
        }
        onChecklistTextChange={
          handleChecklistTextChange
        }
        onChecklistToggle={
          handleChecklistToggle
        }
        onAddChecklistItem={
          handleAddChecklistItem
        }
        onRemoveChecklistItem={
          handleRemoveChecklistItem
        }
        onExportJson={
          handleExportJson
        }
        onExportCsv={
          handleExportCsv
        }
        onPrint={
          handlePrint
        }
      />

      {error && (
        <div
          style={{
            margin:
              '0 10px 8px',

            padding:
              '8px 10px',

            border:
              '1px solid rgba(255,138,138,0.32)',

            background:
              'rgba(36,14,16,0.92)',

            color:
              '#ffb0b0',

            fontFamily:
              'monospace',

            fontSize:
              '9px',
          }}
        >
          REQUEST ERROR —{' '}
          {error}
        </div>
      )}

      <div className="workspace">
        <aside className="left-column">
          <Panel
            eyebrow="GEOGRAPHY / NOMENCLATURE"
            title="Selected site"
          >
            <div className="place-title">
              <span className="signal">
                ●
              </span>

              <div>
                <h3>
                  {loading &&
                  !selectedLocation
                    ? 'Loading'
                    : displayName}
                </h3>

                <p>
                  {
                    displayType
                  }
                </p>
              </div>
            </div>

            <div className="coordinate-block">
              <span>
                LATITUDE
              </span>

              <strong>
                {selectedLocation
                  ? `${Number(
                      selectedLocation.latitude_deg,
                    ).toFixed(4)}°`
                  : '—'}
              </strong>

              <span>
                LONGITUDE
              </span>

              <strong>
                {selectedLocation
                  ? `${Number(
                      selectedLocation.longitude_deg,
                    ).toFixed(4)}°E`
                  : '—'}
              </strong>
            </div>

            <div className="rule" />

            <Metric
              label="Selection source"
              value={
                namedFeature
                  ? 'USGS / IAU FEATURE'
                  : activeCustomPlace
                    ? 'USER PLACE'
                    : selectedLocation
                      ? 'COORDINATE SELECTION'
                      : '—'
              }
            />

            {namedFeature ? (
              <>
                <Metric
                  label="Diameter"
                  value={
                    namedFeature
                      .diameter_km ==
                    null
                      ? '—'
                      : `${Number(
                          namedFeature.diameter_km,
                        ).toFixed(2)} km`
                  }
                  detail="USGS / IAU nomenclature"
                />

                <Metric
                  label="Approval"
                  value={
                    namedFeature
                      .approval_status
                  }
                />

                <Metric
                  label="Quadrangle"
                  value={
                    namedFeature
                      .quadrangle_name
                  }
                  detail={
                    namedFeature
                      .quadrangle_code
                  }
                />
              </>
            ) : (
              <div
                style={{
                  marginTop:
                    '4px',

                  padding:
                    '9px',

                  border:
                    '1px dashed #29414b',

                  background:
                    '#091115',

                  color:
                    '#71848c',

                  fontSize:
                    '9px',

                  lineHeight:
                    1.5,
                }}
              >
                Exact coordinate selected.
                Nearby USGS nomenclature,
                when available, is context only.
              </div>
            )}
          </Panel>

          <Panel
            eyebrow="IMAGERY / ROVER"
            title="Applicable rover photos"
          >
            <RoverPhotosPanel
              feature={
                namedFeature
              }
            />
          </Panel>

          <Panel
            eyebrow="THERMAL / NASA THEMIS"
            title="Historical evidence"
          >
            <Metric
              label="Nearest historical brightness temperature"
              value={
                thermal
                  ? `${Number(
                      thermal.brightness_temperature_k,
                    ).toFixed(1)} K`
                  : '—'
              }
              detail={
                thermal
                  ? `${Number(
                      thermal.brightness_temperature_c,
                    ).toFixed(1)} °C · nearest historical THEMIS observation`
                  : loading
                    ? 'Loading...'
                    : 'No historical observation'
              }
            />

            <div className="evidence-grid">
              <Metric
                label="Evidence"
                value={
                  thermalEvidence
                    ?.label
                }
              />

              <Metric
                label="Score"
                value={
                  thermalEvidence
                    ?.score ==
                  null
                    ? '—'
                    : Number(
                        thermalEvidence.score,
                      ).toFixed(1)
                }
              />

              <Metric
                label="Observations"
                value={
                  thermalEvidence
                    ?.observation_count
                }
              />

              <Metric
                label="Years"
                value={
                  thermalEvidence
                    ?.years
                }
              />
            </div>

            <div className="source-note">
              <span>
                SOURCE
              </span>

              <strong>
                {
                  thermal?.product_id ??
                  'NASA THEMIS IR-PBT'
                }
              </strong>
            </div>
          </Panel>

          <Panel
            eyebrow="ENVIRONMENT / SOLAR"
            title="Solar geometry"
          >
            <Metric
              label="Areocentric longitude"
              value={
                solar
                  ? `${Number(
                      solar.areocentric_longitude_deg,
                    ).toFixed(2)}°`
                  : '—'
              }
              detail="Ls"
            />

            <Metric
              label="Observation local solar time"
              value={
                thermal
                  ? `${Number(
                      thermal.local_solar_time_hours,
                    ).toFixed(2)} h`
                  : '—'
              }
            />
          </Panel>
        </aside>

        <section className="site-field">
          <div className="field-header">
            <div>
              <span className="field-label-inline">
                MARTIAN SITE / 2D NAVIGATION
              </span>

              <strong>
                {
                  displayName
                }
              </strong>
            </div>

            <div className="map-status-inline">
              <span>
                {
                  places.length.toLocaleString()
                }{' '}
                USGS FEATURES
              </span>

              <span>
                ANY COORDINATE SELECTABLE
              </span>
            </div>
          </div>

          <div className="maps-grid">
            <div className="map-panel">
              <div className="map-panel-title">
                <span>
                  COLOURED GLOBAL MAP
                </span>

                <small>
                  USGS FEATURE + COORDINATE NAVIGATION
                </small>
              </div>

              <div className="map-panel-body">
                <MarsMap
                  features={
                    places
                  }

                  selectedFeature={
                    namedFeature
                  }

                  selectedLocation={
                    selectedLocation
                  }

                  customPlaces={
                    customPlaces
                  }

                  safeHavens={
                    safeHavens
                  }

                  onSelect={
                    handleSelectPlace
                  }

                  onUserPlaceSelect={
                    handleSelectCustomPlace
                  }

                  onSafeHavenSelect={
                    handleSelectSafeHaven
                  }

                  onCreateUserPlace={
                    handleCreateUserPlace
                  }

                  onCreateSafeHaven={
                    handleCreateSafeHaven
                  }

                  routeMode={
                    routeMode
                  }

                  routePoints={
                    routePoints
                  }

                  routeStart={
                    routePoints[0] ??
                    null
                  }

                  routeEnd={
                    routePoints[
                      routePoints.length -
                        1
                    ] ??
                    null
                  }

                  routePlan={
                    routePlan
                  }

                  route={
                    routePlan
                  }

                  onMapLocationSelect={
                    handleRoutePointAdd
                  }

                  onMapCoordinateSelect={
                    handleSelectCoordinate
                  }

                  interactive={
                    true
                  }
                />
              </div>

              <RouteConsole
                routeMode={
                  routeMode
                }

                routePoints={
                  routePoints
                }

                routePlan={
                  routePlan
                }

                loading={
                  routeLoading
                }

                hasSelectedLocation={
                  Boolean(
                    selectedLocation,
                  )
                }

                selectedLocation={
                  selectedLocation
                }

                savedRoutes={
                  savedRoutes
                }

                compareCount={
                  compareRouteIds.length
                }

                customPlacesCount={
                  customPlaces.length
                }

                safeHavensCount={
                  safeHavens.length
                }

                onToggle={
                  toggleRouteMode
                }

                onAddSelected={
                  handleAddSelected
                }

                onAnalyze={
                  handleAnalyzeRoute
                }

                onClear={
                  clearRoute
                }

                onRemoveLast={
                  removeLastWaypoint
                }

                onSaveRoute={
                  handleSaveRoute
                }

                onOpenCompare={
                  handleOpenComparison
                }

                onSavePlace={
                  handleSavePlace
                }

                onAddSafeHaven={
                  handleAddSafeHaven
                }
              />
            </div>

            <div className="map-panel">
              <div className="map-panel-title">
                <span>
                  USGS SCIENTIFIC MAP
                </span>

                <small>
                  ARCGIS / TOPOGRAPHY / GEOLOGY / MEASUREMENTS
                </small>
              </div>

              <div className="map-panel-body">
                <MarsTopographicMap />
              </div>
            </div>
          </div>

          <div className="map-legend">
            <div>
              <span className="legend-mark crater" />
              Crater
            </div>

            <div>
              <span className="legend-mark valley" />
              Vallis / Chasma
            </div>

            <div>
              <span className="legend-mark mountain" />
              Mons / highland
            </div>

            <div>
              <span className="legend-mark feature" />
              Other USGS feature
            </div>

            <div>
              <span
                className="legend-mark"
                style={{
                  background:
                    '#8cf0b1',
                }}
              />
              Safe Haven
            </div>
          </div>
        </section>

        <aside className="right-column">
          <Panel
            eyebrow="ATMOSPHERE / NASA AMES"
            title="Dust scenario"
          >
            <Metric
              label="Opacity"
              value={
                dust
                  ? Number(
                      dust.opacity,
                    ).toFixed(3)
                  : '—'
              }
              detail="MY34 modeled scenario"
            />

            <Metric
              label="Classification"
              value={
                environment
                  ?.assessment
                  ?.dust
                  ?.level
                  ?.toUpperCase()
              }
            />

            <Metric
              label="Modeled height"
              value={
                dust
                  ? `${Number(
                      dust.height_km,
                    ).toFixed(2)} km`
                  : '—'
              }
            />
          </Panel>

          <Panel
            eyebrow="TERRAIN / NASA MOLA"
            title="Site morphology"
          >
            <div className="metric-grid">
              <Metric
                label="Elevation"
                value={
                  terrain
                    ? `${Number(
                        terrain.elevation_m,
                      ).toFixed(0)} m`
                    : '—'
                }
              />

              <Metric
                label="Slope"
                value={
                  terrain
                    ? `${Number(
                        terrain.slope_deg,
                      ).toFixed(2)}°`
                    : '—'
                }
              />

              <Metric
                label="Aspect"
                value={
                  terrain
                    ? `${Number(
                        terrain.aspect_deg,
                      ).toFixed(1)}°`
                    : '—'
                }
              />

              <Metric
                label="Roughness"
                value={
                  terrain
                    ? `${Number(
                        terrain.roughness_m,
                      ).toFixed(1)} m`
                    : '—'
                }
              />
            </div>

            <div className="source-note">
              <span>
                DATA LINK
              </span>

              <strong>
                {
                  terrain?.source ??
                  'NASA MOLA MEGDR'
                }
              </strong>
            </div>

            {terrain
              ?.pixels_per_degree && (
              <div className="source-note">
                <span>
                  SAMPLING
                </span>

                <strong>
                  {
                    terrain.pixels_per_degree
                  }{' '}
                  PX / DEG
                </strong>
              </div>
            )}
          </Panel>

          <Panel
            eyebrow="SITE SCIENCE / SURVIVAL"
            title="Material + habitability context"
          >
            <SiteSciencePanel
              science={
                siteScience
              }
            />
          </Panel>

          <Panel
            eyebrow="ASSESSMENT / EVIDENCE"
            title="Interpretation"
          >
            <div className="assessment-status">
              <span>
                STATUS
              </span>

              <strong>
                {
                  environment
                    ?.assessment
                    ?.assessment_status ??
                  '—'
                }
              </strong>
            </div>

            <div className="source-note">
              <span>
                THERMAL
              </span>

              <strong>
                Nearest historical observation
              </strong>
            </div>

            <div className="source-note">
              <span>
                DUST
              </span>

              <strong>
                Modeled MY34 scenario
              </strong>
            </div>

            <div className="source-note">
              <span>
                TERRAIN
              </span>

              <strong>
                NASA MOLA MEGDR
              </strong>
            </div>

            {environment
              ?.assessment
              ?.warnings
              ?.length >
              0 && (
              <div className="warning-box">
                {environment.assessment
                  .warnings
                  .map(
                    (
                      warning,
                    ) => (
                      <p
                        key={
                          warning
                        }
                      >
                        {
                          warning
                        }
                      </p>
                    ),
                  )}
              </div>
            )}

            {siteScience
              ?.nearest_feature_context
              ?.feature_name && (
              <div
                style={{
                  marginTop:
                    '9px',

                  padding:
                    '9px 10px',

                  border:
                    '1px solid rgba(117,230,255,0.08)',

                  background:
                    '#081014',

                  color:
                    '#667a82',

                  fontSize:
                    '9px',

                  lineHeight:
                    1.45,
                }}
              >
                <span
                  style={{
                    color:
                      '#75e6ff',
                  }}
                >
                  NEAREST NOMENCLATURE CONTEXT
                </span>

                <strong
                  style={{
                    display:
                      'block',

                    marginTop:
                      '4px',

                    color:
                      '#a8bbc1',
                  }}
                >
                  {
                    siteScience
                      .nearest_feature_context
                      .feature_name
                  }
                </strong>

                <span>
                  Context only. It is not the
                  selected coordinate.
                </span>
              </div>
            )}
          </Panel>

          <Panel
            eyebrow="MISSION / OPERATIONS"
            title="Crewed Mars console"
          >
            <MissionOpsPanel
              selectedFeature={
                namedFeature
              }

              sol={
                DEFAULT_SOL
              }

              environment={
                environment
              }

              routePlan={
                routePlan
              }
            />
          </Panel>

          <Panel
            eyebrow="BRIEFING / NASA FEED"
            title="Mars reference feed"
          >
            <MarsBriefingPanel />
          </Panel>
        </aside>
      </div>

      <footer className="evidence-bar">
        <div>
          <span>
            USGS
          </span>

          <strong>
            2,052 REGISTERED FEATURES
          </strong>
        </div>

        <div>
          <span>
            THEMIS
          </span>

          <strong>
            HISTORICAL IR-PBT
          </strong>
        </div>

        <div>
          <span>
            GCM
          </span>

          <strong>
            AMES MY34
          </strong>
        </div>

        <div>
          <span>
            MOLA
          </span>

          <strong>
            128 PX / DEG
          </strong>
        </div>

        <div>
          <span>
            MEDIA
          </span>

          <strong>
            NASA IMAGE LIBRARY
          </strong>
        </div>

        <div className="evidence-warning">
          <span>
            DATA MODEL
          </span>

          <strong>
            Observed · Modeled · Derived · Simulated
          </strong>
        </div>
      </footer>

      {comparisonOpen && (
        <RouteComparisonWorkspace
          routes={
            savedRoutes
          }
          compareRouteIds={
            compareRouteIds
          }
          onToggleRoute={
            handleToggleCompareRoute
          }
          onClose={() =>
            setComparisonOpen(
              false,
            )
          }
          onDeleteRoute={
            handleDeleteSavedRoute
          }
        />
      )}
    </main>
  )
}
