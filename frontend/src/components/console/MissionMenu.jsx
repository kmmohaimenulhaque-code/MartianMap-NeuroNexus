import { MAX_CHECKLIST_POINTS, MAX_CHECKLIST_WORDS, MAX_TODO_WORDS, countWords, trimToWordLimit } from "../../utils/appHelpers";
import Icon from "../../ui/Icon";

const glassButtonStyle = {
  minHeight: "34px",

  padding: "0 10px",

  border: "1px solid rgba(117,230,255,0.22)",

  background: "rgba(7,15,19,0.76)",

  color: "#9ab0b8",

  fontFamily: "var(--nn-font)",

  fontSize: "11px",

  letterSpacing: "0.06em",

  cursor: "pointer",
};

export default function MissionMenu({
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
  onExportRouteCsv,
  routeExportAvailable = true,
  onPrint,
  embedded = false,
}) {
  if (!open && !embedded) {
    return null;
  }

  const todoWords = countWords(todoText);

  const checklistWords = countWords(checklist.map((item) => item.text).join(" "));

  const body = (
        <div
          style={{
            display: "grid",

            gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",

            gap: "12px",

            padding: "14px",
          }}
        >
          <section
            style={{
              minWidth: 0,

              border: "1px solid rgba(117,230,255,0.14)",

              background: "rgba(7,15,19,0.72)",
            }}
          >
            <div
              style={{
                padding: "12px",

                borderBottom: "1px solid rgba(117,230,255,0.1)",
              }}
            >
              <div
                style={{
                  color: "#75e6ff",

                  fontSize: "11px",

                  letterSpacing: "0.06em",
                }}
              >
                TO-DO LIST MAKER
              </div>

              <strong
                style={{
                  display: "block",

                  marginTop: "5px",

                  fontSize: "11px",
                }}
              >
                Mission objective / field note
              </strong>
            </div>

            <div
              style={{
                padding: "12px",
              }}
            >
              <textarea
                value={todoText}
                onChange={(event) => setTodoText(trimToWordLimit(event.target.value, MAX_TODO_WORDS))}
                placeholder="Write what needs to be completed..."
                style={{
                  width: "100%",

                  minHeight: "280px",

                  resize: "vertical",

                  boxSizing: "border-box",

                  padding: "12px",

                  border: "1px solid #29414b",

                  background: "#071014",

                  color: "#d8e5e9",

                  fontFamily: "var(--nn-font)",

                  fontSize: "11px",

                  lineHeight: 1.6,

                  outline: "none",
                }}
              />

              <div
                style={{
                  display: "flex",

                  justifyContent: "space-between",

                  gap: "10px",

                  marginTop: "7px",

                  color: todoWords >= MAX_TODO_WORDS ? "#ff8997" : "#6f828a",

                  fontFamily: "var(--nn-font)",

                  fontSize: "11px",
                }}
              >
                <span>MAXIMUM 150 WORDS</span>

                <strong>
                  {todoWords} / {MAX_TODO_WORDS}
                </strong>
              </div>
            </div>
          </section>

          <section
            style={{
              minWidth: 0,

              border: "1px solid rgba(117,230,255,0.14)",

              background: "rgba(7,15,19,0.72)",
            }}
          >
            <div
              style={{
                padding: "12px",

                borderBottom: "1px solid rgba(117,230,255,0.1)",
              }}
            >
              <div
                style={{
                  color: "#75e6ff",

                  fontSize: "11px",

                  letterSpacing: "0.06em",
                }}
              >
                CHECKLIST MAKER
              </div>

              <strong
                style={{
                  display: "block",

                  marginTop: "5px",

                  fontSize: "11px",
                }}
              >
                Tickable mission actions
              </strong>
            </div>

            <div
              style={{
                padding: "12px",
              }}
            >
              <div
                style={{
                  display: "flex",

                  justifyContent: "space-between",

                  gap: "10px",

                  marginBottom: "9px",

                  color: "#6f828a",

                  fontFamily: "var(--nn-font)",

                  fontSize: "11px",
                }}
              >
                <span>
                  {checklist.length} / {MAX_CHECKLIST_POINTS} POINTS
                </span>

                <strong
                  style={{
                    color: checklistWords >= MAX_CHECKLIST_WORDS ? "#ff8997" : "#9bb1b8",
                  }}
                >
                  {checklistWords} / {MAX_CHECKLIST_WORDS} WORDS
                </strong>
              </div>

              <div
                style={{
                  display: "grid",

                  gap: "7px",

                  minHeight: "285px",

                  alignContent: "start",
                }}
              >
                {checklist.map((item, index) => (
                  <div
                    key={item.id}
                    style={{
                      display: "grid",

                      gridTemplateColumns: "30px minmax(0,1fr) 32px",

                      gap: "7px",

                      alignItems: "center",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => onChecklistToggle(item.id)}
                      style={{
                        width: "30px",

                        height: "30px",

                        border: item.done ? "1px solid #8cf0b1" : "1px solid #29414b",

                        background: item.done ? "rgba(80,180,120,0.12)" : "#071014",

                        color: "#8cf0b1",

                        cursor: "pointer",

                        fontSize: "16px",
                      }}
                    >
                      {item.done ? <Icon name="check" size={14} /> : null}
                    </button>

                    <input
                      value={item.text}
                      onChange={(event) => onChecklistTextChange(item.id, event.target.value)}
                      placeholder={`Checklist point ${index + 1}`}
                      style={{
                        minWidth: 0,

                        width: "100%",

                        boxSizing: "border-box",

                        minHeight: "34px",

                        padding: "7px 9px",

                        border: "1px solid #29414b",

                        background: "#071014",

                        color: item.done ? "#6d858d" : "#d5e1e5",

                        textDecoration: item.done ? "line-through" : "none",

                        fontFamily: "var(--nn-font)",

                        fontSize: "11px",

                        outline: "none",
                      }}
                    />

                    <button
                      type="button"
                      onClick={() => onRemoveChecklistItem(item.id)}
                      style={{
                        minHeight: "34px",

                        border: "1px solid #50333a",

                        background: "#0b1114",

                        color: "#ff9aa9",

                        cursor: "pointer",

                        fontSize: "11px",
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}

                {!checklist.length && (
                  <div
                    style={{
                      minHeight: "160px",

                      display: "grid",

                      placeItems: "center",

                      padding: "16px",

                      border: "1px dashed #29414b",

                      color: "#667980",

                      fontSize: "11px",

                      textAlign: "center",
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
                disabled={checklist.length >= MAX_CHECKLIST_POINTS || checklistWords >= MAX_CHECKLIST_WORDS}
                onClick={onAddChecklistItem}
                style={{
                  ...glassButtonStyle,

                  width: "100%",

                  marginTop: "10px",

                  opacity: checklist.length >= MAX_CHECKLIST_POINTS || checklistWords >= MAX_CHECKLIST_WORDS ? 0.4 : 1,
                }}
              >
                + ADD CHECKLIST POINT
              </button>
            </div>
          </section>

          <section
            style={{
              gridColumn: "1 / -1",

              border: "1px solid rgba(117,230,255,0.14)",

              background: "rgba(7,15,19,0.72)",

              padding: "12px",
            }}
          >
            <div
              style={{
                display: "flex",

                flexWrap: "wrap",

                gap: "7px",

                justifyContent: "space-between",

                alignItems: "center",
              }}
            >
              <div>
                <div
                  style={{
                    color: "#75e6ff",

                    fontSize: "11px",

                    letterSpacing: "0.06em",
                  }}
                >
                  MISSION RECORD
                </div>

                <small
                  style={{
                    display: "block",

                    marginTop: "4px",

                    color: "#687b83",

                    fontSize: "11px",
                  }}
                >
                  Notes and checklist are saved locally and included in both mission exports. The complete CSV flattens every value in the mission
                  record, one row per measurement.
                </small>
              </div>

              <div
                style={{
                  display: "flex",

                  flexWrap: "wrap",

                  gap: "6px",
                }}
              >
                <button type="button" onClick={onExportJson} style={glassButtonStyle}>
                  EXPORT JSON
                </button>

                <button type="button" onClick={onExportCsv} style={glassButtonStyle}>
                  EXPORT COMPLETE CSV
                </button>

                <button
                  type="button"
                  onClick={onExportRouteCsv}
                  style={{ ...glassButtonStyle, opacity: routeExportAvailable ? 1 : 0.55 }}
                  title={routeExportAvailable ? "Per-waypoint route CSV" : "Plan, apply or save a route first"}
                >
                  EXPORT ROUTE CSV
                </button>

                <button type="button" onClick={onPrint} style={glassButtonStyle}>
                  PRINT / PDF
                </button>
              </div>
            </div>
          </section>
        </div>
  );

  if (embedded) {
    return body;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="NeuroNexus mission workspace"
      style={{
        position: "fixed",

        inset: 0,

        zIndex: 5000,

        display: "flex",

        alignItems: "center",

        justifyContent: "center",

        padding: "24px",

        background: "rgba(2,7,10,0.72)",

        backdropFilter: "blur(22px) saturate(120%)",

        WebkitBackdropFilter: "blur(22px) saturate(120%)",
      }}
    >
      <div
        style={{
          width: "min(1180px, 100%)",

          height: "min(820px, calc(100vh - 48px))",

          overflow: "auto",

          border: "1px solid rgba(117,230,255,0.25)",

          background: "linear-gradient(180deg, rgba(11,21,27,0.9), rgba(4,10,13,0.92))",

          boxShadow: "0 30px 120px rgba(0,0,0,0.65)",

          backdropFilter: "blur(28px)",

          WebkitBackdropFilter: "blur(28px)",
        }}
      >
        <header
          style={{
            position: "sticky",

            top: 0,

            zIndex: 2,

            display: "flex",

            justifyContent: "space-between",

            alignItems: "center",

            gap: "16px",

            padding: "16px 18px",

            borderBottom: "1px solid rgba(117,230,255,0.13)",

            background: "rgba(5,12,16,0.82)",

            backdropFilter: "blur(18px)",

            WebkitBackdropFilter: "blur(18px)",
          }}
        >
          <div>
            <div
              style={{
                color: "#75e6ff",

                fontSize: "11px",

                letterSpacing: "0.06em",
              }}
            >
              NEURONEXUS / MISSION WORKSPACE
            </div>

            <h2
              style={{
                margin: "5px 0 0",

                fontSize: "20px",

                letterSpacing: "0.06em",
              }}
            >
              FIELD NOTES + CHECKLIST
            </h2>

            <small
              style={{
                display: "block",

                marginTop: "5px",

                color: "#74868e",

                fontSize: "11px",
              }}
            >
              Persistent local mission planning workspace.
            </small>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              minWidth: "38px",

              minHeight: "38px",

              border: "1px solid #29414b",

              background: "#091115",

              color: "#75e6ff",

              fontSize: "22px",

              cursor: "pointer",
            }}
          >
            ×
          </button>
        </header>

        {body}
      </div>
    </div>
  );
}
