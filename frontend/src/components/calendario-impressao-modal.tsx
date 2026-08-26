"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { planejamentoApi } from "@/lib/api";
import { X, Loader2, Printer, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  eventoId: number;
  eventoNome: string;
  onClose: () => void;
}

const MESES_PT = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];
const DIAS_CURTOS = ["D","S","T","Q","Q","S","S"];

// Paleta impressão — cores suaves para fundo de célula, legíveis em P&B
const CORES_IMPRESSAO = [
  "#dbeafe","#dcfce7","#fef9c3","#fce7f3","#ede9fe",
  "#ffedd5","#cffafe","#d1fae5","#fef3c7","#e0e7ff",
  "#fee2e2","#f0fdf4","#f0f9ff","#fdf4ff","#fff7ed",
  "#ecfdf5",
];
const CORES_TEXTO = [
  "#1e40af","#15803d","#92400e","#9d174d","#6d28d9",
  "#c2410c","#0e7490","#065f46","#b45309","#3730a3",
  "#b91c1c","#166534","#0369a1","#7e22ce","#c2410c",
  "#047857",
];

function mesAno(y: number, m: number) {
  return `${y}-${String(m).padStart(2, "0")}`;
}
function hoje() {
  const d = new Date();
  return mesAno(d.getFullYear(), d.getMonth() + 1);
}

