import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

const TODO_KEY =
  "neuronexus-todo-v1";

const CHECKLIST_KEY =
  "neuronexus-checklist-v1";

const MAX_WORDS = 150;
const MAX_CHECKLIST_ITEMS = 10;

function wordCount(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);

    return raw
      ? JSON.parse(raw)
      : fallback;
  } catch {
    return fallback;
  }
}

export default function UtilityDrawer({
  open,
  onClose,
}) {
  const [todo, setTodo] = useState(() =>
    load(TODO_KEY, "")
  );

  const [items, setItems] = useState(() =>
    load(CHECKLIST_KEY, [])
  );

  const [newItem, setNewItem] =
    useState("");

  const checklistWords = useMemo(
    () =>
      items.reduce(
        (total, item) =>
          total + wordCount(item.text),
        0
      ),
    [items]
  );

  useEffect(() => {
    localStorage.setItem(
      TODO_KEY,
      JSON.stringify(todo)
    );
  }, [todo]);

  useEffect(() => {
    localStorage.setItem(
      CHECKLIST_KEY,
      JSON.stringify(items)
    );
  }, [items]);

  function addChecklistItem() {
    const text = newItem.trim();

    if (!text) {
      return;
    }

    if (
      items.length >= MAX_CHECKLIST_ITEMS
    ) {
      return;
    }

    if (
      checklistWords + wordCount(text) >
      MAX_WORDS
    ) {
      return;
    }

    setItems((current) => [
      ...current,
      {
        id: `check-${Date.now()}`,
        text,
        done: false,
      },
    ]);

    setNewItem("");
  }

  function toggleItem(id) {
    setItems((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              done: !item.done,
            }
          : item
      )
    );
  }

  function deleteItem(id) {
    setItems((current) =>
      current.filter(
        (item) => item.id !== id
      )
    );
  }

  if (!open) {
    return null;
  }

  return (
    <div className="nn-drawer-layer">
      <button
        className="nn-drawer-backdrop"
        type="button"
        aria-label="Close utility drawer"
        onClick={onClose}
      />

      <aside className="nn-utility-drawer">
        <header className="nn-drawer-header">
          <div>
            <div className="nn-route-eyebrow">
              NEURONEXUS / FIELD UTILITIES
            </div>

            <h2>Mission Desk</h2>
          </div>

          <button
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <section className="nn-drawer-section">
          <div className="nn-drawer-section-title">
            TO-DO LIST
          </div>

          <textarea
            value={todo}
            maxLength={1200}
            placeholder="Write mission tasks, observations or follow-ups..."
            onChange={(event) => {
              const value =
                event.target.value;

              if (
                wordCount(value) <=
                MAX_WORDS
              ) {
                setTodo(value);
              }
            }}
          />

          <small>
            {wordCount(todo)}/{MAX_WORDS} words
          </small>
        </section>

        <section className="nn-drawer-section">
          <div className="nn-drawer-section-title">
            CHECKLIST ✓
          </div>

          <div className="nn-checklist-entry">
            <input
              type="text"
              value={newItem}
              placeholder="Add checklist point..."
              maxLength={240}
              onChange={(event) =>
                setNewItem(
                  event.target.value
                )
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addChecklistItem();
                }
              }}
            />

            <button
              type="button"
              onClick={
                addChecklistItem
              }
            >
              +
            </button>
          </div>

          <div className="nn-checklist-meta">
            <span>
              {items.length}/
              {MAX_CHECKLIST_ITEMS} points
            </span>

            <span>
              {checklistWords}/
              {MAX_WORDS} words
            </span>
          </div>

          <div className="nn-checklist-list">
            {items.map((item, index) => (
              <div
                className={
                  item.done
                    ? "nn-checklist-item done"
                    : "nn-checklist-item"
                }
                key={item.id}
              >
                <button
                  type="button"
                  className="nn-check-button"
                  onClick={() =>
                    toggleItem(
                      item.id
                    )
                  }
                >
                  {item.done ? "✓" : "○"}
                </button>

                <span>
                  {index + 1}. {item.text}
                </span>

                <button
                  type="button"
                  className="nn-check-delete"
                  onClick={() =>
                    deleteItem(
                      item.id
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
