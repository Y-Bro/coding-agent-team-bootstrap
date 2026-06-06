/** The static dashboard client: plain HTML + vanilla JS, no build step, READ-ONLY. */

export const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>agent-bootstrap — dashboard</title>
  <style>
    body { font: 14px system-ui, sans-serif; margin: 0; background: #0f1115; color: #d7dbe0; }
    header { padding: 12px 16px; background: #161922; border-bottom: 1px solid #232838; }
    h1 { font-size: 15px; margin: 0; } .sub { color: #8b93a7; font-size: 12px; }
    main { display: grid; grid-template-columns: 260px 1fr; gap: 0; height: calc(100vh - 50px); }
    aside { border-right: 1px solid #232838; overflow: auto; padding: 12px; }
    section { overflow: auto; padding: 12px; }
    h2 { font-size: 12px; text-transform: uppercase; color: #8b93a7; margin: 0 0 8px; }
    .agent, .task { padding: 6px 8px; border: 1px solid #232838; border-radius: 6px; margin-bottom: 6px; }
    .msg { padding: 6px 8px; border-bottom: 1px solid #1c2030; }
    .from { color: #6ad; } .to { color: #ad6; } .type { color: #da6; }
    .state { font-size: 11px; padding: 1px 6px; border-radius: 10px; background: #232838; }
    code { color: #c0c5d0; }
  </style>
</head>
<body>
  <header><h1>agent-bootstrap dashboard</h1><span class="sub">read-only observability</span></header>
  <main>
    <aside>
      <h2>Agents</h2><div id="agents"></div>
      <h2 style="margin-top:16px">Tasks</h2><div id="tasks"></div>
    </aside>
    <section><h2>Message feed</h2><div id="feed"></div></section>
  </main>
  <script src="/app.js"></script>
</body>
</html>`;

export const APP_JS = `"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
function text(m) { const p = (m.parts || []).find((x) => x.kind === "text"); return p ? p.text : ""; }
function renderMsg(m) {
  const div = document.createElement("div");
  div.className = "msg";
  div.innerHTML = '<span class="from">' + esc(m.from) + '</span> → <span class="to">' + esc(m.to) +
    '</span> <span class="type">' + esc(m.type) + '</span><br><code>' + esc(text(m)) + '</code>';
  return div;
}
async function load() {
  const [agents, feed, tasks] = await Promise.all([
    fetch("/api/agents").then((r) => r.json()),
    fetch("/api/feed").then((r) => r.json()),
    fetch("/api/tasks").then((r) => r.json()),
  ]);
  $("agents").innerHTML = agents.map((a) =>
    '<div class="agent"><b>' + esc(a.id) + '</b> <span class="sub">' + esc(a.role) + '</span>' +
    (a.url ? '<br><code>' + esc(a.url) + '</code>' : '') + '</div>').join("");
  $("tasks").innerHTML = tasks.length ? tasks.map((t) =>
    '<div class="task">' + esc(t.title || t.id) + ' <span class="state">' + esc(t.state) + '</span></div>').join("")
    : '<div class="sub">no tasks</div>';
  const f = $("feed"); f.innerHTML = ""; feed.forEach((m) => f.appendChild(renderMsg(m)));
}
load();
// live updates: append each new message as it is recorded
const es = new EventSource("/events");
es.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  $("feed").appendChild(renderMsg(m));
  if (m.type === "task_status") load(); // task projection changed — refresh the panel
});
`;
