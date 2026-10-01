"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const REFRESH_MS = 30_000;
const PAGE_ROTATE_MS = 12_000;
const ROWS_PER_PAGE_FALLBACK = 8;

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
  // Exibe se: ainda não expirou (até 30min após início) E começa em até 4h a partir de agora
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
  Agendada:    { bg: "#1d4ed8", text: "#fff",     label: "AGENDADA" },
  Realizada:   { bg: "#15803d", text: "#fff",     label: "REALIZADA" },
  Substituída: { bg: "#7c3aed", text: "#fff",     label: "SUBSTITUÍDA" },
  Remarcada:   { bg: "#b45309", text: "#fff",     label: "REMARCADA" },
};

function TotemContent() {
  const params = useSearchParams();

  const [token, setToken] = useState<string>("");
  const [tokenInput, setTokenInput] = useState("");
  const [aulas, setAulas] = useState<AulaTotem[]>([]);
  const [agora, setAgora] = useState<Date>(new Date());
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(ROWS_PER_PAGE_FALLBACK);
  const [orientation, setOrientation] = useState<"landscape" | "portrait">("landscape");
  const [error, setError] = useState<string | null>(null);
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

  // Initial fetch + periodic refresh
  useEffect(() => {
    if (!token) return;
    fetchAulas(token);
    const id = setInterval(() => fetchAulas(token), REFRESH_MS);
    return () => clearInterval(id);
  }, [token, fetchAulas]);

  // Clock tick every second
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Compute visible aulas (filter by time window)
  const visible = aulas.filter((a) => isVisible(a.horario_inicio, agora));
  const totalPages = Math.ceil(visible.length / rowsPerPage) || 1;

  // Measure row height to determine rowsPerPage
  useEffect(() => {
    function measure() {
      if (!tableBodyRef.current) return;
      const container = tableBodyRef.current;
      const availableH = container.clientHeight;
      const rowH = orientation === "portrait" ? 72 : 64;
      const rows = Math.max(1, Math.floor(availableH / rowH));
      setRowsPerPage(rows);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [orientation]);

  // Auto-paginate
  useEffect(() => {
    if (totalPages <= 1) { setPage(0); return; }
    const id = setInterval(() => setPage((p) => (p + 1) % totalPages), PAGE_ROTATE_MS);
    return () => clearInterval(id);
  }, [totalPages]);

  // Reset to page 0 when visible list changes
  useEffect(() => { setPage(0); }, [visible.length]);

  const pageAulas = visible.slice(page * rowsPerPage, (page + 1) * rowsPerPage);

  const toggleOrientation = () => {
    setOrientation((o) => {
      const next = o === "landscape" ? "portrait" : "landscape";
      try { localStorage.setItem("totem_orientation", next); } catch {}
      return next;
    });
  };

  // Portrait mode: rotate entire wrapper
  const wrapperStyle: React.CSSProperties =
    orientation === "portrait"
      ? {
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vh",
          height: "100vw",
          transform: "rotate(90deg)",
          transformOrigin: "left top",
          marginLeft: "100vw",
          overflow: "hidden",
        }
      : {
          position: "fixed",
          inset: 0,
          overflow: "hidden",
        };

  if (!token) {
    return (
      <div style={{ background: "#050d1c", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ background: "#0b1e3d", borderRadius: 16, padding: "2.5rem 3rem", maxWidth: 420, width: "100%", textAlign: "center" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🖥️</div>
          <h1 style={{ color: "#e2e8f0", fontSize: "1.4rem", fontWeight: 700, marginBottom: "0.5rem" }}>SENAI — Painel de Aulas</h1>
          <p style={{ color: "#64748b", fontSize: "0.9rem", marginBottom: "1.5rem" }}>Digite o token de acesso para continuar.</p>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && tokenInput && setToken(tokenInput)}
            placeholder="Token de acesso"
            style={{ width: "100%", padding: "0.75rem 1rem", borderRadius: 8, border: "1px solid #1e3a5f", background: "#07122a", color: "#e2e8f0", fontSize: "1rem", boxSizing: "border-box" }}
          />
          <button
            onClick={() => tokenInput && setToken(tokenInput)}
            style={{ marginTop: "1rem", width: "100%", padding: "0.75rem", borderRadius: 8, background: "#1d4ed8", color: "#fff", fontWeight: 700, fontSize: "1rem", border: "none", cursor: "pointer" }}
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
      <header style={{ background: "#0b1e3d", borderBottom: "2px solid #1e3a5f", padding: "0.75rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, gap: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {/* Logo area */}
          <div style={{ background: "#1d4ed8", borderRadius: 8, padding: "0.4rem 0.75rem", fontWeight: 900, fontSize: "1.1rem", letterSpacing: "0.05em", color: "#fff" }}>
            SENAI
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Painel de Aulas
            </div>
            <div style={{ fontSize: "0.8rem", color: "#475569", marginTop: "1px" }}>
              {capitalize(fmtDateLong(agora))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
          {/* Live indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "#22c55e", fontSize: "0.8rem", fontWeight: 600 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", display: "inline-block", animation: "pulse 2s infinite" }} />
            AO VIVO
          </div>

          {/* Clock */}
          <div style={{ fontFamily: "'Courier New', monospace", fontSize: "2.2rem", fontWeight: 700, color: "#f0b429", letterSpacing: "0.04em", lineHeight: 1 }}>
            {fmtClock(agora)}
          </div>

          {/* Orientation toggle */}
          <button
            onClick={toggleOrientation}
            title={orientation === "landscape" ? "Modo retrato (90°)" : "Modo paisagem"}
            style={{ background: "#1e3a5f", border: "none", borderRadius: 6, color: "#94a3b8", padding: "0.4rem 0.6rem", cursor: "pointer", fontSize: "1rem" }}
          >
            {orientation === "landscape" ? "⟳" : "⟲"}
          </button>
        </div>
      </header>

      {/* Column Headers */}
      <div style={{ background: "#0f2347", borderBottom: "1px solid #1e3a5f", padding: "0 1.5rem", flexShrink: 0, display: "grid", gridTemplateColumns: "130px 1fr 1.4fr 1fr 120px 110px", gap: "0.5rem", alignItems: "center" }}>
        {["HORÁRIO", "TURMA", "DISCIPLINA / UC", "PROFESSOR", "SALA", "STATUS"].map((h) => (
          <div key={h} style={{ padding: "0.55rem 0.5rem", fontSize: "0.7rem", fontWeight: 700, color: "#64748b", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {h}
          </div>
        ))}
      </div>

      {/* Rows area */}
      <div ref={tableBodyRef} style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {error && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#f87171", fontSize: "1.1rem", gap: "0.75rem" }}>
            <span>⚠️</span> {error}
          </div>
        )}

        {!error && waitingForDay && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem" }}>
            <div style={{ fontSize: "4rem" }}>🌅</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#94a3b8" }}>Aulas começam em breve</div>
            <div style={{ fontSize: "1rem", color: "#475569" }}>
              Primeira aula: {aulas[0]?.horario_inicio} – {aulas[0]?.horario_fim}
            </div>
          </div>
        )}

        {!error && dayDone && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem" }}>
            <div style={{ fontSize: "4rem" }}>✅</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#94a3b8" }}>Aulas encerradas por hoje</div>
            <div style={{ fontSize: "1rem", color: "#475569" }}>Até amanhã!</div>
          </div>
        )}

        {!error && !waitingForDay && !dayDone && visible.length === 0 && aulas.length === 0 && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem" }}>
            <div style={{ fontSize: "4rem" }}>📅</div>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#94a3b8" }}>Sem aulas hoje</div>
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

          return (
            <div
              key={a.id}
              style={{
                background: isNow ? "#0d2447" : rowBg,
                borderLeft: isNow ? "4px solid #f0b429" : "4px solid transparent",
                display: "grid",
                gridTemplateColumns: "130px 1fr 1.4fr 1fr 120px 110px",
                gap: "0.5rem",
                padding: "0 1.5rem",
                alignItems: "center",
                borderBottom: "1px solid #0d1f3c",
                flex: "1 0 0",
                minHeight: 60,
                maxHeight: 80,
              }}
            >
              {/* Horário */}
              <div style={{ fontFamily: "'Courier New', monospace", fontSize: "1.15rem", fontWeight: 700, color: isNow ? "#f0b429" : "#e2e8f0", padding: "0 0.5rem", letterSpacing: "0.03em" }}>
                {a.horario_inicio} – {a.horario_fim}
              </div>

              {/* Turma */}
              <div style={{ padding: "0 0.5rem", overflow: "hidden" }}>
                <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "#e2e8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={a.turma}>
                  {a.turma || "—"}
                </div>
                {a.subturma && (
                  <div style={{ fontSize: "0.72rem", color: "#7c3aed", marginTop: 2, fontWeight: 500 }}>
                    Sub: {a.subturma}
                  </div>
                )}
              </div>

              {/* UC */}
              <div style={{ padding: "0 0.5rem", overflow: "hidden" }}>
                <div style={{ fontSize: "0.9rem", color: "#93c5fd", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={a.uc_nome}>
                  {a.uc_nome || "—"}
                </div>
                {a.etapa && (
                  <div style={{ fontSize: "0.72rem", color: "#64748b", marginTop: 2 }}>
                    Etapa {a.etapa}
                  </div>
                )}
              </div>

              {/* Professor */}
              <div style={{ padding: "0 0.5rem", fontSize: "0.9rem", color: a.professor ? "#e2e8f0" : "#ef4444", fontStyle: a.professor ? "normal" : "italic", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={a.professor}>
                {a.professor || "Sem professor"}
              </div>

              {/* Sala */}
              <div style={{ padding: "0 0.5rem", fontSize: "0.9rem", color: "#94a3b8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {a.ambiente || "—"}
              </div>

              {/* Status */}
              <div style={{ padding: "0 0.5rem" }}>
                <span style={{ background: st.bg, color: st.text, fontSize: "0.7rem", fontWeight: 700, padding: "3px 8px", borderRadius: 4, letterSpacing: "0.05em", display: "inline-block" }}>
                  {st.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <footer style={{ background: "#0b1e3d", borderTop: "1px solid #1e3a5f", padding: "0.5rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ fontSize: "0.75rem", color: "#475569" }}>
          {lastUpdate ? `Atualizado às ${lastUpdate.toLocaleTimeString("pt-BR")}` : "Carregando..."}
        </div>
        {totalPages > 1 && (
          <div style={{ fontSize: "0.75rem", color: "#64748b", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span>Página</span>
            <span style={{ color: "#94a3b8", fontWeight: 700 }}>{page + 1}</span>
            <span>de</span>
            <span style={{ color: "#94a3b8", fontWeight: 700 }}>{totalPages}</span>
          </div>
        )}
        <div style={{ fontSize: "0.75rem", color: "#475569" }}>
          {visible.length} aula{visible.length !== 1 ? "s" : ""} {visible.length !== aulas.length ? `de ${aulas.length} no dia` : "hoje"}
        </div>
      </footer>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { overflow: hidden; }
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
