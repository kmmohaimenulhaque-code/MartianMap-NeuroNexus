import { useEffect, useRef, useState } from "react";

/*
 * MARS INTELLIGENCE
 *
 * Mission, Mars and project assistant. Mission questions are answered from
 * application tools over the live mission state; Mars science, missions and
 * history from a curated, cited knowledge base; UI and project questions from
 * the shared command catalogue and project docs. Optional Google Search
 * grounding covers recent events. The AI key stays server-side.
 */

const HISTORY_KEY = "neuronexus.intelligence.history.v1";
const SEARCH_KEY = "neuronexus.intelligence.webSearch.v1";

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Persistence is a convenience only.
  }
}

/*
 * Minimal Markdown rendering for model replies: headings, bullet lists and
 * **bold** / `code`. Built from React elements (no innerHTML), so model text
 * can never inject markup.
 */
function renderInline(text, keyPrefix) {
  const pieces = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return pieces.map((piece, index) => {
    if (piece.startsWith("**") && piece.endsWith("**") && piece.length > 4) {
      return <strong key={`${keyPrefix}-${index}`}>{piece.slice(2, -2)}</strong>;
    }
    if (piece.startsWith("`") && piece.endsWith("`") && piece.length > 2) {
      return <code key={`${keyPrefix}-${index}`}>{piece.slice(1, -1)}</code>;
    }
    return piece;
  });
}

