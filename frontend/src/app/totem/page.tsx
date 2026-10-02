"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const REFRESH_MS = 30_000;
const PAGE_ROTATE_MS = 12_000;

interface AulaTotem {
  id: number;
  horario_inicio: string | null;
  horario_fim: string | null;
  turma: string;
  uc_nome: string;
  professor: string;
  ambiente: string;
  status: string;
  subturma: string | null;
  etapa: string | null;
}

function minutesSinceMidnight(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function nowMinutes(agora: Date): number {
  return agora.getHours() * 60 + agora.getMinutes();
}

function isVisible(horarioInicio: string | null, agora: Date): boolean {
  if (!horarioInicio) return true;
  const classMin = minutesSinceMidnight(horarioInicio);
  const nowMin = nowMinutes(agora);
  return nowMin < classMin + 30 && classMin <= nowMin + 240;
}

function fmtDateLong(d: Date): string {
  return d.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function fmtClock(d: Date): string {
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  Agendada:    { bg: "#1d4ed8", text: "#fff", label: "AGENDADA" },
  Realizada:   { bg: "#15803d", text: "#fff", label: "REALIZADA" },
  Substituída: { bg: "#7c3aed", text: "#fff", label: "SUBSTITUÍDA" },
  Remarcada:   { bg: "#b45309", text: "#fff", label: "REMARCADA" },
};

// Responsive grid: HORÁRIO | TURMA | UC | ETAPA | PROFESSOR | SALA | STATUS
const GRID_COLS = "clamp(100px,9vw,180px) 1fr 1.4fr clamp(55px,5.5vw,105px) 1fr clamp(85px,8vw,155px) clamp(90px,9vw,148px)";

function TotemContent() {
  const params = useSearchParams();

  const [token, setToken] = useState<string>("");
  const [tokenInput, setTokenInput] = useState("");
  const [aulas, setAulas] = useState<AulaTotem[]>([]);
  const [agora, setAgora] = useState<Date>(new Date());
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(8);
  const [trimCount, setTrimCount] = useState(0);
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const tableBodyRef = useRef<HTMLDivElement>(null);

  // Load token from URL → localStorage → empty
  useEffect(() => {
    const urlToken = params.get("token");
    if (urlToken) {
      setToken(urlToken);
      try { localStorage.setItem("totem_token", urlToken); } catch {}
    } else {
      try {
        const saved = localStorage.getItem("totem_token");
        if (saved) setToken(saved);
      } catch {}
    }
  }, [params]);

  // Load saved orientation
  useEffect(() => {
    try {
      const saved = localStorage.getItem("totem_orientation") as "landscape" | "portrait" | null;
      if (saved) setOrientation(saved);
    } catch {}
  }, []);

  // Detect mobile (narrow screen — show card layout instead of grid)
  useEffect(() => {
    function check() { setIsMobile(window.innerWidth < 640); }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const fetchAulas = useCallback(async (tok: string) => {
    if (!tok) return;
    try {
      const today = new Date().toISOString().substring(0, 10);
      const res = await fetch(`${API_URL}/api/v1/planejamento/totem?token=${encodeURIComponent(tok)}&data=${today}`);
      if (res.status === 401) { setError("Token inválido. Verifique o token de acesso."); return; }
      if (!res.ok) { setError(`Erro ao buscar dados (${res.status})`); return; }
      const data: AulaTotem[] = await res.json();
      setAulas(data);
      setLastUpdate(new Date());
      setError(null);
    } catch {
      setError("Sem conexão com o servidor.");
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    fetchAulas(token);
    const id = setInterval(() => fetchAulas(token), REFRESH_MS);
    return () => clearInterval(id);
  }, [token, fetchAulas]);

  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const visible = aulas.filter((a) => isVisible(a.horario_inicio, agora));
  const totalPages = Math.ceil(visible.length / rowsPerPage) || 1;

  // Initial rowsPerPage based on available height
  useEffect(() => {
    function measure() {
      if (!tableBodyRef.current) return;
      const avail = tableBodyRef.current.clientHeight;
      const cardH = window.innerWidth < 640 ? 110 : 88;
      setRowsPerPage(Math.max(1, Math.floor(avail / cardH)));
      setTrimCount(0);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [orientation, isMobile]);

  // After each render, check if rows overflow → trim last row
  useLayoutEffect(() => {
    if (!tableBodyRef.current) return;
    const container = tableBodyRef.current;
    const rowEls = Array.from(container.querySelectorAll<HTMLElement>("[data-totem-row]"));
    if (rowEls.length <= 1) return;
    const totalH = rowEls.reduce((sum, el) => sum + el.offsetHeight, 0);
    if (totalH > container.clientHeight) {
      setTrimCount((prev) => prev + 1);
    }
  });

  useEffect(() => { setTrimCount(0); }, [page]);

  // Auto-paginate only on desktop/kiosk — mobile uses native scroll
  useEffect(() => {
    if (isMobile) { setPage(0); return; }
    if (totalPages <= 1) { setPage(0); return; }
    const id = setInterval(() => setPage((p) => (p + 1) % totalPages), PAGE_ROTATE_MS);
    return () => clearInterval(id);
  }, [totalPages, isMobile]);

  useEffect(() => { setPage(0); }, [visible.length]);

  // Mobile shows all visible aulas (scrollable); desktop paginates
  const rawPageAulas = isMobile ? visible : visible.slice(page * rowsPerPage, (page + 1) * rowsPerPage);
  const pageAulas = (!isMobile && trimCount > 0)
    ? rawPageAulas.slice(0, Math.max(1, rawPageAulas.length - trimCount))
    : rawPageAulas;

  const toggleOrientation = () => {
    setOrientation((o) => {
      const next = o === "landscape" ? "portrait" : "landscape";
      try { localStorage.setItem("totem_orientation", next); } catch {}
      return next;
    });
  };

  // Portrait rotation only for desktop kiosks — mobile users rotate the physical device
  const wrapperStyle: React.CSSProperties =
    (!isMobile && orientation === "portrait")
      ? { position: "fixed", top: 0, left: 0, width: "100vh", height: "100vw", transform: "rotate(90deg)", transformOrigin: "left top", marginLeft: "100vw", overflow: "hidden" }
      : { position: "fixed", inset: 0, overflow: "hidden" };

  if (!token) {
    return (
      <div style={{ background: "#050d1c", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ background: "#0b1e3d", borderRadius: 16, padding: "clamp(1.5rem,4vh,2.5rem) clamp(1.5rem,4vw,3rem)", maxWidth: "min(420px,90vw)", width: "100%", textAlign: "center" }}>
          <div style={{ fontSize: "clamp(2rem,5vw,3rem)", marginBottom: "1rem" }}>🖥️</div>
          <h1 style={{ color: "#e2e8f0", fontSize: "clamp(1rem,2.5vw,1.4rem)", fontWeight: 700, marginBottom: "0.5rem" }}>SENAI — Painel de Aulas</h1>
          <p style={{ color: "#64748b", fontSize: "clamp(0.8rem,1.5vw,0.9rem)", marginBottom: "1.5rem" }}>Digite o token de acesso para continuar.</p>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && tokenInput && setToken(tokenInput)}
            placeholder="Token de acesso"
            style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: 8, border: "1px solid #1e3a5f", background: "#07122a", color: "#e2e8f0", fontSize: "clamp(0.85rem,1.5vw,1rem)", boxSizing: "border-box" }}
          />
          <button
            onClick={() => tokenInput && setToken(tokenInput)}
            style={{ marginTop: "1rem", width: "100%", padding: "0.75rem", borderRadius: 8, background: "#1d4ed8", color: "#fff", fontWeight: 700, fontSize: "clamp(0.85rem,1.5vw,1rem)", border: "none", cursor: "pointer" }}
          >
            Entrar
          </button>
        </div>
      </div>
    );
  }

  const firstClassMin = aulas.length ? minutesSinceMidnight(aulas[0].horario_inicio ?? "00:00") : null;
  const nowMin = nowMinutes(agora);
  const waitingForDay = firstClassMin !== null && nowMin < firstClassMin - 60;
  const dayDone = aulas.length > 0 && visible.length === 0 && !waitingForDay;

  return (
    <div style={{ ...wrapperStyle, background: "#050d1c", color: "#e2e8f0", fontFamily: "'Segoe UI', system-ui, sans-serif", display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <header style={{
        background: "#0b1e3d",
        borderBottom: "2px solid #1e3a5f",
        padding: "clamp(0.5rem,1.2vh,0.9rem) clamp(1rem,2vw,2rem)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
        gap: "1rem",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "clamp(0.5rem,1.2vw,1.2rem)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/senai-logo-white.png" alt="SENAI" style={{ height: "clamp(28px,5vh,56px)", width: "auto", objectFit: "contain" }} />
          {!isMobile && (
            <div>
              <div style={{ fontWeight: 700, fontSize: "clamp(0.7rem,1.1vw,1.1rem)", color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Painel de Aulas
              </div>
              <div style={{ fontSize: "clamp(0.6rem,0.9vw,0.9rem)", color: "#475569", marginTop: "1px" }}>
                {capitalize(fmtDateLong(agora))}
              </div>
            </div>
          )}
          {isMobile && (
            <div style={{ fontSize: "0.75rem", color: "#475569" }}>
              {agora.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" })}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "clamp(0.75rem,1.5vw,1.5rem)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "#22c55e", fontSize: "clamp(0.65rem,0.9vw,0.85rem)", fontWeight: 600 }}>
            <span style={{ width: "clamp(6px,0.5vw,9px)", height: "clamp(6px,0.5vw,9px)", borderRadius: "50%", background: "#22c55e", display: "inline-block", animation: "pulse 2s infinite", flexShrink: 0 }} />
            AO VIVO
          </div>

          <div style={{ fontFamily: "'Courier New', monospace", fontSize: isMobile ? "1.3rem" : "clamp(1.4rem,2.8vw,3rem)", fontWeight: 700, color: "#f0b429", letterSpacing: "0.04em", lineHeight: 1 }}>
            {fmtClock(agora)}
          </div>

          {!isMobile && (
            <button
              onClick={toggleOrientation}
              title={orientation === "landscape" ? "Modo retrato (90°)" : "Modo paisagem"}
              style={{ background: "#1e3a5f", border: "none", borderRadius: 6, color: "#94a3b8", padding: "clamp(0.3rem,0.5vh,0.5rem) clamp(0.4rem,0.6vw,0.7rem)", cursor: "pointer", fontSize: "clamp(0.85rem,1.2vw,1.1rem)" }}
            >
              {orientation === "landscape" ? "⟳" : "⟲"}
            </button>
          )}
        </div>
      </header>

      {/* Column Headers — only on tablet/desktop grid */}
      {!isMobile && (
        <div style={{
          background: "#0f2347",
          borderBottom: "1px solid #1e3a5f",
          padding: `0 clamp(1rem,2vw,2rem)`,
          flexShrink: 0,
          display: "grid",
          gridTemplateColumns: GRID_COLS,
          gap: "clamp(0.3rem,0.5vw,0.75rem)",
          alignItems: "center",
        }}>
          {["HORÁRIO", "TURMA", "DISCIPLINA / UC", "ETAPA", "PROFESSOR", "SALA", "STATUS"].map((h) => (
            <div key={h} style={{ padding: "clamp(0.4rem,0.7vh,0.65rem) clamp(0.3rem,0.4vw,0.6rem)", fontSize: "clamp(0.55rem,0.7vw,0.75rem)", fontWeight: 700, color: "#64748b", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              {h}
            </div>
          ))}
        </div>
      )}

      {/* Rows area — scrollable on mobile, paginated (hidden overflow) on desktop */}
      <div ref={tableBodyRef} style={{ flex: 1, overflow: isMobile ? "auto" : "hidden", display: "flex", flexDirection: "column", WebkitOverflowScrolling: "touch" } as React.CSSProperties}>

        {error && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#f87171", fontSize: "clamp(0.9rem,1.5vw,1.2rem)", gap: "0.75rem" }}>
            ⚠️ {error}
          </div>
        )}

        {!error && waitingForDay && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "clamp(0.75rem,1.5vh,1.25rem)" }}>
            <div style={{ fontSize: "clamp(2.5rem,6vw,5rem)" }}>🌅</div>
            <div style={{ fontSize: "clamp(1rem,2.5vw,1.8rem)", fontWeight: 700, color: "#94a3b8" }}>Aulas começam em breve</div>
            <div style={{ fontSize: "clamp(0.85rem,1.5vw,1.1rem)", color: "#475569" }}>
              Primeira aula: {aulas[0]?.horario_inicio} – {aulas[0]?.horario_fim}
            </div>
          </div>
        )}

        {!error && dayDone && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "clamp(0.75rem,1.5vh,1.25rem)" }}>
            <div style={{ fontSize: "clamp(2.5rem,6vw,5rem)" }}>✅</div>
            <div style={{ fontSize: "clamp(1rem,2.5vw,1.8rem)", fontWeight: 700, color: "#94a3b8" }}>Aulas encerradas por hoje</div>
            <div style={{ fontSize: "clamp(0.85rem,1.5vw,1.1rem)", color: "#475569" }}>Até amanhã!</div>
          </div>
        )}

        {!error && !waitingForDay && !dayDone && visible.length === 0 && aulas.length === 0 && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "clamp(0.75rem,1.5vh,1.25rem)" }}>
            <div style={{ fontSize: "clamp(2.5rem,6vw,5rem)" }}>📅</div>
            <div style={{ fontSize: "clamp(1rem,2.5vw,1.8rem)", fontWeight: 700, color: "#94a3b8" }}>Sem aulas hoje</div>
          </div>
        )}

        {!error && !waitingForDay && pageAulas.map((a, i) => {
          const st = STATUS_STYLE[a.status] ?? { bg: "#374151", text: "#e2e8f0", label: a.status.toUpperCase() };
          const rowBg = i % 2 === 0 ? "#07122a" : "#080f24";
          const isNow = (() => {
            if (!a.horario_inicio || !a.horario_fim) return false;
            const startMin = minutesSinceMidnight(a.horario_inicio);
            const endMin = minutesSinceMidnight(a.horario_fim);
            return nowMin >= startMin && nowMin < endMin;
          })();

          // ── Mobile: card layout ──────────────────────────────────────────
          if (isMobile) {
            return (
              <div
                key={a.id}
                data-totem-row="true"
                style={{
                  background: isNow ? "#0d2447" : rowBg,
                  borderLeft: `4px solid ${isNow ? "#f0b429" : "transparent"}`,
                  borderBottom: "1px solid #0d1f3c",
                  padding: "0.65rem 1rem",
                  flex: "0 0 auto",
                }}
              >
                {/* Row 1: horário + etapa + status */}
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "'Courier New', monospace", fontSize: "0.95rem", fontWeight: 700, color: isNow ? "#f0b429" : "#e2e8f0", whiteSpace: "nowrap" }}>
                    {a.horario_inicio} – {a.horario_fim}
                  </span>
                  {a.etapa && (
                    <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#cbd5e1", background: "#1e3a5f", borderRadius: 4, padding: "1px 6px" }}>
                      {a.etapa}
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", background: st.bg, color: st.text, fontSize: "0.65rem", fontWeight: 700, padding: "2px 7px", borderRadius: 4, whiteSpace: "nowrap" }}>
                    {st.label}
                  </span>
                </div>
                {/* Row 2: turma */}
                <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#e2e8f0", lineHeight: 1.3, marginBottom: "0.2rem" }}>
                  {a.turma || "—"}
                  {a.subturma && <span style={{ fontSize: "0.72rem", color: "#a78bfa", marginLeft: "0.4rem" }}>Sub: {a.subturma}</span>}
                </div>
                {/* Row 3: UC */}
                <div style={{ fontSize: "0.82rem", color: "#93c5fd", lineHeight: 1.3, marginBottom: "0.25rem" }}>
                  {a.uc_nome || "—"}
                </div>
                {/* Row 4: professor | sala */}
                <div style={{ display: "flex", gap: "0.75rem", fontSize: "0.78rem", color: "#94a3b8", flexWrap: "wrap" }}>
                  <span style={{ color: a.professor ? "#cbd5e1" : "#ef4444", fontStyle: a.professor ? "normal" : "italic" }}>
                    👤 {a.professor || "Sem professor"}
                  </span>
                  {a.ambiente && <span>🚪 {a.ambiente}</span>}
                </div>
              </div>
            );
          }

          // ── Desktop/tablet: grid layout ──────────────────────────────────
          return (
            <div
              key={a.id}
              data-totem-row="true"
              style={{
                background: isNow ? "#0d2447" : rowBg,
                borderLeft: isNow ? "clamp(3px,0.3vw,5px) solid #f0b429" : "clamp(3px,0.3vw,5px) solid transparent",
                display: "grid",
                gridTemplateColumns: GRID_COLS,
                gap: "clamp(0.3rem,0.5vw,0.75rem)",
                padding: `clamp(0.4rem,0.9vh,0.7rem) clamp(1rem,2vw,2rem)`,
                alignItems: "center",
                borderBottom: "1px solid #0d1f3c",
                flex: "0 0 auto",
              }}
            >
              {/* Horário */}
              <div style={{ fontFamily: "'Courier New', monospace", fontSize: "clamp(0.85rem,1.1vw,1.3rem)", fontWeight: 700, color: isNow ? "#f0b429" : "#e2e8f0", letterSpacing: "0.02em", lineHeight: 1.2 }}>
                {a.horario_inicio}<br /><span style={{ fontSize: "clamp(0.7rem,0.9vw,1.05rem)", color: isNow ? "#f0b429cc" : "#94a3b8" }}>– {a.horario_fim}</span>
              </div>

              {/* Turma */}
              <div>
                <div style={{ fontSize: "clamp(0.75rem,1vw,1.15rem)", fontWeight: 600, color: "#e2e8f0", wordBreak: "break-word", lineHeight: 1.3 }}>
                  {a.turma || "—"}
                </div>
                {a.subturma && (
                  <div style={{ fontSize: "clamp(0.6rem,0.75vw,0.85rem)", color: "#a78bfa", marginTop: 2, fontWeight: 500 }}>
                    Sub: {a.subturma}
                  </div>
                )}
              </div>

              {/* UC */}
              <div>
                <div style={{ fontSize: "clamp(0.75rem,1vw,1.1rem)", color: "#93c5fd", wordBreak: "break-word", lineHeight: 1.3 }}>
                  {a.uc_nome || "—"}
                </div>
              </div>

              {/* Etapa */}
              <div>
                <div style={{ fontSize: "clamp(0.85rem,1.1vw,1.3rem)", fontWeight: 700, color: "#e2e8f0" }}>
                  {a.etapa || "—"}
                </div>
              </div>

              {/* Professor */}
              <div>
                <div style={{ fontSize: "clamp(0.75rem,1vw,1.1rem)", color: a.professor ? "#e2e8f0" : "#ef4444", fontStyle: a.professor ? "normal" : "italic", wordBreak: "break-word", lineHeight: 1.3 }}>
                  {a.professor || "Sem professor"}
                </div>
              </div>

              {/* Sala */}
              <div>
                <div style={{ fontSize: "clamp(0.75rem,1vw,1.1rem)", color: "#94a3b8", wordBreak: "break-word", lineHeight: 1.3 }}>
                  {a.ambiente || "—"}
                </div>
              </div>

              {/* Status */}
              <div>
                <span style={{ background: st.bg, color: st.text, fontSize: "clamp(0.55rem,0.75vw,0.8rem)", fontWeight: 700, padding: "clamp(2px,0.3vh,4px) clamp(5px,0.5vw,9px)", borderRadius: 4, letterSpacing: "0.04em", display: "inline-block", whiteSpace: "nowrap" }}>
                  {st.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <footer style={{
        background: "#0b1e3d",
        borderTop: "1px solid #1e3a5f",
        padding: "clamp(0.35rem,0.8vh,0.6rem) clamp(1rem,2vw,2rem)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
        gap: "1rem",
      }}>
        <div style={{ fontSize: "clamp(0.6rem,0.8vw,0.8rem)", color: "#475569" }}>
          {lastUpdate ? `Atualizado às ${lastUpdate.toLocaleTimeString("pt-BR")}` : "Carregando..."}
        </div>

        {!isMobile && totalPages > 1 ? (
          <div style={{ display: "flex", alignItems: "center", gap: "clamp(0.5rem,0.8vw,0.9rem)" }}>
            <div style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
              {Array.from({ length: totalPages }).map((_, i) => (
                <div key={i} style={{ width: i === page ? "clamp(14px,1.5vw,22px)" : "clamp(5px,0.6vw,8px)", height: "clamp(5px,0.6vw,8px)", borderRadius: 4, background: i === page ? "#f0b429" : "#1e3a5f", transition: "all 0.3s ease" }} />
              ))}
            </div>
            <div style={{ fontSize: "clamp(0.65rem,0.85vw,0.9rem)", color: "#94a3b8", fontWeight: 600 }}>
              {page + 1} / {totalPages}
            </div>
            {(() => {
              const nextPage = (page + 1) % totalPages;
              const nextCount = visible.slice(nextPage * rowsPerPage, (nextPage + 1) * rowsPerPage).length;
              return nextPage !== page ? (
                <div style={{ fontSize: "clamp(0.6rem,0.75vw,0.78rem)", color: "#64748b" }}>
                  ▶ {nextCount} aula{nextCount !== 1 ? "s" : ""} na próxima
                </div>
              ) : null;
            })()}
          </div>
        ) : (isMobile ? (
          <div style={{ fontSize: "0.7rem", color: "#475569" }}>
            {visible.length} aula{visible.length !== 1 ? "s" : ""} — role para ver todas
          </div>
        ) : <div />)}

        <div style={{ fontSize: "clamp(0.6rem,0.8vw,0.8rem)", color: "#475569" }}>
          {visible.length} aula{visible.length !== 1 ? "s" : ""} {visible.length !== aulas.length ? `de ${aulas.length} no dia` : "hoje"}
        </div>
      </footer>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        *{box-sizing:border-box;margin:0;padding:0}
        body{overflow:hidden}
      `}</style>
    </div>
  );
}

export default function TotemPage() {
  return (
    <Suspense fallback={
      <div style={{ background: "#050d1c", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#e2e8f0", fontFamily: "system-ui" }}>
        Carregando...
      </div>
    }>
      <TotemContent />
    </Suspense>
  );
}
