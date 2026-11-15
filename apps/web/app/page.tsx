"use client";

import { readGuideContext, type GuideContext } from "./guide-context";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";

type Source = {id:string;title:string;url:string;kind:string};
type Message = { role: "user" | "assistant"; content: string; sources?:Source[]; context?:unknown[]; warnings?:string[] };
function citedText(content:string,sources:Source[]=[]){return content.split(/(\[(?:S|D)\d+\])/g).map((part,i)=>{const source=sources.find(s=>`[${s.id}]`===part);return source?<a key={i} href={source.url} title={source.title}>{part}</a>:part;});}
const suggestions = [
  "What would a Mars habitat need to keep people alive?",
  "What do we know about water resources on Mars?",
  "How would dust affect a surface expedition?",
];

export default function Home() {
  const [attached,setAttached]=useState<GuideContext|null>(null);
  const [contextNotice,setContextNotice]=useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { end.current?.scrollIntoView?.({ block: "nearest" }); }, [messages, pending, error]);

  async function send(question: string, retry = false) {
    if (busy.current || !question.trim()) return;
    busy.current = true;
    const next: Message[] = retry ? messages : [...messages, { role: "user", content: question.trim() }];
    setMessages(next);
    setDraft("");
    setError("");
    setPending(true);
    try {
      // Retain the complete visible transcript; send the latest ten exchanges.
      const response = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.slice(-21).map(({role,content})=>({role,content})), ...(attached?{context_tokens:Object.values(attached.tokens),map_mode:attached.mode}:{}) }),
        signal: AbortSignal.timeout(55000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Chat failed. Please retry.");
      if (typeof data.reply !== "string" || !data.reply.trim()) throw new Error("No response received. Please retry.");
      setMessages([...next, { role: "assistant", content: data.reply, sources:data.sources||[], context:data.context||[], warnings:data.context_warnings||[] }]);
    } catch (cause) {
      setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "Request timed out. Please retry.");
    } finally {
      busy.current = false;
      setPending(false);
      input.current?.focus();
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  return (
    <main className="chat-shell">
      <header className="masthead">
        <div><p className="eyebrow">MARTIAN SURVIVAL GUIDE</p><h1>Darkstar</h1></div>
        <button className="secondary" disabled={pending || messages.length === 0} onClick={() => { setMessages([]); setError(""); setDraft(""); input.current?.focus(); }}>New chat</button>
      </header>
      <nav aria-label="Main navigation" className="app-nav"><Link href="/" aria-current="page">AI survival chat</Link><Link href="/terrain">Mars Explorer ↗</Link></nav>
      <section className="intro">
        <h2>Think through life on Mars.</h2>
        <p>Explore survival questions with an AI guide. Answers should distinguish established science, engineering assumptions and speculation.</p>
        <p className="disclaimer">Educational AI · No live Mars data · Retrieves reviewed NASA/PDS passages. Attach signed Explorer results for map-aware answers. Verify interpretations before use.</p>
      </section>
      <div className="app-nav"><button className="secondary" disabled={pending} onClick={()=>{const context=readGuideContext();setAttached(context);setContextNotice(Object.keys(context.tokens).length?`Attached ${Object.keys(context.tokens).join(", ")} snapshots${context.mode?` · Map mode: ${context.mode}`:""}. Signed results will be sent to your configured AI provider.`:"No Explorer results available. Inspect a point or calculate a mission first.");}}>Attach Explorer context</button>{attached&&<button className="secondary" disabled={pending} onClick={()=>{setAttached(null);setContextNotice("Explorer context detached.");}}>Detach context</button>}</div>
      {contextNotice&&<p className="footnote">{contextNotice} Reattach after changing the plan.</p>}
      <section className="conversation" aria-label="Conversation" role="log" aria-live="polite" aria-busy={pending}>
        {messages.length === 0 && <div className="welcome"><p className="eyebrow">START EXPLORING</p><h3>What would you need to survive?</h3><div className="suggestions">{suggestions.map(question => <button className="suggestion" key={question} onClick={() => void send(question)}>{question}<span aria-hidden="true"> ↗</span></button>)}</div></div>}
        {messages.map((message, index) => <article className={`message ${message.role}`} key={index}><p className="speaker">{message.role === "user" ? "You" : "Darkstar · AI"}</p><div className="message-text">{citedText(message.content,message.sources)}</div>
          {!!message.sources?.length&&<ul>{message.sources.map(s=><li key={s.id}><a href={s.url}>[{s.id}] {s.title}</a> · {s.kind}</li>)}</ul>}
          {message.warnings?.map(w=><p className="footnote" key={w}>{w}</p>)}
          {!!message.context?.length&&<details><summary>Actual Python results used in this answer</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify(message.context,null,2)}</pre></details>}
        </article>)}
        {pending && <p className="pending" role="status">Darkstar is thinking…</p>}
        <div ref={end} />
      </section>
      {error && <div className="error" role="alert"><p>{error}</p><button className="secondary" onClick={() => void send(messages[messages.length - 1].content, true)}>Retry</button><button className="secondary" onClick={() => { setDraft(messages[messages.length - 1].content); setMessages(messages.slice(0, -1)); setError(""); input.current?.focus(); }}>Edit question</button></div>}
      <form className="composer" onSubmit={submit}>
        <label htmlFor="question">Ask about Mars survival</label>
        <div className="compose-row"><textarea ref={input} id="question" value={draft} onChange={event => setDraft(event.target.value)} maxLength={4000} rows={3} disabled={pending || !!error} placeholder="Ask a question or explore an idea…" /><button className="send" type="submit" disabled={pending || !!error || !draft.trim()}>Send ↑</button></div>
        <p className="footnote">History stays in this page until refresh. The latest 10 exchanges are sent to the configured AI provider. Verify scientific claims before use.</p>
      </form>
      <footer>Independent project. No NASA affiliation or endorsement.</footer>
    </main>
  );
}
