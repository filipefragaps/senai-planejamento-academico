"use client";

import { useState, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { versoesApi, eventosApi } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import {
  History, ArrowRight, Pencil, RefreshCw, Plus, X, ChevronLeft, ChevronRight, Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtData(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

function fmtHora(h: string | null) {
  return h ? h.slice(0, 5) : "—";
}

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── Tipo badge ────────────────────────────────────────────────────────────────

const TIPO_META: Record<string, { label: string; icon: any; color: string }> = {
  edicao:         { label: "Edição",         icon: Pencil,     color: "bg-blue-100 text-blue-700" },
  replanejamento: { label: "Replanejamento",  icon: RefreshCw,  color: "bg-purple-100 text-purple-700" },
  criacao:        { label: "Criação",         icon: Plus,       color: "bg-green-100 text-green-700" },
  cancelamento:   { label: "Cancelamento",    icon: X,          color: "bg-red-100 text-red-700" },
};

function TipoBadge({ tipo }: { tipo: string }) {
  const meta = TIPO_META[tipo] ?? { label: tipo, icon: History, color: "bg-gray-100 text-gray-600" };
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full", meta.color)}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

// ── DiffField ─────────────────────────────────────────────────────────────────

const CAMPO_LABEL: Record<string, string> = {
  data: "Data",
  horario_inicio: "Início",
  horario_fim: "Fim",
  professor_nome: "Professor",
  professor_id: "Professor (ID)",
  sala: "Sala",
  ambiente: "Ambiente",
  status: "Status",
  observacoes: "Observações",
};

function formatVal(campo: string, val: any): string {
  if (val === null || val === undefined) return "—";
  if (campo === "data") return fmtData(String(val));
  if (campo === "horario_inicio" || campo === "horario_fim") return fmtHora(String(val));
  return String(val);
}

function DiffFields({ antes, depois }: { antes: any; depois: any }) {
  if (!antes && !depois) return <p className="text-xs text-gray-400 italic">Sem dados de comparação.</p>;

  const campos = new Set([
    ...Object.keys(antes ?? {}),
    ...Object.keys(depois ?? {}),
  ]);

  // Campos que nunca mostrar no diff (são redundantes ou internos)
  const IGNORAR = new Set(["id", "professor_id"]);
  // Se professor_nome está presente nos dados, usa ele em vez de professor_id
  const usaNome = campos.has("professor_nome");
  if (usaNome) IGNORAR.add("professor_id");

  const diffs: { campo: string; a: any; d: any }[] = [];
  for (const campo of campos) {
    if (IGNORAR.has(campo)) continue;
    const a = antes?.[campo];
    const d = depois?.[campo];
    const aStr = formatVal(campo, a);
    const dStr = formatVal(campo, d);
    if (aStr !== dStr) diffs.push({ campo, a: aStr, d: dStr });
  }

  if (diffs.length === 0) {
    return <p className="text-xs text-gray-400 italic">Nenhuma alteração detectada nos campos monitorados.</p>;
  }

  return (
    <div className="space-y-1">
      {diffs.map(({ campo, a, d }) => (
        <div key={campo} className="flex items-start gap-2 text-xs py-0.5">
          <span className="w-24 text-gray-400 shrink-0 pt-0.5">{CAMPO_LABEL[campo] ?? campo}:</span>
          <div className="flex items-start gap-1.5 flex-wrap">
            <span className="text-red-500 line-through break-all">{a}</span>
            <ArrowRight className="h-3 w-3 text-gray-400 shrink-0 mt-0.5" />
            <span className="text-green-700 font-medium break-all">{d}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Card de versão ────────────────────────────────────────────────────────────

function VersaoCard({ v }: { v: any }) {
  const [aberto, setAberto] = useState(true);

  return (
    <div className="card p-4">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <TipoBadge tipo={v.tipo} />
          <div className="min-w-0">
            {v.nome_evento && (
              <p className="text-sm font-semibold text-gray-800 leading-tight truncate">{v.nome_evento}</p>
            )}
            {v.aula_data && (
              <p className="text-xs text-gray-500 mt-0.5">
                Aula de <span className="font-medium">{fmtData(v.aula_data)}</span>
                {v.aula_horario_inicio && (
                  <> · {fmtHora(v.aula_horario_inicio)} – {fmtHora(v.aula_horario_fim)}</>
                )}
              </p>
            )}
            {v.motivo && (
              <p className="text-xs text-gray-400 mt-0.5 italic">"{v.motivo}"</p>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-gray-400 whitespace-nowrap">{fmtDateTime(v.criado_em)}</p>
          {v.usuario_nome && (
            <p className="text-xs text-gray-500 mt-0.5">por <span className="font-medium">{v.usuario_nome}</span></p>
          )}
        </div>
      </div>

      {/* Diff */}
      {(v.antes || v.depois) && (
        <div className="mt-3">
          <button
            onClick={() => setAberto((o) => !o)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-2"
          >
            {aberto ? <ChevronLeft className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {aberto ? "Ocultar alterações" : "Ver alterações"}
          </button>
          {aberto && (
            <div className="bg-gray-50 rounded-lg px-3 py-2">
              <DiffFields antes={v.antes} depois={v.depois} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Conteúdo principal ────────────────────────────────────────────────────────

const POR_PAGINA = 20;
const TIPOS = ["edicao", "replanejamento", "criacao", "cancelamento"];

function HistoricoContent() {
  const params = useSearchParams();
  const [eventoId, setEventoId] = useState(params.get("evento_id") ?? "");
  const [tipoFiltro, setTipoFiltro] = useState("");
  const [pagina, setPagina] = useState(0); // offset em registros

  const { data: eventos = [] } = useQuery({
    queryKey: ["eventos-lista"],
    queryFn: () => eventosApi.listar(),
  });

  const { data: versoes = [], isLoading } = useQuery<any[]>({
    queryKey: ["historico-recentes", eventoId, tipoFiltro, pagina],
    queryFn: () => versoesApi.recentes({
      evento_id: eventoId ? +eventoId : undefined,
      tipo: tipoFiltro || undefined,
      skip: pagina * POR_PAGINA,
      limit: POR_PAGINA,
    }),
    staleTime: 30_000,
  });

  function mudarFiltro(campo: "evento" | "tipo", val: string) {
    if (campo === "evento") setEventoId(val);
    if (campo === "tipo") setTipoFiltro(val === tipoFiltro ? "" : val);
    setPagina(0);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Histórico de Alterações"
        description="Registro completo de edições no cronograma — quem alterou, o quê e quando"
      />

      {/* Filtros */}
      <div className="card px-4 py-3 flex items-center gap-4 flex-wrap">
        <Filter className="h-4 w-4 text-gray-400 shrink-0" />

        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 font-medium whitespace-nowrap">Turma:</label>
          <select
            className="input text-sm py-1 max-w-[220px]"
            value={eventoId}
            onChange={(e) => mudarFiltro("evento", e.target.value)}
          >
            <option value="">Todos os eventos</option>
            {(eventos as any[]).map((e: any) => (
              <option key={e.id} value={e.id}>{e.nome_turma}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <label className="text-xs text-gray-500 font-medium">Tipo:</label>
          {TIPOS.map((t) => {
            const meta = TIPO_META[t];
            const ativo = tipoFiltro === t;
            return (
              <button
                key={t}
                onClick={() => mudarFiltro("tipo", t)}
                className={cn(
                  "inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors",
                  ativo ? meta.color + " border-transparent" : "border-gray-200 text-gray-500 hover:bg-gray-50"
                )}
              >
                {meta.label}
              </button>
            );
          })}
        </div>

        {(eventoId || tipoFiltro) && (
          <button
            onClick={() => { setEventoId(""); setTipoFiltro(""); setPagina(0); }}
            className="ml-auto flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700"
          >
            <X className="h-3.5 w-3.5" /> Limpar
          </button>
        )}
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="text-center py-16 text-gray-400">Carregando histórico...</div>
      ) : versoes.length === 0 ? (
        <div className="card p-16 text-center text-gray-300">
          <History className="h-12 w-12 mx-auto mb-3" />
          <p className="font-medium text-gray-400">Nenhuma alteração registrada</p>
          <p className="text-sm mt-1">
            O histórico é preenchido automaticamente quando aulas são editadas no Cronograma ou no Planejamento.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {versoes.map((v: any) => <VersaoCard key={v.id} v={v} />)}
        </div>
      )}

      {/* Paginação */}
      {(versoes.length === POR_PAGINA || pagina > 0) && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>
            {pagina * POR_PAGINA + 1}–{pagina * POR_PAGINA + versoes.length}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPagina((p) => Math.max(0, p - 1))}
              disabled={pagina === 0}
              className="flex items-center gap-1 px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" /> Anterior
            </button>
            <button
              onClick={() => setPagina((p) => p + 1)}
              disabled={versoes.length < POR_PAGINA}
              className="flex items-center gap-1 px-3 py-1.5 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
            >
              Próxima <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function HistoricoPage() {
  return (
    <Suspense fallback={<div className="p-8 text-gray-400">Carregando...</div>}>
      <HistoricoContent />
    </Suspense>
  );
}