export function CalendarioImpressaoModal({ eventoId, eventoNome, onClose }: Props) {
  const hojeMA = hoje();
  const [inicio, setInicio] = useState(hojeMA);
  const [fim, setFim]       = useState(hojeMA);
  const [gerando, setGerando] = useState(false);

  const dataInicioStr = `${inicio}-01`;
  const ultimoDia = new Date(+fim.slice(0,4), +fim.slice(5,7), 0).getDate();
  const dataFimStr = `${fim}-${ultimoDia}`;

  const { data: aulas = [], isLoading } = useQuery({
    queryKey: ["cal-impressao", eventoId, inicio, fim],
    queryFn: () =>
      planejamentoApi.cronograma({
        evento_id: eventoId,
        data_inicio: dataInicioStr,
        data_fim: dataFimStr,
        limit: 5000,
      }),
    enabled: inicio <= fim,
  });

  // Mapa de datas → aulas
  const aulasPorData = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const a of aulas as any[]) {
      if (!a.data) continue;
      const k = a.data.slice(0, 10);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(a);
    }
    return m;
  }, [aulas]);

  // Mapa UC id → índice de cor
  const ucCorIdx = useMemo(() => {
    const m = new Map<number, number>();
    let i = 0;
    for (const a of aulas as any[]) {
      if (a.unidade_curricular_id != null && !m.has(a.unidade_curricular_id)) {
        m.set(a.unidade_curricular_id, i % CORES_IMPRESSAO.length);
        i++;
      }
    }
    return m;
  }, [aulas]);

  // Lista de meses no intervalo
  const meses = useMemo(() => {
    if (inicio > fim) return [];
    const lista: { ano: number; mes: number }[] = [];
    let [y, m] = inicio.split("-").map(Number);
    const [fy, fm] = fim.split("-").map(Number);
    while (y < fy || (y === fy && m <= fm)) {
      lista.push({ ano: y, mes: m });
      m++; if (m > 12) { m = 1; y++; }
    }
    return lista;
  }, [inicio, fim]);

  // Legendas de UCs únicas no período
  const legendaUCs = useMemo(() => {
    const visto = new Map<number, string>();
    for (const a of aulas as any[]) {
      if (a.unidade_curricular_id != null && !visto.has(a.unidade_curricular_id)) {
        visto.set(a.unidade_curricular_id, a.uc_nome ?? "—");
      }
    }
    return Array.from(visto.entries()).map(([id, nome]) => ({
      id, nome, idx: ucCorIdx.get(id) ?? 0,
    }));
  }, [aulas, ucCorIdx]);

  function gerarHTML() {
    // ── CSS de impressão ──────────────────────────────────────────────────
    const css = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; background: #fff; padding: 20px; }
      h1  { font-size: 15px; font-weight: 700; margin-bottom: 2px; }
      .sub { font-size: 10px; color: #555; margin-bottom: 14px; }
      /* Legenda */
      .legenda { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-bottom: 18px; }
      .legenda-item { display: flex; align-items: center; gap: 5px; font-size: 10px; }
      .legenda-cor { width: 12px; height: 12px; border-radius: 2px; border: 1px solid rgba(0,0,0,.15); flex-shrink: 0; }
      /* Mês */
      .mes-bloco { margin-bottom: 24px; page-break-inside: avoid; }
      .mes-titulo { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
                    border-bottom: 2px solid #1d4ed8; padding-bottom: 3px; margin-bottom: 8px; color: #1d4ed8; }
      /* Grade */
      .grade { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
      .dia-header { text-align: center; font-size: 9px; font-weight: 700; color: #6b7280;
                    text-transform: uppercase; letter-spacing: .04em; padding: 3px 0; }
      .dia-vazio   { min-height: 70px; background: #f9fafb; border-radius: 3px; }
      .dia-cel     { min-height: 70px; border: 1px solid #e5e7eb; border-radius: 3px; padding: 3px; background: #fff; vertical-align: top; }
      .dia-cel.fds { background: #f9fafb; }
      .dia-num     { font-size: 10px; font-weight: 700; color: #374151; margin-bottom: 2px; }
      /* Aula dentro da célula */
      .aula-item { border-radius: 2px; padding: 2px 4px; margin-bottom: 2px; font-size: 9px; line-height: 1.4; }
      .aula-hora  { font-size: 8px; opacity: .75; font-weight: 600; }
      .aula-uc    { font-weight: 700; word-break: break-word; }
      .aula-prof  { color: #374151; word-break: break-word; }
      .aula-amb   { font-size: 8px; color: #555; font-style: italic; word-break: break-word; }
      @media print {
        body { padding: 10px; }
        .mes-bloco { page-break-inside: avoid; }
        @page { margin: 12mm; }
      }
    `;

    // ── Legenda ───────────────────────────────────────────────────────────
    const legendaHtml = legendaUCs.map(l => {
      const bg = CORES_IMPRESSAO[l.idx];
      const tx = CORES_TEXTO[l.idx];
      return `<div class="legenda-item">
        <span class="legenda-cor" style="background:${bg};border-color:${tx}30"></span>
        <span style="color:${tx};font-weight:600">${l.nome}</span>
      </div>`;
    }).join("");

    // ── Meses ─────────────────────────────────────────────────────────────
    const mesesHtml = meses.map(({ ano, mes }) => {
      const nomeMes = MESES_PT[mes - 1];
      const primeiroDia = new Date(ano, mes - 1, 1).getDay(); // 0=dom
      const diasNoMes   = new Date(ano, mes, 0).getDate();

      const headers = DIAS_CURTOS.map(d =>
        `<div class="dia-header">${d}</div>`
      ).join("");

      // células vazias antes do dia 1
      const vazios = Array.from({ length: primeiroDia }, () =>
        `<div class="dia-vazio"></div>`
      ).join("");

      // células dos dias
      const dias = Array.from({ length: diasNoMes }, (_, i) => {
        const dia = i + 1;
        const dow = (primeiroDia + i) % 7; // 0=dom,6=sáb
        const fds  = dow === 0 || dow === 6;
        const key  = `${ano}-${String(mes).padStart(2,"0")}-${String(dia).padStart(2,"0")}`;
        const aulasNoDia = (aulasPorData.get(key) || []).filter((a:any) => a.status !== "Cancelada");

        const aulasHtml = aulasNoDia.map((a: any) => {
          const idx = ucCorIdx.get(a.unidade_curricular_id) ?? 0;
          const bg  = CORES_IMPRESSAO[idx];
          const tx  = CORES_TEXTO[idx];
          const hora = `${(a.horario_inicio ?? "").slice(0,5)}–${(a.horario_fim ?? "").slice(0,5)}`;
          const ucNome = a.uc_nome ?? "—";
          const prof   = a.professor_nome || "—";
          const amb    = a.ambiente || a.sala || "";
          return `<div class="aula-item" style="background:${bg};color:${tx}">
            <div class="aula-hora">${hora}${a.etapa ? " · " + a.etapa : ""}</div>
            <div class="aula-uc">${ucNome}</div>
            <div class="aula-prof">${prof}</div>
            ${amb ? `<div class="aula-amb">🏫 ${amb}</div>` : ""}
          </div>`;
        }).join("");

        return `<div class="dia-cel${fds ? " fds" : ""}">
          <div class="dia-num">${dia}</div>
          ${aulasHtml}
        </div>`;
      }).join("");

      return `<div class="mes-bloco">
        <div class="mes-titulo">${nomeMes} ${ano}</div>
        <div class="grade">
          ${headers}
          ${vazios}
          ${dias}
        </div>
      </div>`;
    }).join("");

    const totalAulas = (aulas as any[]).filter((a:any) => a.status !== "Cancelada").length;
    const periodo = meses.length === 1
      ? `${MESES_PT[meses[0].mes - 1]} ${meses[0].ano}`
      : `${MESES_PT[meses[0].mes - 1]} ${meses[0].ano} – ${MESES_PT[meses[meses.length-1].mes - 1]} ${meses[meses.length-1].ano}`;

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"/><title>Calendário – ${eventoNome}</title>
<style>${css}</style></head>
<body>
  <h1>${eventoNome}</h1>
  <p class="sub">Período: ${periodo} · ${totalAulas} aula(s) agendada(s)</p>
  ${legendaUCs.length > 0 ? `<div class="legenda">${legendaHtml}</div>` : ""}
  ${mesesHtml}
</body></html>`;
  }

  function imprimir() {
    setGerando(true);
    setTimeout(() => {
      const html = gerarHTML();
      const win = window.open("", "_blank", "width=1100,height=800");
      if (!win) { setGerando(false); return; }
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => { win.print(); setGerando(false); }, 500);
    }, 50);
  }

  const podePrinting = inicio <= fim && !isLoading && (aulas as any[]).length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-indigo-600 px-5 py-4 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <CalendarDays className="h-4 w-4 text-indigo-200" />
              <p className="text-indigo-200 text-xs font-semibold uppercase tracking-wide">
                Imprimir Calendário
              </p>
            </div>
            <h2 className="text-white font-bold text-base leading-snug">{eventoNome}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-indigo-200 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors mt-0.5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">
            Selecione o período para gerar o calendário de aulas no formato de impressão.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Mês inicial
              </label>
              <input
                type="month"
                className="input w-full text-sm"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Mês final
              </label>
              <input
                type="month"
                className="input w-full text-sm"
                value={fim}
                onChange={(e) => {
                  const v = e.target.value;
                  setFim(v < inicio ? inicio : v);
                }}
              />
            </div>
          </div>

          {/* Preview de aulas encontradas */}
          <div className={cn(
            "rounded-lg border px-4 py-3 text-sm",
            isLoading
              ? "border-gray-200 bg-gray-50 text-gray-400"
              : (aulas as any[]).length === 0
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : "border-green-200 bg-green-50 text-green-700"
          )}>
            {isLoading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Carregando aulas...
              </span>
            ) : inicio > fim ? (
              "Período inválido — o mês final deve ser igual ou posterior ao inicial."
            ) : (aulas as any[]).length === 0 ? (
              `Nenhuma aula encontrada neste período para o evento selecionado.`
            ) : (
              <>
                <span className="font-semibold">{(aulas as any[]).filter((a:any) => a.status !== "Cancelada").length} aulas</span>
                {" "}encontradas em{" "}
                <span className="font-semibold">{meses.length} mês{meses.length > 1 ? "es" : ""}</span>
                {" "}· {legendaUCs.length} UC{legendaUCs.length !== 1 ? "s" : ""}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 bg-gray-50 border-t flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={imprimir}
            disabled={!podePrinting || gerando}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors",
              !podePrinting || gerando
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm"
            )}
          >
            {gerando ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Gerando...</>
            ) : (
              <><Printer className="h-4 w-4" /> Imprimir Calendário</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
