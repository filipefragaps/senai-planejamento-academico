import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const DIAS_SEMANA = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

export function formatDate(date: string | Date) {
  if (!date) return "-";
  // For date-only strings (YYYY-MM-DD), parse manually to avoid UTC offset shifting the day
  if (typeof date === "string") {
    const iso = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  }
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, "dd/MM/yyyy", { locale: ptBR });
}

export function formatDateTime(date: string | Date) {
  if (!date) return "-";
  const d = typeof date === "string" ? parseISO(date) : date;
  return format(d, "dd/MM/yyyy HH:mm", { locale: ptBR });
}

export function formatTime(t: string) {
  return t ? t.substring(0, 5) : "-";
}

export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    OK: "bg-green-100 text-green-800",
    Alerta: "bg-yellow-100 text-yellow-800",
    Critico: "bg-red-100 text-red-800",
    Sobrecarga: "bg-orange-100 text-orange-800",
    "Baixa carga": "bg-gray-100 text-gray-600",
    Agendada: "bg-blue-100 text-blue-800",
    Realizada: "bg-green-100 text-green-800",
    Cancelada: "bg-red-100 text-red-800",
    Substituída: "bg-purple-100 text-purple-800",
    Planejado: "bg-indigo-100 text-indigo-800",
    Ativo: "bg-green-100 text-green-800",
    Concluído: "bg-gray-100 text-gray-600",
  };
  return map[status] || "bg-gray-100 text-gray-600";
}

export function getRegenciaColor(percentual: number): string {
  if (percentual >= 70) return "text-green-600";
  if (percentual >= 50) return "text-yellow-600";
  return "text-red-600";
}

export function getRegenciaBarColor(percentual: number): string {
  if (percentual >= 70) return "bg-green-500";
  if (percentual >= 50) return "bg-yellow-500";
  return "bg-red-500";
}