function ModelText({ text }) {
  const blocks = [];
  let list = null;
  String(text ?? "")
    .split(/\r?\n/)
    .forEach((raw, index) => {
      const line = raw.trimEnd();
      if (/^\s*\|.*\|\s*$/.test(line)) {
        const cells = line.trim().slice(1, -1).split("|").map((cell) => cell.trim());
        if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) return;
        const last = blocks[blocks.length - 1];
        if (last?.type === "table") last.rows.push(cells);
        else blocks.push({ type: "table", rows: [cells], key: `t-${index}` });
        list = null;
        return;
      }
      const bullet = /^\s*(?:[*-]|\d+\.)\s+(.*)$/.exec(line);
      if (bullet) {
        if (!list) {
          list = [];
          blocks.push({ type: "list", items: list, key: `l-${index}` });
        }
        list.push({ text: bullet[1], key: `i-${index}` });
        return;
      }
      list = null;
      if (!line.trim()) {
        return;
      }
      const heading = /^#{1,6}\s+(.*)$/.exec(line);
      blocks.push(heading ? { type: "heading", text: heading[1], key: `h-${index}` } : { type: "paragraph", text: line, key: `p-${index}` });
    });

  return blocks.map((block) => {
    if (block.type === "table") {
      const [head, ...body] = block.rows;
      return (
        <div key={block.key} className="intel-table-wrap">
          <table className="intel-table">
            <thead>
              <tr>
                {head.map((cell, i) => (
                  <th key={i}>{renderInline(cell, `${block.key}-h${i}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, i) => (
                    <td key={i}>{renderInline(cell, `${block.key}-${r}-${i}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    if (block.type === "list") {
      return (
        <ul key={block.key}>
          {block.items.map((item) => (
            <li key={item.key}>{renderInline(item.text, item.key)}</li>
          ))}
        </ul>
      );
    }
    if (block.type === "heading") {
      return (
        <div key={block.key} className="intel-heading">
          {renderInline(block.text, block.key)}
        </div>
      );
    }
    return <p key={block.key}>{renderInline(block.text, block.key)}</p>;
  });
}

const SUGGESTIONS = [
  {
    group: "THIS SITE",
    items: [
      "Brief me on the selected site: terrain statistics, dust at the current sol and thermal evidence.",
      "When is this site dustiest in the MY34 scenario, and how bad does it get?",
    ],
  },
  {
    group: "ROUTES",
    items: ["Compare my saved routes on slope, roughness and EVA time.", "Explain the trade-offs between the AI route candidates."],
  },
  {
    group: "MARS SCIENCE",
    items: ["Why does Mars have global dust storms, and what happened in 2018?", "What Mars Year and season is it today?"],
  },
  {
    group: "MISSIONS & HISTORY",
    items: ["Summarise every NASA Mars rover and what each discovered.", "What did Mars Global Surveyor's MOLA instrument measure?"],
  },
  {
    group: "USING NEURONEXUS",
    items: ["How do I compare saved routes in the 3D view?", "Which data sources does NeuroNexus use, and how reliable is each?"],
  },
];

function transcriptMarkdown(messages) {
  return [
    "# Mars Intelligence transcript",
    `Exported ${new Date().toISOString()} · NeuroNexus · Team NeuroNexus · NASA Space Apps 2026`,
    "",
    ...messages.flatMap((m) => [
      `## ${m.role === "user" ? "You" : "Mars Intelligence"}`,
      "",
      m.content,
      ...(m.tools?.length ? ["", `_Tools: ${m.tools.map((t) => t.name).join(", ")}_`] : []),
      ...(m.sources?.length ? ["", `_Sources: ${m.sources.map((c) => `${c.title} › ${c.section}`).join("; ")}_`] : []),
      "",
    ]),
  ].join("\n");
}

export default function MarsIntelligence({ open, onClose, status, onAsk, missionSummary }) {
  const [messages, setMessages] = useState(() => readJson(HISTORY_KEY, []));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [webSearch, setWebSearch] = useState(() => Boolean(readJson(SEARCH_KEY, false)));
  const [copied, setCopied] = useState(null);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  useEffect(() => writeJson(HISTORY_KEY, messages.slice(-40)), [messages]);
  useEffect(() => writeJson(SEARCH_KEY, webSearch), [webSearch]);

  function copy(text, index) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(index);
      window.setTimeout(() => setCopied(null), 1400);
    });
  }

  function exportTranscript() {
    const blob = new Blob([transcriptMarkdown(messages)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mars-intelligence-${new Date().toISOString().slice(0, 10)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!open) {
    return null;
  }

  async function send(text) {
    const question = String(text ?? input).trim();
    if (!question || busy) {
      return;
    }
    const history = [...messages, { role: "user", content: question }];
    setMessages(history);
    setInput("");
    setBusy(true);
    try {
      const reply = await onAsk(
        history.filter((m) => !m.error).map(({ role, content }) => ({ role, content })),
        { enableSearch: webSearch },
      );
      if (reply?.status === "ok") {
        setMessages([
          ...history,
          {
            role: "assistant",
            content: reply.text,
            tools: reply.tool_calls ?? [],
            grounding: reply.search_grounding ?? [],
            sources: reply.sources ?? [],
            elapsed: reply.elapsed_ms ?? null,
            model: reply.model,
            notice: reply.model_notice ?? null,
          },
        ]);
      } else {
        setMessages([
          ...history,
          {
            role: "assistant",
            error: true,
            content: `MARS INTELLIGENCE UNAVAILABLE — ${reply?.reason ?? reply?.error ?? "the AI service did not respond."} The rest of NeuroNexus is unaffected.`,
          },
        ]);
      }
    } catch (error) {
      setMessages([...history, { role: "assistant", error: true, content: `REQUEST FAILED — ${error.message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="intel-backdrop" role="dialog" aria-label="Mars Intelligence assistant">
      <section className="intel">
        <header>
          <div>
            <span className="eyebrow">MISSION · MARS · PROJECT ASSISTANT · TOOL-GROUNDED</span>
            <h2>MARS INTELLIGENCE</h2>
            <small>
              {status?.configured
                ? `${status.model} · ${status.tools?.length ?? 0} tools · ${status.knowledge?.chunks ?? 0} knowledge sections`
                : "GEMINI_API_KEY is not configured on the server"}
            </small>
          </div>
          <div className="intel-controls">
            <label className={`intel-toggle${webSearch ? " on" : ""}`} title="Ground answers in Google Search for recent events and mission status">
              <input type="checkbox" checked={webSearch} onChange={(e) => setWebSearch(e.target.checked)} />
              WEB SEARCH
            </label>
            <button type="button" onClick={exportTranscript} disabled={!messages.length}>
              EXPORT
            </button>
            <button type="button" onClick={() => setMessages([])} disabled={!messages.length || busy}>
              CLEAR
            </button>
          </div>
          <button type="button" className="ai-close" onClick={onClose} aria-label="Close assistant">
            ×
          </button>
        </header>

        <div className="intel-context">
          {missionSummary?.map((item) => (
            <span key={item.label}>
              <b>{item.label}</b> {item.value}
            </span>
          ))}
        </div>

        <div className="intel-log">
          {messages.length === 0 && (
            <div className="intel-empty">
              <p>
                Ask about this mission (site, routes, terrain, dust, thermal evidence, console), about Mars itself (science, missions, history, human
                exploration), or about how to use NeuroNexus. Answers name the tools and sources they used.
              </p>
              <div className="intel-suggestions">
                {SUGGESTIONS.map((group) => (
                  <div key={group.group} className="intel-suggestion-group">
                    <span>{group.group}</span>
                    {group.items.map((suggestion) => (
                      <button key={suggestion} type="button" onClick={() => send(suggestion)}>
                        {suggestion}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <article key={index} className={`intel-message ${message.role}${message.error ? " error" : ""}`}>
              <span className="intel-role">{message.role === "user" ? "YOU" : "MARS INTELLIGENCE"}</span>
              <div className="intel-text">
                {message.role === "assistant" && !message.error ? <ModelText text={message.content} /> : message.content}
              </div>
              {message.tools?.length > 0 && (
                <details className="intel-tools">
                  <summary>
                    {message.tools.length} tool call{message.tools.length === 1 ? "" : "s"} · grounded in project data
                  </summary>
                  <ul>
                    {message.tools.map((tool, toolIndex) => (
                      <li key={`${tool.name}-${toolIndex}`}>
                        <code>{tool.name}</code>
                        {Object.keys(tool.arguments ?? {}).length ? ` ${JSON.stringify(tool.arguments)}` : ""}
                        {tool.elapsed_ms != null ? <small> · {tool.elapsed_ms} ms</small> : null}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {message.sources?.length > 0 && (
                <div className="intel-sources">
                  <span>SOURCES</span>
                  {message.sources.map((source) => (
                    <em key={`${source.path}-${source.section}`} title={source.path}>
                      {source.title} › {source.section} <small>{source.evidence_class}</small>
                    </em>
                  ))}
                </div>
              )}
              {message.grounding?.length > 0 && (
                <div className="intel-grounding">
                  {message.grounding.map((item, groundIndex) => (
                    <a key={groundIndex} href={item.uri} target="_blank" rel="noreferrer">
                      {item.title ?? item.uri}
                    </a>
                  ))}
                </div>
              )}
              {message.role === "assistant" && !message.error && (
                <div className="intel-foot">
                  <small className="intel-note">
                    AI INTERPRETATION{message.model ? ` · ${message.model}` : ""}
                    {message.elapsed ? ` · ${(message.elapsed / 1000).toFixed(1)} s` : ""}. Not itself a NASA observation.
                  </small>
                  <button type="button" onClick={() => copy(message.content, index)}>
                    {copied === index ? "COPIED" : "COPY"}
                  </button>
                </div>
              )}
            </article>
          ))}

          {busy && <div className="intel-busy">{webSearch ? "QUERYING TOOLS, KNOWLEDGE BASE AND WEB…" : "QUERYING TOOLS AND KNOWLEDGE BASE…"}</div>}
          <div ref={endRef} />
        </div>

        <form
          className="intel-input"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask about this mission, Mars, its missions and history, or how to use NeuroNexus…"
            aria-label="Ask Mars Intelligence"
          />
          <button type="submit" disabled={busy || !input.trim()}>
            SEND
          </button>
        </form>
      </section>
    </div>
  );
}
