"use client";

import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AulaRow {
  id: number;
  evento_id: number;
  nome_evento?: string | null;
  nome_curso?: string | null;
  data?: string | null;
  turno?: string | null;
  horario_inicio?: string | null;
  horario_fim?: string | null;
  uc_nome?: string | null;
  numero_aula?: number | null;
  subturma?: string | null;
  professor_nome?: string | null;
  ambiente?: string | null;
  etapa?: string | null;
  tipo_contrato?: string | null;
  observacoes?: string | null;
  status: string;
  alterada_manualmente?: boolean;
  unidade_curricular_id?: number | null;
  professor_id?: number | null;
}

const STATUS_CLS: Record<string, string> = {
  Realizada:   "bg-green-100 text-green-800",
  Agendada:    "bg-blue-100 text-blue-700",
  Cancelada:   "bg-red-100 text-red-700",
  Substituída: "bg-purple-100 text-purple-700",
  Remarcada:   "bg-orange-100 text-orange-700",
};

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  // ISO date: "YYYY-MM-DD" → "DD/MM/YYYY"
  const iso = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return d;
}

interface Props {
  aulas: AulaRow[];
  onClickRow?: (aula: AulaRow) => void;
  mostrarEvento?: boolean;
}

export function CronogramaTable({ aulas, onClickRow, mostrarEvento = true }: Props) {
  if (aulas.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 text-sm">
        Nenhuma aula encontrada.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-gray-50 text-gray-500 uppercase tracking-wide sticky top-0 z-10">
          <tr>
            <th className="px-2 py-2.5 text-left font-semibold whitespace-nowrap">Data</th>
            {mostrarEvento && <th className="px-2 py-2.5 text-left font-semibold whitespace-nowrap">Evento</th>}
            <th className="px-2 py-2.5 text-left font-semibold whitespace-nowrap">Turno</th>
            <th className="px-2 py-2.5 text-left font-semibold whitespace-nowrap">Horário</th>
            <th className="px-2 py-2.5 text-left font-semibold whitespace-nowrap">Curso</th>
            <th className="px-2 py-2.5 text-left font-semibold whitespace-nowrap min-w-[180px]">Unidade Curricular</th>
            <th className="px-2 py-2.5 text-center font-semibold whitespace-nowrap">Aula</th>
            <th className="px-2 py-2.5 text-center font-semibold whitespace-nowrap">Subturma</th>
            <th className="px-2 py-2.5 text-left font-semibold whitespace-nowrap min-w-[140px]">Professor</th>
            <th className="px-2 py-2.5 text-left font-semibold whitespace-nowrap">Ambiente</th>
            <th className="px-2 py-2.5 text-left font-semibold whitespace-nowrap">Etapa</th>
            <th className="px-2 py-2.5 text-left font-semibold whitespace-nowrap">Contrato</th>
            <th className="px-2 py-2.5 text-left font-semibold whitespace-nowrap max-w-[120px]">Obs</th>
            <th className="px-2 py-2.5 text-left font-semibold whitespace-nowrap">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {aulas.map((a) => {
            const travada = a.alterada_manualmente;
            const statusCls = STATUS_CLS[a.status] ?? "bg-gray-100 text-gray-600";
            return (
              <tr
                key={a.id}
                className={cn(
                  "transition-colors",
                  travada ? "bg-gray-50" : "hover:bg-blue-50",
                  onClickRow ? "cursor-pointer" : "",
                )}
                onClick={() => onClickRow?.(a)}
              >
                <td className="px-2 py-2 whitespace-nowrap font-mono text-gray-600">{fmtDate(a.data)}</td>
                {mostrarEvento && (
                  <td className="px-2 py-2 max-w-[160px]">
                    <p className="truncate font-medium text-gray-800" title={a.nome_evento ?? ""}>{a.nome_evento ?? "—"}</p>
                  </td>
                )}
                <td className="px-2 py-2 whitespace-nowrap text-gray-600">{a.turno ?? "—"}</td>
                <td className="px-2 py-2 whitespace-nowrap text-gray-600 font-mono">
                  {a.horario_inicio && a.horario_fim ? `${a.horario_inicio} – ${a.horario_fim}` : "—"}
                </td>
                <td className="px-2 py-2 max-w-[140px]">
                  <p className="truncate text-gray-600" title={a.nome_curso ?? ""}>{a.nome_curso ?? "—"}</p>
                </td>
                <td className="px-2 py-2 max-w-[200px]">
                  <p className="truncate text-gray-800" title={a.uc_nome ?? ""}>{a.uc_nome ?? "—"}</p>
                </td>
                <td className="px-2 py-2 text-center text-gray-600">{a.numero_aula ?? "—"}</td>
                <td className="px-2 py-2 text-center">
                  {a.subturma ? (
                    <span className="badge bg-indigo-50 text-indigo-700">{a.subturma}</span>
                  ) : "—"}
                </td>
                <td className="px-2 py-2 max-w-[160px]">
                  <p className="truncate font-medium text-gray-800" title={a.professor_nome ?? ""}>{a.professor_nome ?? <span className="text-amber-500 italic">Sem professor</span>}</p>
                </td>
                <td className="px-2 py-2 whitespace-nowrap text-gray-600">{a.ambiente ?? "—"}</td>
                <td className="px-2 py-2 whitespace-nowrap text-gray-600">{a.etapa ?? "—"}</td>
                <td className="px-2 py-2 whitespace-nowrap">
                  {a.tipo_contrato ? (
                    <span className={cn("badge", a.tipo_contrato === "Mensalista" ? "bg-blue-50 text-blue-700" : "bg-orange-50 text-orange-700")}>
                      {a.tipo_contrato}
                    </span>
                  ) : "—"}
                </td>
                <td className="px-2 py-2 max-w-[120px]">
                  <p className="truncate text-gray-500" title={a.observacoes ?? ""}>{a.observacoes ?? "—"}</p>
                </td>
                <td className="px-2 py-2 whitespace-nowrap">
                  <div className="flex items-center gap-1">
                    {travada && <Lock className="h-3 w-3 text-gray-400 shrink-0" />}
                    <span className={cn("badge text-[10px]", statusCls)}>{a.status}</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
