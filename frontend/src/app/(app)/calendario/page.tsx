"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { calendarioApi } from "@/lib/api";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  CalendarDays,
  Info,
} from "lucide-react";

// ── types ─────────────────────────────────────────────────────────────────────

interface EntradaCalendario {
  id: number;
  data: string;
  tipo: string;
  letivo: boolean;
  descricao: string | null;
  periodo: string | null;
}

// ── constants ─────────────────────────────────────────────────────────────────

const TIPOS = [
  { value: "Feriado",  label: "Feriado",   cor: "bg-red-500",    texto: "text-red-700",    badge: "bg-red-100 text-red-700 border-red-200" },
  { value: "Recesso",  label: "Recesso",   cor: "bg-orange-400", texto: "text-orange-700", badge: "bg-orange-100 text-orange-700 border-orange-200" },
  { value: "Folga",    label: "Folga",     cor: "bg-yellow-400", texto: "text-yellow-700", badge: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  { value: "Sem aula", label: "Sem aula",  cor: "bg-slate-400",  texto: "text-slate-700",  badge: "bg-slate-100 text-slate-700 border-slate-200" },
  { value: "Evento",   label: "Evento",    cor: "bg-purple-400", texto: "text-purple-700", badge: "bg-purple-100 text-purple-700 border-purple-200" },
];

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function getTipoConfig(tipo: string) {
  return TIPOS.find((t) => t.value.toLowerCase() === tipo.toLowerCase()) ?? TIPOS[3];
}

// ── helpers ───────────────────────────────────────────────────────────────────

function getDiasDoMes(ano: number, mes: number): (number | null)[] {
  // mes is 1-based
  const primeiroDia = new Date(ano, mes - 1, 1).getDay(); // 0=Dom
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const dias: (number | null)[] = Array(primeiroDia).fill(null);
  for (let d = 1; d <= ultimoDia; d++) dias.push(d);
  return dias;
}

function toISO(ano: number, mes: number, dia: number) {
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

// ── modal de dia ──────────────────────────────────────────────────────────────

interface DayModalProps {
  data: string; // YYYY-MM-DD
  entradas: EntradaCalendario[];
  onClose: () => void;
  onAdd: (body: { data: string; tipo: string; descricao?: string; letivo: boolean }) => void;
  onDelete: (id: number) => void;
  isAdding: boolean;
  isDeleting: boolean;
}

function DayModal({ data, entradas, onClose, onAdd, onDelete, isAdding, isDeleting }: DayModalProps) {
  const [tipo, setTipo] = useState(TIPOS[0].value);
  const [descricao, setDescricao] = useState("");
  const [letivo, setLetivo] = useState(false);

  const [ano, mes, dia] = data.split("-").map(Number);
  const label = `${String(dia).padStart(2, "0")} de ${MESES[mes - 1]} de ${ano}`;

  function handleAdd() {
    onAdd({ data, tipo, descricao: descricao || undefined, letivo });
    setDescricao("");
    setTipo(TIPOS[0].value);
    setLetivo(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{label}</h2>
            {entradas.length > 0 && (
              <p className="text-xs text-gray-500 mt-0.5">{entradas.length} entrada{entradas.length > 1 ? "s" : ""} registrada{entradas.length > 1 ? "s" : ""}</p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Entradas existentes */}
          {entradas.length > 0 && (
            <div className="space-y-2">
              {entradas.map((e) => {
                const cfg = getTipoConfig(e.tipo);
                return (
                  <div key={e.id} className={cn("flex items-start justify-between gap-3 rounded-lg border px-3 py-2", cfg.badge)}>
                    <div className="min-w-0">
                      <span className="text-xs font-semibold uppercase tracking-wide">{e.tipo}</span>
                      {e.descricao && <p className="text-xs mt-0.5 truncate">{e.descricao}</p>}
                      {e.letivo && <p className="text-[10px] text-green-600 font-medium mt-0.5">Dia letivo</p>}
                    </div>
                    <button
                      onClick={() => onDelete(e.id)}
                      disabled={isDeleting}
                      className="shrink-0 text-gray-400 hover:text-red-600 disabled:opacity-40"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Adicionar nova entrada */}
          <div className="space-y-3 pt-2 border-t">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Adicionar entrada</p>

            <div>
              <label className="text-xs font-medium text-gray-700">Tipo</label>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                {TIPOS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700">Descrição <span className="text-gray-400">(opcional)</span></label>
              <input
                type="text"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Ex: Feriado Municipal, Recesso Junino..."
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={letivo}
                onChange={(e) => setLetivo(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm text-gray-700">Marcar como dia letivo</span>
            </label>

            <button
              onClick={handleAdd}
              disabled={isAdding}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {isAdding ? "Adicionando..." : "Adicionar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── mini calendário de mês ─────────────────────────────────────────────────────

interface MonthCalendarProps {
  ano: number;
  mes: number; // 1-based
  entradas: EntradaCalendario[];
  onDayClick: (data: string) => void;
}

function MonthCalendar({ ano, mes, entradas, onDayClick }: MonthCalendarProps) {
  const dias = getDiasDoMes(ano, mes);

  // index by date string
  const byDate = useMemo(() => {
    const map: Record<string, EntradaCalendario[]> = {};
    for (const e of entradas) {
      if (!map[e.data]) map[e.data] = [];
      map[e.data].push(e);
    }
    return map;
  }, [entradas]);

  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="bg-[#003B8E] text-white text-center py-2 px-3">
        <span className="text-sm font-semibold">{MESES[mes - 1]}</span>
      </div>
      <div className="p-2">
        <div className="grid grid-cols-7 mb-1">
          {DIAS_SEMANA.map((d) => (
            <div key={d} className="text-center text-[10px] font-semibold text-gray-400 py-0.5">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px">
          {dias.map((dia, i) => {
            if (dia === null) {
              return <div key={`empty-${i}`} />;
            }
            const iso = toISO(ano, mes, dia);
            const dayEntradas = byDate[iso] ?? [];
            const isHoje = iso === hoje;
            const hasBloqueio = dayEntradas.some((e) => !e.letivo);

            // pick the first non-letivo type for color
            const tipoDestaque = dayEntradas.find((e) => !e.letivo);
            const cfg = tipoDestaque ? getTipoConfig(tipoDestaque.tipo) : null;

            return (
              <button
                key={iso}
                onClick={() => onDayClick(iso)}
                title={dayEntradas.map((e) => `${e.tipo}${e.descricao ? ": " + e.descricao : ""}`).join(" | ") || iso}
                className={cn(
                  "relative flex flex-col items-center justify-center rounded text-xs py-1 transition-colors",
                  isHoje ? "ring-2 ring-blue-500 ring-inset" : "",
                  hasBloqueio
                    ? cn(cfg?.cor, "text-white font-semibold hover:opacity-80")
                    : "text-gray-700 hover:bg-blue-50",
                )}
              >
                {dia}
                {dayEntradas.length > 1 && (
                  <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-white/80" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── página principal ──────────────────────────────────────────────────────────

export default function CalendarioAcademicoPage() {
  const qc = useQueryClient();
  const [ano, setAno] = useState(() => new Date().getFullYear());
  const [diaAberto, setDiaAberto] = useState<string | null>(null);

  const { data: entradas = [], isLoading } = useQuery({
    queryKey: ["calendario", ano],
    queryFn: () => calendarioApi.listar(ano),
  });

  const criar = useMutation({
    mutationFn: calendarioApi.criar,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendario", ano] });
      toast.success("Entrada adicionada ao calendário");
    },
    onError: () => toast.error("Erro ao adicionar entrada"),
  });

  const deletar = useMutation({
    mutationFn: calendarioApi.deletar,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendario", ano] });
      toast.success("Entrada removida");
    },
    onError: () => toast.error("Erro ao remover entrada"),
  });

  const entradasDoDiaAberto = useMemo(() => {
    if (!diaAberto) return [];
    return entradas.filter((e) => e.data === diaAberto);
  }, [entradas, diaAberto]);

  // counts for legend summary
  const summary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entradas) {
      if (!e.letivo) counts[e.tipo] = (counts[e.tipo] ?? 0) + 1;
    }
    return counts;
  }, [entradas]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendário Acadêmico"
        description="Gerencie feriados, recessos e dias sem aula. O agendamento respeita estas datas automaticamente."
      />

      <div className="space-y-6">
        {/* Navegação de ano e legenda */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAno((a) => a - 1)}
              className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xl font-bold text-gray-900 min-w-[4ch] text-center">{ano}</span>
            <button
              onClick={() => setAno((a) => a + 1)}
              className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Legenda */}
          <div className="flex flex-wrap items-center gap-2">
            {TIPOS.map((t) => {
              const count = summary[t.value] ?? 0;
              return (
                <span
                  key={t.value}
                  className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", t.badge)}
                >
                  <span className={cn("h-2 w-2 rounded-full shrink-0", t.cor)} />
                  {t.label}
                  {count > 0 && <span className="font-semibold">({count})</span>}
                </span>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 text-xs text-gray-500 ml-auto">
            <Info className="h-3.5 w-3.5" />
            Clique em qualquer data para adicionar ou remover uma entrada
          </div>
        </div>

        {/* Grid de meses */}
        {isLoading ? (
          <div className="flex items-center justify-center h-64 text-gray-400">
            <CalendarDays className="h-8 w-8 animate-pulse" />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((mes) => (
              <MonthCalendar
                key={mes}
                ano={ano}
                mes={mes}
                entradas={entradas}
                onDayClick={setDiaAberto}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modal de dia */}
      {diaAberto && (
        <DayModal
          data={diaAberto}
          entradas={entradasDoDiaAberto}
          onClose={() => setDiaAberto(null)}
          onAdd={(body) => criar.mutate(body)}
          onDelete={(id) => deletar.mutate(id)}
          isAdding={criar.isPending}
          isDeleting={deletar.isPending}
        />
      )}
    </div>
  );
}
