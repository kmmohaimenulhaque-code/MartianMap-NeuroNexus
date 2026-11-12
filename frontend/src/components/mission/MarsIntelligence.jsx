import { useEffect, useRef, useState } from "react";

/*
 * MARS INTELLIGENCE
 *
 * An application-aware assistant. Every project question is answered from
 * tool calls against the live mission state (served by the backend), never
 * from the model's own guesses. The Gemini API key stays server-side.
 */

const SUGGESTIONS = [
  "Explain the trade-offs between these routes using the available evidence.",
  "Summarise the current Mars-orbit small-body monitoring picture.",
  "What terrain evidence supports the selected site?",
  "What data source produced the thermal value shown?",
  "Which saved route has the lowest EVA burden and why?",
];

export default function MarsIntelligence({ open, onClose, status, onAsk, missionSummary }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

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
      const reply = await onAsk(history.map(({ role, content }) => ({ role, content })));
      if (reply?.status === "ok") {
        setMessages([
          ...history,
          {
            role: "assistant",
            content: reply.text,
            tools: reply.tool_calls ?? [],
            grounding: reply.search_grounding ?? [],
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
            <span className="eyebrow">MISSION ASSISTANT · TOOL-GROUNDED</span>
            <h2>MARS INTELLIGENCE</h2>
            <small>
              {status?.configured
                ? `${status.model} · ${status.tools?.length ?? 0} application tools`
                : "GEMINI_API_KEY is not configured on the server"}
            </small>
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
                Ask about the selected site, the planned route, candidate trade-offs, THEMIS or MOLA evidence, the console state, provenance, or the
                current Mars small-body tracking picture.
              </p>
              <div className="intel-suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} type="button" onClick={() => send(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <article key={index} className={`intel-message ${message.role}${message.error ? " error" : ""}`}>
              <span className="intel-role">{message.role === "user" ? "YOU" : "MARS INTELLIGENCE"}</span>
              <div className="intel-text">{message.content}</div>
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
                      </li>
                    ))}
                  </ul>
                </details>
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
                <small className="intel-note">AI INTERPRETATION of NeuroNexus tool results. Not itself a NASA observation.</small>
              )}
            </article>
          ))}

          {busy && <div className="intel-busy">QUERYING APPLICATION TOOLS…</div>}
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
            placeholder="Ask about this mission, its evidence or Mars science…"
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
